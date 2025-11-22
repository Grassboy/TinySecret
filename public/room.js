// 房間頁面邏輯

const pathParts = window.location.pathname.split('/').filter(p => p);
const roomId = pathParts[pathParts.length - 1];

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
    document.getElementById('copyBtn').addEventListener('click', () => {
        const input = document.getElementById('roomUrl');
        input.select();
        document.execCommand('copy');
        
        const btn = document.getElementById('copyBtn');
        btn.textContent = '✓ 已複製';
        setTimeout(() => {
            btn.textContent = '複製';
        }, 2000);
    });
    
    // 等待參與者加入（可選：可以用 WebSocket 監聽）
}

async function initParticipant() {
    document.getElementById('participantView').style.display = 'block';
    
    try {
        // 1. 獲取房間創建者的公鑰
        document.getElementById('statusText').textContent = '獲取房間資訊...';
        
        const response = await fetch(`/api/room/${roomId}/creator-key`);
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
        const joinResponse = await fetch(`/api/room/${roomId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                encryptedAESKey,           // 用房間主人 RSA 公鑰加密的 AES 密鑰
                encryptedPublicKey: encryptedMyPublicKey  // 用 AES 加密的我的 RSA 公鑰
            })
        });
        
        const { participantId, chatRoomUrl } = await joinResponse.json();
        
        // 5. 儲存金鑰和對方公鑰
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_myPrivateKey`, myPrivateKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_myPublicKey`, myPublicKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_peerPublicKey`, creatorPublicKeyBase64);
        localStorage.setItem(`tinySecret_chat_${roomId}_${participantId}_role`, 'participant');
        
        // 6. 跳轉到聊天室
        window.location.href = chatRoomUrl;
        
    } catch (error) {
        console.error('加入房間失敗:', error);
        document.getElementById('statusText').textContent = '加入失敗: ' + error.message;
    }
}

init();
