// 聊天室邏輯

const pathParts = window.location.pathname.split('/').filter(p => p);
const roomId = pathParts[pathParts.length - 2];
const participantId = pathParts[pathParts.length - 1];

let myPrivateKey, myPublicKey, peerPublicKey;
let socket;

async function init() {
    try {
        // 判斷角色
        const creatorRole = localStorage.getItem(`tinySecret_room_${roomId}_role`);
        const participantRole = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_role`);
        
        const isCreator = creatorRole === 'creator';
        const isParticipant = participantRole === 'participant';
        
        if (!isCreator && !isParticipant) {
            // 顯示錯誤訊息
            document.body.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
                    <div style="text-align: center;">
                        <h2>❌ 無權訪問</h2>
                        <p style="color: #666;">您不是開啟房間的人，也不是受邀的對象，無法開啟聊天</p>
                    </div>
                </div>
            `;
            return;
        }
        
        if (isCreator) {
            await initCreator();
        } else if (isParticipant) {
            await initParticipant();
        }
        
        // 初始化 WebSocket
        initWebSocket();
        
        // 初始化輸入
        initInput();
        
    } catch (error) {
        console.error('初始化失敗:', error);
        showError('初始化失敗: ' + error.message);
    }
}

async function initCreator() {
    // 創建者：解密參與者的公鑰
    const myPrivateKeyBase64 = localStorage.getItem(`tinySecret_room_${roomId}_privateKey`);
    const myPublicKeyBase64 = localStorage.getItem(`tinySecret_room_${roomId}_publicKey`);
    
    if (!myPrivateKeyBase64 || !myPublicKeyBase64) {
        throw new Error('找不到金鑰');
    }
    
    myPrivateKey = await CryptoHelper.importPrivateKey(myPrivateKeyBase64);
    myPublicKey = await CryptoHelper.importPublicKey(myPublicKeyBase64);
    
    // 檢查是否已經解密過參與者公鑰
    let peerPublicKeyBase64 = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_peerPublicKey`);
    
    if (!peerPublicKeyBase64) {
        // 第一次進入：需要解密參與者的公鑰
        const response = await fetch(`/api/room/${roomId}/participant/${participantId}`);
        const { encryptedAESKey, encryptedPublicKey } = await response.json();
        
        // 1. 用我的私鑰解密 AES 密鑰
        const aesKeyBase64 = await CryptoHelper.decryptMessage(encryptedAESKey, myPrivateKey);
        const aesKey = await CryptoHelper.importAESKey(aesKeyBase64);
        
        // 2. 用 AES 密鑰解密參與者的公鑰
        peerPublicKeyBase64 = await CryptoHelper.decryptWithAES(encryptedPublicKey, aesKey);
        
        // 儲存解密後的對方公鑰
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_peerPublicKey`, peerPublicKeyBase64);
    }
    
    // 載入對方公鑰
    peerPublicKey = await CryptoHelper.importPublicKey(peerPublicKeyBase64);
}

async function initParticipant() {
    // 參與者：直接載入金鑰
    const myPrivateKeyBase64 = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_myPrivateKey`);
    const myPublicKeyBase64 = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_myPublicKey`);
    const peerPublicKeyBase64 = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_peerPublicKey`);
    
    if (!myPrivateKeyBase64 || !peerPublicKeyBase64) {
        throw new Error('找不到金鑰');
    }
    
    myPrivateKey = await CryptoHelper.importPrivateKey(myPrivateKeyBase64);
    myPublicKey = await CryptoHelper.importPublicKey(myPublicKeyBase64);
    peerPublicKey = await CryptoHelper.importPublicKey(peerPublicKeyBase64);
}

function initWebSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('WebSocket 已連接');
        document.getElementById('statusText').textContent = '已連接';
        document.querySelector('.status-dot').style.background = '#28a745';
        
        // 加入聊天室
        socket.emit('join-chat', { roomId, participantId });
    });
    
    socket.on('joined', () => {
        document.getElementById('sendBtn').disabled = false;
    });
    
    socket.on('new-message', async ({ encryptedAESKey, encryptedMessage, timestamp }) => {
        // 接收到加密訊息，解密並顯示
        try {
            // 1. 用我的 RSA 私鑰解密 AES 密鑰
            const aesKeyBase64 = await CryptoHelper.decryptMessage(encryptedAESKey, myPrivateKey);
            const aesKey = await CryptoHelper.importAESKey(aesKeyBase64);
            
            // 2. 用 AES 密鑰解密訊息
            const decryptedMessage = await CryptoHelper.decryptWithAES(encryptedMessage, aesKey);
            
            addMessage(decryptedMessage, false, timestamp);
        } catch (error) {
            console.error('解密失敗:', error);
            showError('解密失敗');
        }
    });
    
    socket.on('message-sent', ({ encryptedAESKey, encryptedMessage, timestamp }) => {
        // 自己發送的訊息確認（已在發送時顯示）
    });
    
    socket.on('disconnect', () => {
        console.log('WebSocket 已斷線');
        document.getElementById('statusText').textContent = '已斷線';
        document.querySelector('.status-dot').style.background = '#dc3545';
        document.getElementById('sendBtn').disabled = true;
    });
    
    socket.on('error', ({ message }) => {
        showError(message);
    });
}

function initInput() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    try {
        // 混合加密：為每條訊息生成隨機 AES 密鑰
        // 1. 生成隨機 AES 密鑰
        const aesKey = await CryptoHelper.generateAESKey();
        const aesKeyBase64 = await CryptoHelper.exportAESKey(aesKey);
        
        // 2. 用 AES 加密訊息（無長度限制）
        const encryptedMessage = await CryptoHelper.encryptWithAES(message, aesKey);
        
        // 3. 用對方的 RSA 公鑰加密 AES 密鑰（只有 32 字節）
        const encryptedAESKey = await CryptoHelper.encryptMessage(aesKeyBase64, peerPublicKey);
        
        // 發送：加密的 AES 密鑰 + AES 加密的訊息
        socket.emit('send-message', {
            roomId,
            participantId,
            encryptedAESKey,
            encryptedMessage
        });
        
        // 顯示自己的訊息
        addMessage(message, true, Date.now());
        
        // 清空輸入框
        input.value = '';
        
    } catch (error) {
        console.error('發送失敗:', error);
        showError('發送失敗: ' + error.message);
    }
}

function addMessage(text, isSelf, timestamp) {
    const container = document.getElementById('messagesContainer');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSelf ? 'message-self' : 'message-other'}`;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date(timestamp).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageDiv.appendChild(textDiv);
    messageDiv.appendChild(timeDiv);
    container.appendChild(messageDiv);
    
    // 滾動到底部
    container.scrollTop = container.scrollHeight;
}

function showError(message) {
    const container = document.getElementById('messagesContainer');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'system-message error';
    errorDiv.textContent = '❌ ' + message;
    container.appendChild(errorDiv);
}

init();

