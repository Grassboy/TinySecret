const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],  // 只使用 WebSocket
    allowEIO3: true
});

// 房間結構：{ 
//   creatorPublicKey: string (完整公鑰，明文，只給參與者用於加密),
//   creatorKeyId: string (前8碼),
//   participants: Map<participantId, {
//     encryptedAESKey: string,      // 用創建者 RSA 公鑰加密的 AES 密鑰
//     encryptedPublicKey: string    // 用 AES 加密的參與者 RSA 公鑰
//   }>,
//   sockets: Map<socketId, role>,
//   lastActivity: timestamp,
//   timeoutHandle: NodeJS.Timeout
// }
const rooms = new Map();

const ROOM_TIMEOUT = 15 * 60 * 1000; // 15分鐘

app.use(express.static('public'));
app.use(express.json());

// 首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 創建房間 API
app.post('/api/create-room', (req, res) => {
    const { publicKey } = req.body;
    
    if (!publicKey) {
        return res.status(400).json({ error: '缺少公鑰' });
    }
    
    // 生成隨機房間 ID（10 字符）
    const roomId = nanoid(10);
    
    // 創建房間
    const room = {
        creatorPublicKey: publicKey,
        creatorKeyId: roomId,
        participants: new Map(),
        sockets: new Map(),
        lastActivity: Date.now()
    };
    
    // 設置超時清理
    room.timeoutHandle = setTimeout(() => {
        console.log(`房間 ${roomId} 已超時，自動清理`);
        rooms.delete(roomId);
    }, ROOM_TIMEOUT);
    
    rooms.set(roomId, room);
    
    res.json({ roomId });
});

// 獲取房間創建者公鑰
app.get('/api/room/:roomId/creator-key', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    
    if (!room) {
        return res.status(404).json({ error: '房間不存在' });
    }
    
    updateRoomActivity(roomId);
    res.json({ publicKey: room.creatorPublicKey });
});

// 參與者加入房間
app.post('/api/room/:roomId/join', (req, res) => {
    const { roomId } = req.params;
    const { encryptedAESKey, encryptedPublicKey } = req.body;
    
    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ error: '房間不存在' });
    }
    
    if (!encryptedAESKey || !encryptedPublicKey) {
        return res.status(400).json({ error: '缺少加密數據' });
    }
    
    // 生成隨機參與者 ID（8 字符）
    const participantId = nanoid(8);
    
    // 存儲加密的公鑰數據
    room.participants.set(participantId, {
        encryptedAESKey,      // 只有創建者能用自己的私鑰解密出 AES 密鑰
        encryptedPublicKey    // 只有創建者能用 AES 密鑰解密出參與者的公鑰
    });
    updateRoomActivity(roomId);
    
    res.json({ participantId, chatRoomUrl: `/${roomId}/${participantId}` });
});

// 獲取參與者加密的公鑰數據
app.get('/api/room/:roomId/participant/:participantId', (req, res) => {
    const { roomId, participantId } = req.params;
    const room = rooms.get(roomId);
    
    if (!room) {
        return res.status(404).json({ error: '房間不存在' });
    }
    
    const encryptedData = room.participants.get(participantId);
    if (!encryptedData) {
        return res.status(404).json({ error: '參與者不存在' });
    }
    
    updateRoomActivity(roomId);
    res.json(encryptedData);  // 返回 { encryptedAESKey, encryptedPublicKey }
});

// 房間頁面
app.get('/:roomId', (req, res) => {
    const { roomId } = req.params;
    
    // 檢測 Line 預覽
    const userAgent = req.get('User-Agent') || '';
    const isLineBot = userAgent.toLowerCase().includes('line-poker');
    
    if (isLineBot) {
        return res.send(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>TinySecret - 安全聊天室</title>
    <meta property="og:title" content="TinySecret - 安全聊天室">
    <meta property="og:description" content="端對端加密的即時聊天，伺服器無法解密你的訊息">
</head>
<body>
    <h1>TinySecret - 安全聊天室</h1>
    <p>端對端加密的即時聊天，伺服器無法解密你的訊息</p>
</body>
</html>
        `);
    }
    
    if (!rooms.has(roomId)) {
        return res.status(404).send('房間不存在或已過期');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// 聊天室頁面
app.get('/:roomId/:participantId', (req, res) => {
    const { roomId, participantId } = req.params;
    
    // 檢測 Line 預覽
    const userAgent = req.get('User-Agent') || '';
    const isLineBot = userAgent.toLowerCase().includes('line-poker');
    
    if (isLineBot) {
        return res.send(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>TinySecret - 加密聊天</title>
    <meta property="og:title" content="TinySecret - 加密聊天">
    <meta property="og:description" content="只有你和對方能解密的私密對話">
</head>
<body>
    <h1>TinySecret - 加密聊天</h1>
    <p>只有你和對方能解密的私密對話</p>
</body>
</html>
        `);
    }
    
    if (!rooms.has(roomId)) {
        return res.status(404).send('房間不存在或已過期');
    }
    
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// WebSocket 連接
io.on('connection', (socket) => {
    console.log('Socket 連接:', socket.id);
    
    // 加入聊天室
    socket.on('join-chat', ({ roomId, participantId }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: '房間不存在' });
            return;
        }
        
        socket.join(`${roomId}-${participantId}`);
        const role = participantId ? 'participant' : 'creator';
        room.sockets.set(socket.id, { roomId, participantId, role });
        updateRoomActivity(roomId);
        
        socket.emit('joined', { success: true });
    });
    
    // 發送加密訊息
    socket.on('send-message', ({ roomId, participantId, encryptedAESKey, encryptedMessage }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('error', { message: '房間不存在' });
            return;
        }
        
        updateRoomActivity(roomId);
        
        // 廣播給聊天室的雙方（排除發送者）
        socket.to(`${roomId}-${participantId}`).emit('new-message', {
            encryptedAESKey,
            encryptedMessage,
            timestamp: Date.now()
        });
        
        // 發送確認給發送者
        socket.emit('message-sent', {
            encryptedAESKey,
            encryptedMessage,
            timestamp: Date.now()
        });
    });
    
    // 斷線
    socket.on('disconnect', () => {
        console.log('Socket 斷線:', socket.id);
        
        // 從房間中移除
        rooms.forEach((room, roomId) => {
            if (room.sockets.has(socket.id)) {
                room.sockets.delete(socket.id);
            }
        });
    });
});

// 更新房間活動時間並重設超時
function updateRoomActivity(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    
    room.lastActivity = Date.now();
    
    // 清除舊的超時
    if (room.timeoutHandle) {
        clearTimeout(room.timeoutHandle);
    }
    
    // 設置新的超時
    room.timeoutHandle = setTimeout(() => {
        console.log(`房間 ${roomId} 已超時，自動清理`);
        rooms.delete(roomId);
    }, ROOM_TIMEOUT);
}

const PORT = process.env.PORT || 10359;
httpServer.listen(PORT, () => {
    console.log(`TinySecret 伺服器運行在 http://localhost:${PORT}`);
});
