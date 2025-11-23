// 房間頁面邏輯

const pathParts = window.location.pathname.split('/').filter(p => p);
const roomId = pathParts[pathParts.length - 1];

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

// 檢查是創建者還是參與者
// 必須同時滿足：1) role='creator' 2) 有對應的私鑰
const role = localStorage.getItem(`tinySecret_room_${roomId}_role`);
const privateKey = localStorage.getItem(`tinySecret_room_${roomId}_privateKey`);
const isCreator = role === 'creator' && privateKey !== null;

async function init() {
    if (isCreator) {
        await initCreator();
    } else {
        await initParticipant();
    }
}

async function initCreator() {
    document.getElementById('creatorView').style.display = 'block';
    
    // 顯示房間連結
    const roomUrl = window.location.href;
    document.getElementById('roomUrl').value = roomUrl;
    
    // 複製按鈕
    let copyTimeout = null;
    document.getElementById('copyBtn').addEventListener('click', () => {
        const input = document.getElementById('roomUrl');
        input.select();
        document.execCommand('copy');
        
        const btn = document.getElementById('copyBtn');
        
        // 清除之前的 timeout（如果有的話）
        if (copyTimeout) {
            clearTimeout(copyTimeout);
        }
        
        btn.textContent = '已複製！';
        btn.classList.add('copied');
        copyTimeout = setTimeout(() => {
            btn.textContent = '複製';
            btn.classList.remove('copied');
            copyTimeout = null;
        }, 2000);
    });
    
    // 等待參與者加入（可選：可以用 WebSocket 監聽）
}

async function initParticipant() {
    document.getElementById('participantView').style.display = 'block';
    
    try {
        // 1. 獲取房間創建者的公鑰
        document.getElementById('statusText').textContent = '獲取房間資訊...';
        
        const response = await fetch(`${window.location.origin}${basePath}api/room/${roomId}/creator-key`);
        
        if (!response.ok) {
            if (response.status === 404) {
                const errorText = await response.text();
                showErrorPage('房間不存在或已過期', errorText || '無法加入聊天室');
                return;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const { publicKey: creatorPublicKeyBase64 } = await response.json();
        const creatorPublicKey = await CryptoHelper.importPublicKey(creatorPublicKeyBase64);
        
        // 2. 生成自己的金鑰對
        document.getElementById('statusText').textContent = '生成金鑰...';
        const keyPair = await CryptoHelper.generateKeyPair();
        const myPublicKeyBase64 = await CryptoHelper.exportPublicKey(keyPair.publicKey);
        const myPrivateKeyBase64 = await CryptoHelper.exportPrivateKey(keyPair.privateKey);
        
        // 3. 混合加密：用房間主人的公鑰加密我的公鑰
        document.getElementById('statusText').textContent = '加密金鑰...';
        
        // 3.1 生成 AES 密鑰
        const aesKey = await CryptoHelper.generateAESKey();
        const aesKeyBase64 = await CryptoHelper.exportAESKey(aesKey);
        
        // 3.2 用 AES 加密我的 RSA 公鑰
        const encryptedMyPublicKey = await CryptoHelper.encryptWithAES(myPublicKeyBase64, aesKey);
        
        // 3.3 用房間主人的 RSA 公鑰加密 AES 密鑰
        const encryptedAESKey = await CryptoHelper.encryptMessage(aesKeyBase64, creatorPublicKey);
        
        // 4. 加入房間（發送加密的公鑰）
        document.getElementById('statusText').textContent = '加入聊天室...';
        const joinResponse = await fetch(`${window.location.origin}${basePath}api/room/${roomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                encryptedAESKey,           // 用房間主人 RSA 公鑰加密的 AES 密鑰
                encryptedPublicKey: encryptedMyPublicKey  // 用 AES 加密的我的 RSA 公鑰
            })
        });
        
        if (!joinResponse.ok) {
            if (joinResponse.status === 404) {
                const errorText = await joinResponse.text();
                showErrorPage('房間不存在或已過期', errorText || '無法加入聊天室');
                return;
            }
            throw new Error(`HTTP ${joinResponse.status}: ${joinResponse.statusText}`);
        }
        
        const { participantId, chatRoomUrl } = await joinResponse.json();
        
        // 5. 儲存金鑰和對方公鑰
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_myPrivateKey`, myPrivateKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_myPublicKey`, myPublicKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_peerPublicKey`, creatorPublicKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_role`, 'participant');
        
        // 6. 跳轉到聊天室（使用 base path）
        const fullChatUrl = window.location.origin + basePath.replace(/\/$/, '') + chatRoomUrl;
        window.location.href = fullChatUrl;
        
    } catch (error) {
        console.error('加入房間失敗:', error);
        // 顯示錯誤頁面（使用白色卡片風格）
        showErrorPage('房間不存在或已過期', '無法加入聊天室');
    }
}

function showErrorPage(title, description) {
    const basePath = getBasePath();
    document.body.innerHTML = `
        <!DOCTYPE html>
        <html lang="zh-TW">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TinySecret - ${title}</title>
            <link rel="stylesheet" href="${basePath}styles.css">
        </head>
        <body>
            <div class="container">
                <div class="hero">
                    <h1>🔒 TinySecret</h1>
                </div>
                <div class="card" style="text-align: center;">
                    <h2 style="color: #00b900; margin-bottom: 20px;">${title}</h2>
                    <p class="description">${description}</p>
                    <div class="status-box error">
                        <div class="status-icon">❌</div>
                        <h3>${title}</h3>
                    </div>
                    <button class="btn-primary" onclick="window.location.href = window.location.origin + '${basePath.replace(/\/$/, '')}'" style="margin-top: 30px;">返回首頁</button>
                </div>
            </div>
        </body>
        </html>
    `;
}

// 等待 DOM 載入完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM 已經載入完成
    init();
}
