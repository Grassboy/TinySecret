// 聊天室邏輯

const pathParts = window.location.pathname.split('/').filter(p => p);
const roomId = pathParts[pathParts.length - 2];
const participantId = pathParts[pathParts.length - 1];

// 獲取 base path（例如：/tinySecret/ 或 /）
function getBasePath() {
    const base = document.querySelector('base');
    if (base) {
        const href = base.getAttribute('href');
        // 從完整 URL 中提取路徑部分
        try {
            const url = new URL(href, window.location.origin);
            const path = url.pathname;
            return path.endsWith('/') ? path : path + '/';
        } catch (e) {
            // 如果解析失敗，假設 href 已經是路徑
            return href.endsWith('/') ? href : href + '/';
        }
    }
    // 如果沒有 base tag，從 pathname 推斷
    const path = window.location.pathname;
    const parts = path.split('/').filter(p => p);
    if (parts.length > 0) {
        return '/' + parts[0] + '/';
    }
    return '/';
}

const basePath = getBasePath();

let myPrivateKey, myPublicKey, peerPublicKey;
let socket;
let peerOnline = false;
let peerOfflineTimer;
let offlineNoticeElement = null;
let isPageVisible = true;
let lastMessageSentTime = 0; // 記錄最後發送消息的時間
let lastSentMessageElement = null; // 記錄最後發送的消息元素

async function init() {
    try {
        // 等待 Socket.IO 載入
        let retries = 0;
        while (typeof io === 'undefined' && retries < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }
        
        if (typeof io === 'undefined') {
            console.error('Socket.IO 載入超時');
            showError('Socket.IO 載入失敗，請重新整理頁面');
            return;
        }
        
        // 判斷角色
        const creatorRole = localStorage.getItem(`tinySecret_room_${roomId}_role`);
        const participantRole = localStorage.getItem(`tinySecret_chat_${roomId}_${participantId}_role`);
        
        const isCreator = creatorRole === 'creator';
        const isParticipant = participantRole === 'participant';
        
        if (!isCreator && !isParticipant) {
            // 顯示錯誤訊息（使用白色卡片風格，比照 room.html 的風格）
            const basePath = getBasePath();
            // 移除 chat-page class，恢復正常的 body padding
            document.body.className = '';
            document.body.innerHTML = `
                <div class="container">
                    <div class="hero">
                        <h1>🔒 TinySecret</h1>
                    </div>
                    <div class="card" style="text-align: center;">
                        <h2 style="color: #00b900; margin-bottom: 20px;">無權訪問</h2>
                        <p class="description">您不是開啟房間的人，也不是受邀的對象，無法開啟聊天</p>
                        <div class="status-box error">
                            <div class="status-icon">❌</div>
                            <h3>無法開啟聊天</h3>
                        </div>
                        <button class="btn-primary" onclick="window.location.href = window.location.origin + '${basePath.replace(/\/$/, '')}'" style="margin-top: 30px;">返回首頁</button>
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
        
        // 初始化文件上傳
        initFileUpload();
        
        // 初始化離開按鈕
        initExitButton();
        
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
        const response = await fetch(`${window.location.origin}${basePath}api/room/${roomId}/participant/${participantId}`);
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
    // 檢查 Socket.IO 是否已載入
    if (typeof io === 'undefined') {
        console.error('Socket.IO 未載入');
        showError('Socket.IO 未載入，請重新整理頁面');
        return;
    }
    
    // 計算 Socket.IO 路徑
    // basePath 例如：'/tinySecret/' 或 '/'
    // Socket.IO 的 path 選項需要是完整路徑，例如：'/tinySecret/socket.io' 或 '/socket.io'
    const socketPath = basePath.replace(/\/$/, '') + '/socket.io';
    console.log('Base Path:', basePath);
    console.log('Socket.IO 路徑:', socketPath);
    console.log('當前 URL:', window.location.href);
    
    socket = io({
        path: socketPath,
        transports: ['websocket'],  // 只使用 WebSocket，禁用 polling
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: true,
        upgrade: false,  // 禁用升級（因為只有 websocket）
        rememberUpgrade: false
    });
    
    // 添加所有事件監聽以便調試
    socket.on('connect', () => {
        console.log('✅ WebSocket 已連接，Socket ID:', socket.id);
        console.log('✅ 傳輸方式:', socket.io.engine.transport.name);
        updateStatus();
        
        // 加入聊天室
        socket.emit('join-chat', { roomId, participantId });
        
        // 進入聊天室時發送一次 ping（只有在頁面可見時才發送）
        if (isPageVisible) {
            socket.emit('ping', { roomId, participantId });
        }
    });
    
    // 監聽頁面可見性變化
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        
        if (!isPageVisible) {
            // 頁面隱藏時，不應該回 ping
            console.log('📱 頁面已隱藏，停止自動回 ping');
        } else {
            // 頁面重新可見時，發送一次 ping 告知對方我回來了
            if (socket && socket.connected) {
                console.log('📱 頁面重新可見，發送 ping');
                socket.emit('ping', { roomId, participantId });
            }
        }
    });
    
    // 監聽頁面卸載（關閉或刷新）
    window.addEventListener('beforeunload', () => {
        // 頁面即將關閉，不需要特別處理，WebSocket 會自動斷開
        console.log('📱 頁面即將關閉');
    });
    
    function updateStatus() {
        const statusText = document.getElementById('statusText');
        const statusDot = document.querySelector('.status-dot');
        
        if (socket && socket.connected) {
            statusDot.classList.add('connected');
            statusDot.classList.remove('disconnected');
            
            if (peerOnline) {
                // 對方已連接 - 綠燈
                statusText.textContent = '已連接 · 對方已連接';
                statusDot.style.background = '#28a745';
                // 隱藏離線提示
                hideOfflineNotice();
            } else {
                // 對方連接中 - 黃燈
                statusText.textContent = '已連接 · 對方連接中';
                statusDot.style.background = '#ffc107';
                // 顯示離線提示
                showOfflineNotice();
            }
        } else {
            statusText.textContent = '連接中...';
            statusDot.style.background = '#ffc107';
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
            // 隱藏離線提示（因為自己還沒連接）
            hideOfflineNotice();
        }
    }
    
    let copyTimeout = null;
    
    function showOfflineNotice() {
        // 如果已經顯示，就不重複創建
        if (offlineNoticeElement && offlineNoticeElement.parentNode) {
            return;
        }
        
        const container = document.getElementById('messagesContainer');
        
        // 創建系統消息容器
        const noticeDiv = document.createElement('div');
        noticeDiv.className = 'system-message offline-notice';
        
        // 提示文字
        const textDiv = document.createElement('div');
        textDiv.textContent = '對方尚未上線，請將下方聊天連結複製丟給對方，對方也連上後才能互相交談喲';
        textDiv.style.marginBottom = '12px';
        noticeDiv.appendChild(textDiv);
        
        // 連結輸入框和複製按鈕容器
        const linkContainer = document.createElement('div');
        linkContainer.style.display = 'flex';
        linkContainer.style.gap = '8px';
        linkContainer.style.alignItems = 'center';
        
        // 輸入框
        const input = document.createElement('input');
        input.type = 'text';
        input.value = window.location.href;
        input.readOnly = true;
        input.style.flex = '1';
        input.style.padding = '8px';
        input.style.borderRadius = '4px';
        input.style.border = '1px solid #ddd';
        input.style.backgroundColor = '#f5f5f5';
        linkContainer.appendChild(input);
        
        // 複製按鈕
        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn-copy';
        copyBtn.textContent = '複製';
        copyBtn.onclick = () => {
            input.select();
            document.execCommand('copy');
            
            // 清除之前的 timeout（如果有的話）
            if (copyTimeout) {
                clearTimeout(copyTimeout);
            }
            
            // 短暫顯示複製成功提示
            const originalText = '複製';
            copyBtn.textContent = '已複製！';
            copyBtn.classList.add('copied');
            copyTimeout = setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('copied');
                copyTimeout = null;
            }, 2000);
        };
        linkContainer.appendChild(copyBtn);
        
        noticeDiv.appendChild(linkContainer);
        container.appendChild(noticeDiv);
        
        // 保存引用以便後續操作
        offlineNoticeElement = noticeDiv;
        
        // 滾動到底部
        container.scrollTop = container.scrollHeight;
    }
    
    function hideOfflineNotice() {
        if (offlineNoticeElement && offlineNoticeElement.parentNode) {
            offlineNoticeElement.remove();
            offlineNoticeElement = null;
        }
    }
    
    socket.on('connect_error', (error) => {
        console.error('❌ WebSocket 連接錯誤:', error);
        console.error('❌ 錯誤詳情:', {
            message: error.message,
            type: error.type,
            description: error.description,
            context: error.context
        });
        console.error('❌ 嘗試連接的路徑:', socketPath);
        showError('連接失敗: ' + error.message);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('⚠️ WebSocket 斷線:', reason);
        if (peerOfflineTimer) {
            clearTimeout(peerOfflineTimer);
            peerOfflineTimer = null;
        }
        peerOnline = false;
        updateStatus();
    });
    
    socket.on('reconnect_attempt', () => {
        console.log('🔄 嘗試重新連接...');
    });
    
    socket.on('reconnect_failed', () => {
        console.error('❌ 重新連接失敗');
    });
    
    socket.on('joined', () => {
        // 不直接啟用按鈕，讓輸入框監聽器根據內容決定
        // 按鈕狀態由輸入框內容決定
        updateStatus();
    });
    
    // 收到對方在線通知
    socket.on('peer-online', () => {
        peerOnline = true;
        updateStatus();
    });
    
    // 收到對方的 ping
    socket.on('peer-ping', () => {
        peerOnline = true;
        updateStatus();
        
        // 重置超時計時器（5秒沒收到 ping 就認為對方可能離線）
        if (peerOfflineTimer) {
            clearTimeout(peerOfflineTimer);
        }
        peerOfflineTimer = setTimeout(() => {
            peerOnline = false;
            updateStatus();
        }, 5000);
        
        // 判斷這個 ping 是否是收到消息後的回 ping
        // 如果最近 3 秒內發送過消息，則認為這是收到消息後的回 ping，只標記最近發送的消息為已讀
        const now = Date.now();
        if (lastMessageSentTime > 0 && (now - lastMessageSentTime) < 3000 && lastSentMessageElement) {
            // 這是收到消息後的回 ping，只標記最近發送的那條消息為已讀
            const timeElement = lastSentMessageElement.querySelector('.message-time');
            if (timeElement && !timeElement.classList.contains('read')) {
                timeElement.classList.add('read');
            }
            lastMessageSentTime = 0; // 重置，避免重複標記
            lastSentMessageElement = null; // 重置
        }
        // 否則，這可能是重新上線的 ping，不標記已讀
        
        // 回送 ping 給對方，讓對方也能更新狀態（只有在頁面可見時才回 ping）
        if (isPageVisible && socket && socket.connected) {
            socket.emit('ping', { roomId, participantId });
        }
    });
    
    socket.on('new-message', async ({ encryptedAESKey, encryptedMessage, timestamp }) => {
        // 接收到加密訊息，解密並顯示
        try {
            // 1. 用我的 RSA 私鑰解密 AES 密鑰
            const aesKeyBase64 = await CryptoHelper.decryptMessage(encryptedAESKey, myPrivateKey);
            const aesKey = await CryptoHelper.importAESKey(aesKeyBase64);
            
            // 2. 用 AES 密鑰解密訊息
            const decryptedMessageJson = await CryptoHelper.decryptWithAES(encryptedMessage, aesKey);
            
            // 3. 嘗試解析為 JSON（文件消息），如果失敗則當作文本消息
            let messageObj;
            try {
                messageObj = JSON.parse(decryptedMessageJson);
            } catch (e) {
                // 舊格式或純文本，直接當作文本消息
                addMessage(decryptedMessageJson, false, timestamp);
                if (isPageVisible && socket && socket.connected) {
                    socket.emit('ping', { roomId, participantId });
                }
                return;
            }
            
            // 4. 根據消息類型處理
            if (messageObj.type === 'file') {
                // 文件消息
                if (messageObj.totalChunks > 1) {
                    // 分段文件，需要重組
                    handleFileChunk(messageObj);
                } else {
                    // 單塊文件，直接顯示
                    addFileMessageFromBase64({
                        fileName: messageObj.fileName,
                        fileType: messageObj.fileType,
                        fileSize: messageObj.fileSize,
                        isImage: messageObj.isImage
                    }, messageObj.content, false, timestamp);
                }
            } else {
                // 文本消息
                addMessage(messageObj.content || decryptedMessageJson, false, timestamp);
            }
            
            // 收到訊息後回 ping 給對方（只有在頁面可見時才回 ping）
            // 對方收到這個 ping 後，會判斷是否在收到消息後 3 秒內，如果是則標記為已讀
            if (isPageVisible && socket && socket.connected) {
                socket.emit('ping', { roomId, participantId });
            }
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
    
    // 根據輸入內容更新按鈕狀態
    function updateSendButton() {
        const hasText = input.value.trim().length > 0;
        sendBtn.disabled = !hasText;
    }
    
    // 自動調整輸入框高度
    function autoResizeTextarea() {
        // 重置高度以獲取正確的 scrollHeight
        input.style.height = 'auto';
        // 設置新高度，但不超過 max-height
        const newHeight = Math.min(input.scrollHeight, 120);
        input.style.height = newHeight + 'px';
    }
    
    // 監聽輸入變化
    input.addEventListener('input', () => {
        updateSendButton();
        autoResizeTextarea();
    });
    
    sendBtn.addEventListener('click', sendMessage);
    
    input.addEventListener('keydown', (e) => {
        // Ctrl+Enter 或 Cmd+Enter 發送訊息
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!sendBtn.disabled) {
                sendMessage();
            }
        }
        // Enter 鍵預設為換行（不阻止默認行為）
    });
    
    // 初始化按鈕狀態和輸入框高度
    updateSendButton();
    autoResizeTextarea();
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
        const messageElement = addMessage(message, true, Date.now());
        
        // 記錄發送消息的時間和元素，用於判斷後續的 peer-ping 是否是收到消息後的回 ping
        lastMessageSentTime = Date.now();
        lastSentMessageElement = messageElement;
        
        // 清空輸入框
        input.value = '';
        // 重置輸入框高度
        input.style.height = 'auto';
        // 更新按鈕狀態（變回灰色）
        const sendBtn = document.getElementById('sendBtn');
        sendBtn.disabled = true;
        // 將焦點設回輸入框
        input.focus();
        
    } catch (error) {
        console.error('發送失敗:', error);
        showError('發送失敗: ' + error.message);
    }
}

function addMessage(text, isSelf, timestamp) {
    const container = document.getElementById('messagesContainer');
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${isSelf ? 'message-self' : 'message-other'}`;
    
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
    messageWrapper.appendChild(messageDiv);
    messageWrapper.appendChild(timeDiv);
    container.appendChild(messageWrapper);
    
    // 滾動到底部
    container.scrollTop = container.scrollHeight;
    
    // 返回消息元素，以便後續操作
    return messageWrapper;
}

function markMessagesAsRead() {
    // 找到所有自己發送的消息中，尚未標記為已讀的
    const selfMessages = document.querySelectorAll('.message-wrapper.message-self .message-time:not(.read)');
    selfMessages.forEach(timeDiv => {
        timeDiv.classList.add('read');
    });
}

function showError(message) {
    const container = document.getElementById('messagesContainer');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'system-message error';
    errorDiv.textContent = '❌ ' + message;
    container.appendChild(errorDiv);
}

// 文件上傳相關變量
const CHUNK_SIZE = 100 * 1024; // 100KB 每塊
const pendingFileChunks = new Map(); // 存儲待重組的文件塊

function initFileUpload() {
    const fileInput = document.getElementById('fileInput');
    const fileUploadBtn = document.getElementById('fileUploadBtn');
    
    if (!fileInput || !fileUploadBtn) return;
    
    // 點擊上傳按鈕觸發文件選擇
    fileUploadBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    // 處理文件選擇
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        for (const file of files) {
            try {
                await sendFile(file);
            } catch (error) {
                console.error('文件發送失敗:', error);
                showError('文件發送失敗: ' + error.message);
            }
        }
        
        // 清空文件選擇
        fileInput.value = '';
    });
}

// 將文件轉換為 Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // 移除 data URL 前綴（data:image/png;base64,）
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 判斷是否為圖片文件
function isImageFile(fileName) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return imageExtensions.includes(ext);
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 發送文件（支持分段傳輸）
async function sendFile(file) {
    try {
        // 將文件轉換為 base64
        const fileBase64 = await fileToBase64(file);
        
        // 構建文件消息對象
        const fileMessage = {
            type: 'file',
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            isImage: isImageFile(file.name),
            totalChunks: 1,
            chunkIndex: 0,
            content: fileBase64
        };
        
        // 如果文件太大，需要分段傳輸
        if (fileBase64.length > CHUNK_SIZE) {
            const totalChunks = Math.ceil(fileBase64.length / CHUNK_SIZE);
            fileMessage.totalChunks = totalChunks;
            
            // 先顯示上傳中的消息（如果是圖片，先顯示文件名，完成後再更新為圖片）
            let messageElement = null;
            if (isImageFile(file.name)) {
                // 圖片：先顯示文件名，完成後更新為圖片
                messageElement = addFileMessage(file, true, Date.now(), true);
            } else {
                // 非圖片：顯示上傳中
                messageElement = addFileMessage(file, true, Date.now(), true);
            }
            
            // 分段發送
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, fileBase64.length);
                const chunk = fileBase64.substring(start, end);
                
                const chunkMessage = {
                    ...fileMessage,
                    chunkIndex: i,
                    content: chunk
                };
                
                await sendFileChunk(chunkMessage);
            }
            
            // 發送完成後，如果是圖片，更新顯示為圖片
            if (isImageFile(file.name) && messageElement) {
                updateFileMessageToImage(messageElement, file);
            } else if (messageElement) {
                // 非圖片：更新為完成狀態
                updateFileMessageComplete(messageElement, file);
            }
        } else {
            // 小文件直接發送
            await sendFileChunk(fileMessage);
            // 顯示自己的文件消息（圖片會直接顯示）
            addFileMessage(file, true, Date.now());
        }
        
        // 記錄發送消息的時間和元素
        lastMessageSentTime = Date.now();
        
    } catch (error) {
        console.error('文件發送失敗:', error);
        showError('文件發送失敗: ' + error.message);
        throw error;
    }
}

// 發送文件塊（加密並發送）
async function sendFileChunk(fileMessage) {
    try {
        // 將消息對象轉換為 JSON 字符串
        const messageJson = JSON.stringify(fileMessage);
        
        // 混合加密：為每條訊息生成隨機 AES 密鑰
        // 1. 生成隨機 AES 密鑰
        const aesKey = await CryptoHelper.generateAESKey();
        const aesKeyBase64 = await CryptoHelper.exportAESKey(aesKey);
        
        // 2. 用 AES 加密訊息（無長度限制）
        const encryptedMessage = await CryptoHelper.encryptWithAES(messageJson, aesKey);
        
        // 3. 用對方的 RSA 公鑰加密 AES 密鑰（只有 32 字節）
        const encryptedAESKey = await CryptoHelper.encryptMessage(aesKeyBase64, peerPublicKey);
        
        // 發送：加密的 AES 密鑰 + AES 加密的訊息
        socket.emit('send-message', {
            roomId,
            participantId,
            encryptedAESKey,
            encryptedMessage
        });
    } catch (error) {
        console.error('文件塊發送失敗:', error);
        throw error;
    }
}

// 添加文件消息到聊天界面
function addFileMessage(file, isSelf, timestamp, isUploading = false) {
    const container = document.getElementById('messagesContainer');
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${isSelf ? 'message-self' : 'message-other'}`;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-file ${isSelf ? 'message-self' : 'message-other'}`;
    messageDiv.dataset.fileName = file.name; // 保存文件名以便後續更新
    
    if (isImageFile(file.name) && !isUploading) {
        // 圖片直接顯示
        const img = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        img.className = 'message-file-image';
        img.dataset.imageSrc = objectUrl; // 保存原始 URL 用於全屏查看
        img.dataset.fileName = file.name; // 保存文件名用於下載
        img.style.cursor = 'pointer'; // 添加指針樣式
        img.onload = () => {
            // 不立即 revoke，因為可能需要用於全屏查看和下載
        };
        // 添加點擊事件，顯示全屏查看器
        img.addEventListener('click', () => {
            showImageViewer(objectUrl, file.name);
        });
        messageDiv.appendChild(img);
    } else {
        // 非圖片或上傳中：顯示文件名和大小
        const fileInfo = document.createElement('div');
        fileInfo.className = 'message-file-info';
        
        const fileName = document.createElement('div');
        fileName.className = 'message-file-name';
        fileName.textContent = file.name;
        
        const fileSize = document.createElement('div');
        fileSize.className = 'message-file-size';
        fileSize.textContent = isUploading ? '上傳中...' : formatFileSize(file.size);
        
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileSize);
        
        if (!isUploading) {
            // 創建下載鏈接
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(file);
            downloadLink.download = file.name;
            downloadLink.className = 'message-file-download';
            downloadLink.textContent = '📥 下載';
            downloadLink.onclick = () => {
                setTimeout(() => URL.revokeObjectURL(downloadLink.href), 100);
            };
            fileInfo.appendChild(downloadLink);
        }
        
        messageDiv.appendChild(fileInfo);
    }
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date(timestamp).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageWrapper.appendChild(messageDiv);
    messageWrapper.appendChild(timeDiv);
    container.appendChild(messageWrapper);
    
    // 滾動到底部
    container.scrollTop = container.scrollHeight;
    
    // 返回消息元素
    return messageWrapper;
}

// 更新文件消息為圖片顯示（用於大文件上傳完成後）
function updateFileMessageToImage(messageWrapper, file) {
    const messageDiv = messageWrapper.querySelector('.message-file');
    if (!messageDiv) return;
    
    // 清空現有內容
    messageDiv.innerHTML = '';
    
    // 創建圖片元素
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    img.className = 'message-file-image';
    img.dataset.imageSrc = objectUrl; // 保存原始 URL 用於全屏查看
    img.dataset.fileName = file.name; // 保存文件名用於下載
    img.style.cursor = 'pointer'; // 添加指針樣式
    // 添加點擊事件，顯示全屏查看器
    img.addEventListener('click', () => {
        showImageViewer(objectUrl, file.name);
    });
    messageDiv.appendChild(img);
}

// 更新文件消息為完成狀態（用於非圖片文件上傳完成後）
function updateFileMessageComplete(messageWrapper, file) {
    const messageDiv = messageWrapper.querySelector('.message-file');
    if (!messageDiv) return;
    
    const fileSize = messageDiv.querySelector('.message-file-size');
    if (fileSize) {
        fileSize.textContent = formatFileSize(file.size);
    }
    
    // 添加下載鏈接（如果還沒有）
    const fileInfo = messageDiv.querySelector('.message-file-info');
    if (fileInfo && !fileInfo.querySelector('.message-file-download')) {
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(file);
        downloadLink.download = file.name;
        downloadLink.className = 'message-file-download';
        downloadLink.textContent = '📥 下載';
        downloadLink.onclick = () => {
            setTimeout(() => URL.revokeObjectURL(downloadLink.href), 100);
        };
        fileInfo.appendChild(downloadLink);
    }
}

// 從 Base64 添加文件消息（接收到的文件）
function addFileMessageFromBase64(fileInfo, fileBase64, isSelf, timestamp) {
    const container = document.getElementById('messagesContainer');
    const messageWrapper = document.createElement('div');
    messageWrapper.className = `message-wrapper ${isSelf ? 'message-self' : 'message-other'}`;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-file ${isSelf ? 'message-self' : 'message-other'}`;
    
    if (fileInfo.isImage) {
        // 圖片直接顯示
        const img = document.createElement('img');
        const imageSrc = 'data:' + fileInfo.fileType + ';base64,' + fileBase64;
        img.src = imageSrc;
        img.className = 'message-file-image';
        img.dataset.imageSrc = imageSrc; // 保存原始 URL 用於全屏查看
        img.dataset.fileName = fileInfo.fileName; // 保存文件名用於下載
        img.dataset.fileBase64 = fileBase64; // 保存 base64 用於下載
        img.dataset.fileType = fileInfo.fileType; // 保存文件類型用於下載
        img.style.cursor = 'pointer'; // 添加指針樣式
        // 添加點擊事件，顯示全屏查看器
        img.addEventListener('click', () => {
            showImageViewer(imageSrc, fileInfo.fileName, fileBase64, fileInfo.fileType);
        });
        messageDiv.appendChild(img);
    } else {
        // 非圖片：顯示文件名和大小，提供下載
        const fileInfoDiv = document.createElement('div');
        fileInfoDiv.className = 'message-file-info';
        
        const fileName = document.createElement('div');
        fileName.className = 'message-file-name';
        fileName.textContent = fileInfo.fileName;
        
        const fileSize = document.createElement('div');
        fileSize.className = 'message-file-size';
        fileSize.textContent = formatFileSize(fileInfo.fileSize);
        
        // 創建下載鏈接
        const downloadLink = document.createElement('a');
        downloadLink.href = 'data:' + fileInfo.fileType + ';base64,' + fileBase64;
        downloadLink.download = fileInfo.fileName;
        downloadLink.className = 'message-file-download';
        downloadLink.textContent = '📥 下載';
        fileInfoDiv.appendChild(fileName);
        fileInfoDiv.appendChild(fileSize);
        fileInfoDiv.appendChild(downloadLink);
        
        messageDiv.appendChild(fileInfoDiv);
    }
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date(timestamp).toLocaleTimeString('zh-TW', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageWrapper.appendChild(messageDiv);
    messageWrapper.appendChild(timeDiv);
    container.appendChild(messageWrapper);
    
    // 滾動到底部
    container.scrollTop = container.scrollHeight;
    
    return messageWrapper;
}

// 處理接收到的文件塊（重組）
function handleFileChunk(fileMessage) {
    const fileId = `${fileMessage.fileName}-${fileMessage.fileSize}`;
    
    if (!pendingFileChunks.has(fileId)) {
        // 創建新的文件塊緩存
        pendingFileChunks.set(fileId, {
            fileName: fileMessage.fileName,
            fileType: fileMessage.fileType,
            fileSize: fileMessage.fileSize,
            isImage: fileMessage.isImage,
            totalChunks: fileMessage.totalChunks,
            chunks: new Array(fileMessage.totalChunks).fill(null),
            receivedChunks: 0
        });
    }
    
    const fileData = pendingFileChunks.get(fileId);
    fileData.chunks[fileMessage.chunkIndex] = fileMessage.content;
    fileData.receivedChunks++;
    
    // 檢查是否所有塊都已收到
    if (fileData.receivedChunks === fileData.totalChunks) {
        // 重組文件
        const completeBase64 = fileData.chunks.join('');
        
        // 顯示文件
        addFileMessageFromBase64({
            fileName: fileData.fileName,
            fileType: fileData.fileType,
            fileSize: fileData.fileSize,
            isImage: fileData.isImage
        }, completeBase64, false, Date.now());
        
        // 清理緩存
        pendingFileChunks.delete(fileId);
    }
}

// 顯示全屏圖片查看器
function showImageViewer(imageSrc, fileName, fileBase64 = null, fileType = null) {
    const viewer = document.getElementById('imageViewer');
    const img = document.getElementById('imageViewerImg');
    const downloadBtn = document.getElementById('imageViewerDownload');
    const closeBtn = document.getElementById('imageViewerClose');
    
    if (!viewer || !img) return;
    
    // 設置圖片源
    img.src = imageSrc;
    img.alt = fileName;
    
    // 設置下載功能
    downloadBtn.onclick = () => {
        if (fileBase64 && fileType) {
            // 從 base64 下載
            const link = document.createElement('a');
            link.href = 'data:' + fileType + ';base64,' + fileBase64;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            // 從 URL 下載（Blob URL）
            fetch(imageSrc)
                .then(res => res.blob())
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                })
                .catch(err => {
                    console.error('下載失敗:', err);
                    showError('下載失敗');
                });
        }
    };
    
    // 關閉按鈕
    closeBtn.onclick = () => {
        hideImageViewer();
    };
    
    // 點擊背景關閉
    const backdrop = viewer.querySelector('.image-viewer-backdrop');
    backdrop.onclick = () => {
        hideImageViewer();
    };
    
    // ESC 鍵關閉
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            hideImageViewer();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
    
    // 顯示查看器
    viewer.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // 防止背景滾動
}

// 隱藏全屏圖片查看器
function hideImageViewer() {
    const viewer = document.getElementById('imageViewer');
    if (viewer) {
        viewer.style.display = 'none';
        document.body.style.overflow = ''; // 恢復背景滾動
    }
}

function initExitButton() {
    const exitBtn = document.getElementById('exitBtn');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            // 獲取 base path
            const basePath = getBasePath();
            // 跳轉到首頁
            window.location.href = window.location.origin + basePath.replace(/\/$/, '');
        });
    }
}

// 等待 DOM 載入完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM 已經載入完成
    init();
}

