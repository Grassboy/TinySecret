const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

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

app.use(express.json());

// 首頁（必須在 express.static 之前）
app.get('/', (req, res) => {
    const html = renderHtmlTemplate(req, 'index.html');
    res.send(html);
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

// 構建完整的 base URL（考慮反向代理）
function buildBaseUrl(req, basePath) {
    // 優先檢查 X-Forwarded-Host（Apache 代理設置）
    const forwardedHost = req.get('X-Forwarded-Host');
    const host = req.get('Host') || '';
    const finalHost = forwardedHost || host || 'localhost:10359';
    
    // 判斷是否為本地開發環境
    const isLocalhost = finalHost.includes('localhost') || finalHost.includes('127.0.0.1');
    
    // 如果不是 localhost，使用該 host 作為 baseUrl 的一部分
    if (!isLocalhost) {
        // 使用 X-Forwarded-Proto，如果沒有則默認使用 https（因為不是 localhost）
        const protocol = req.get('X-Forwarded-Proto') || 'https';
        return protocol + '://' + finalHost + basePath;
    }
    
    // 本地開發環境：使用 http
    const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'http';
    return protocol + '://' + finalHost + basePath;
}

// 讀取並替換 HTML 模板中的占位符
function renderHtmlTemplate(req, htmlFile, additionalReplacements = {}) {
    const basePath = getBasePathFromRequest(req);
    const baseUrl = buildBaseUrl(req, basePath);
    
    // 構建完整 URL（當前頁面的完整 URL）
    const forwardedHost = req.get('X-Forwarded-Host');
    const host = req.get('Host') || '';
    const finalHost = forwardedHost || host || 'localhost:10359';
    const isLocalhost = finalHost.includes('localhost') || finalHost.includes('127.0.0.1');
    const protocol = isLocalhost 
        ? (req.get('X-Forwarded-Proto') || req.protocol || 'http')
        : (req.get('X-Forwarded-Proto') || 'https');
    
    // 獲取當前路徑
    let currentPath = req.originalUrl || req.url;
    
    // 如果不是 localhost，且路徑中還沒有 tinySecret，則加上
    if (!isLocalhost) {
        const pathParts = currentPath.split('/').filter(p => p);
        if (pathParts.length === 0 || pathParts[0] !== 'tinySecret') {
            // 如果路徑不是以 /tinySecret 開頭，則加上
            currentPath = '/tinySecret' + (currentPath.startsWith('/') ? currentPath : '/' + currentPath);
        }
    }
    
    const fullUrl = protocol + '://' + finalHost + currentPath;
    
    const htmlPath = path.join(__dirname, 'public', htmlFile);
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // 替換占位符
    html = html.replace(/\[BASE\]/g, baseUrl);
    html = html.replace(/\[BASE_PATH\]/g, basePath);
    html = html.replace(/\[FULL_URL\]/g, fullUrl);
    
    // 替換額外的占位符
    Object.keys(additionalReplacements).forEach(key => {
        html = html.replace(new RegExp(`\\[${key}\\]`, 'g'), additionalReplacements[key]);
    });
    
    return html;
}

// 獲取 base path 的輔助函數
function getBasePathFromRequest(req) {
    // 嘗試從多個來源獲取完整路徑
    // 1. 檢查 X-Forwarded-Path 或 X-Original-URI（Apache 可能設置）
    const forwardedPath = req.get('X-Forwarded-Path') || req.get('X-Original-URI');
    if (forwardedPath) {
        const pathname = forwardedPath.split('?')[0];
        const parts = pathname.split('/').filter(p => p);
        const knownBasePaths = ['tinySecret'];
        if (parts.length > 0 && knownBasePaths.includes(parts[0])) {
            return '/' + parts[0] + '/';
        }
    }
    
    // 2. 檢查 Referer 頭（如果有的話）- 這是最可靠的方法
    const referer = req.get('Referer');
    if (referer) {
        try {
            const refererUrl = new URL(referer);
            const refererPath = refererUrl.pathname;
            const parts = refererPath.split('/').filter(p => p);
            const knownBasePaths = ['tinySecret'];
            if (parts.length > 0 && knownBasePaths.includes(parts[0])) {
                return '/' + parts[0] + '/';
            }
        } catch (e) {
            // 忽略解析錯誤
        }
    }
    
    // 3. 檢查 X-Forwarded-Host 和 Host 頭
    const forwardedHost = req.get('X-Forwarded-Host');
    const host = req.get('Host') || '';
    const finalHost = forwardedHost || host || 'localhost:10359';
    
    // 判斷是否為本地開發環境
    const isLocalhost = finalHost.includes('localhost') || finalHost.includes('127.0.0.1');
    
    // 如果不是 localhost，推斷使用 /tinySecret/ 子路徑
    if (!isLocalhost) {
        return '/tinySecret/';
    }
    
    // 4. 使用 originalUrl（如果包含完整路徑）
    const pathname = req.originalUrl ? req.originalUrl.split('?')[0] : (req.path || req.url.split('?')[0]);
    const parts = pathname.split('/').filter(p => p);
    const knownBasePaths = ['tinySecret'];
    
    if (parts.length > 0 && knownBasePaths.includes(parts[0])) {
        return '/' + parts[0] + '/';
    }
    
    // 5. 默認返回根路徑（本地開發）
    return '/';
}

// 房間頁面
app.get('/:roomId', (req, res, next) => {
    const { roomId } = req.params;
    
    // 排除靜態文件和 API 路徑
    const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    const isStaticFile = staticExtensions.some(ext => roomId.endsWith(ext));
    const isApiPath = roomId.startsWith('api') || roomId.startsWith('socket.io');
    
    if (isStaticFile || isApiPath) {
        return next(); // 交給下一個中間件處理（靜態文件中間件）
    }
    
    const basePath = getBasePathFromRequest(req);
    
    // 檢測 Line 預覽
    const userAgent = req.get('User-Agent') || '';
    const isLineBot = userAgent.toLowerCase().includes('line-poker');
    
    if (isLineBot) {
        const baseUrl = buildBaseUrl(req, basePath);
        const previewImageUrl = baseUrl + 'preview1.png';
        return res.send(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>TinySecret - 安全聊天室</title>
    <meta property="og:title" content="TinySecret - 安全聊天室">
    <meta property="og:description" content="端對端加密的即時聊天，伺服器無法解密你的訊息">
    <meta property="og:image" content="${previewImageUrl}">
</head>
<body>
    <h1>TinySecret - 安全聊天室</h1>
    <p>端對端加密的即時聊天，伺服器無法解密你的訊息</p>
</body>
</html>
        `);
    }
    
    if (!rooms.has(roomId)) {
        // 構建完整的 base URL（考慮反向代理）
        const baseUrl = buildBaseUrl(req, basePath);
        
        // 返回錯誤頁面 HTML（使用白色卡片風格）
        return res.status(404).send(`
            <!DOCTYPE html>
            <html lang="zh-TW">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TinySecret - 房間不存在或已過期</title>
                <base href="${baseUrl}">
                <link rel="icon" type="image/png" href="favicon.png">
                <link rel="stylesheet" href="styles.css">
            </head>
            <body>
                <div class="container">
                    <div class="hero">
                        <h1>🔒 TinySecret</h1>
                    </div>
                    <div class="card" style="text-align: center;">
                        <h2 style="color: #00b900; margin-bottom: 20px;">房間不存在或已過期</h2>
                        <p class="description">無法加入聊天室</p>
                        <div class="status-box error">
                            <div class="status-icon">❌</div>
                            <h3>房間不存在或已過期</h3>
                        </div>
                        <button class="btn-primary" onclick="window.location.href = window.location.origin + '${basePath.replace(/\/$/, '')}'" style="margin-top: 30px;">返回首頁</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
    
    const html = renderHtmlTemplate(req, 'room.html');
    res.send(html);
});

// 聊天室頁面
app.get('/:roomId/:participantId', (req, res, next) => {
    const { roomId, participantId } = req.params;
    
    // 排除靜態文件和 API 路徑
    const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
    const isStaticFile = staticExtensions.some(ext => roomId.endsWith(ext) || participantId.endsWith(ext));
    const isApiPath = roomId.startsWith('api') || participantId.startsWith('api') || roomId.startsWith('socket.io');
    
    if (isStaticFile || isApiPath) {
        return next(); // 交給下一個中間件處理（靜態文件中間件）
    }
    
    const basePath = getBasePathFromRequest(req);
    
    // 檢測 Line 預覽
    const userAgent = req.get('User-Agent') || '';
    const isLineBot = userAgent.toLowerCase().includes('line-poker');
    
    if (isLineBot) {
        const baseUrl = buildBaseUrl(req, basePath);
        const previewImageUrl = baseUrl + 'preview2.png';
        return res.send(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>TinySecret - 加密聊天</title>
    <meta property="og:title" content="TinySecret - 加密聊天">
    <meta property="og:description" content="只有你和對方能解密的私密對話">
    <meta property="og:image" content="${previewImageUrl}">
</head>
<body>
    <h1>TinySecret - 加密聊天</h1>
    <p>只有你和對方能解密的私密對話</p>
</body>
</html>
        `);
    }
    
    if (!rooms.has(roomId)) {
        // 構建完整的 base URL（考慮反向代理）
        const baseUrl = buildBaseUrl(req, basePath);
        
        // 返回錯誤頁面 HTML（使用白色卡片風格）
        return res.status(404).send(`
            <!DOCTYPE html>
            <html lang="zh-TW">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TinySecret - 房間不存在或已過期</title>
                <base href="${baseUrl}">
                <link rel="icon" type="image/png" href="favicon.png">
                <link rel="stylesheet" href="styles.css">
            </head>
            <body>
                <div class="container">
                    <div class="hero">
                        <h1>🔒 TinySecret</h1>
                    </div>
                    <div class="card" style="text-align: center;">
                        <h2 style="color: #00b900; margin-bottom: 20px;">房間不存在或已過期</h2>
                        <p class="description">無法開啟聊天</p>
                        <div class="status-box error">
                            <div class="status-icon">❌</div>
                            <h3>房間不存在或已過期</h3>
                        </div>
                        <button class="btn-primary" onclick="window.location.href = window.location.origin + '${basePath.replace(/\/$/, '')}'" style="margin-top: 30px;">返回首頁</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
    
    const html = renderHtmlTemplate(req, 'chat.html');
    res.send(html);
});

// 靜態文件中間件（放在路由之後，避免攔截 HTML 文件）
app.use(express.static('public'));

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
        
        // 通知對方有新成員加入
        socket.to(`${roomId}-${participantId}`).emit('peer-online', { roomId, participantId });
    });
    
    // 處理 ping（表示用戶在線）
    socket.on('ping', ({ roomId, participantId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        updateRoomActivity(roomId);
        
        // 轉發給對方
        socket.to(`${roomId}-${participantId}`).emit('peer-ping', { roomId, participantId });
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
