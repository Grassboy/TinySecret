// RSA 加密解密工具函數

class CryptoHelper {
    // 生成 RSA 密鑰對
    static async generateKeyPair() {
        try {
            const keyPair = await window.crypto.subtle.generateKey(
                {
                    name: "RSA-OAEP",
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: "SHA-256"
                },
                true,
                ["encrypt", "decrypt"]
            );
            return keyPair;
        } catch (error) {
            console.error('生成密鑰對失敗:', error);
            throw error;
        }
    }

    // 將公鑰匯出為 base64 字串
    static async exportPublicKey(publicKey) {
        try {
            const exported = await window.crypto.subtle.exportKey(
                "spki",
                publicKey
            );
            const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported));
            const exportedAsBase64 = window.btoa(exportedAsString);
            return exportedAsBase64;
        } catch (error) {
            console.error('匯出公鑰失敗:', error);
            throw error;
        }
    }

    // 從 base64 字串匯入公鑰
    static async importPublicKey(base64Key) {
        try {
            const binaryString = window.atob(base64Key);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const publicKey = await window.crypto.subtle.importKey(
                "spki",
                bytes.buffer,
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256"
                },
                true,
                ["encrypt"]
            );
            return publicKey;
        } catch (error) {
            console.error('匯入公鑰失敗:', error);
            throw error;
        }
    }

    // 將私鑰匯出為 base64 字串
    static async exportPrivateKey(privateKey) {
        try {
            const exported = await window.crypto.subtle.exportKey(
                "pkcs8",
                privateKey
            );
            const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported));
            const exportedAsBase64 = window.btoa(exportedAsString);
            return exportedAsBase64;
        } catch (error) {
            console.error('匯出私鑰失敗:', error);
            throw error;
        }
    }

    // 從 base64 字串匯入私鑰
    static async importPrivateKey(base64Key) {
        try {
            const binaryString = window.atob(base64Key);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const privateKey = await window.crypto.subtle.importKey(
                "pkcs8",
                bytes.buffer,
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256"
                },
                true,
                ["decrypt"]
            );
            return privateKey;
        } catch (error) {
            console.error('匯入私鑰失敗:', error);
            throw error;
        }
    }

    // 使用公鑰加密訊息
    static async encryptMessage(message, publicKey) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            
            const encrypted = await window.crypto.subtle.encrypt(
                {
                    name: "RSA-OAEP"
                },
                publicKey,
                data
            );
            
            const encryptedArray = new Uint8Array(encrypted);
            const encryptedString = String.fromCharCode.apply(null, encryptedArray);
            const encryptedBase64 = window.btoa(encryptedString);
            
            return encryptedBase64;
        } catch (error) {
            console.error('加密失敗:', error);
            throw error;
        }
    }

    // 使用私鑰解密訊息
    static async decryptMessage(encryptedBase64, privateKey) {
        try {
            const binaryString = window.atob(encryptedBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: "RSA-OAEP"
                },
                privateKey,
                bytes.buffer
            );
            
            const decoder = new TextDecoder();
            const message = decoder.decode(decrypted);
            
            return message;
        } catch (error) {
            console.error('解密失敗:', error);
            throw error;
        }
    }

    // 儲存密鑰對到 localStorage
    static async saveKeyPairToStorage(keyPair, roomId, userId) {
        try {
            const publicKeyBase64 = await this.exportPublicKey(keyPair.publicKey);
            const privateKeyBase64 = await this.exportPrivateKey(keyPair.privateKey);
            
            const keyData = {
                publicKey: publicKeyBase64,
                privateKey: privateKeyBase64,
                roomId: roomId,
                userId: userId,
                timestamp: Date.now()
            };
            
            localStorage.setItem(`tinySecret_${roomId}_${userId}`, JSON.stringify(keyData));
            return true;
        } catch (error) {
            console.error('儲存密鑰失敗:', error);
            return false;
        }
    }

    // 從 localStorage 載入密鑰對
    static async loadKeyPairFromStorage(roomId, userId) {
        try {
            const keyDataString = localStorage.getItem(`tinySecret_${roomId}_${userId}`);
            if (!keyDataString) {
                return null;
            }
            
            const keyData = JSON.parse(keyDataString);
            
            const publicKey = await this.importPublicKey(keyData.publicKey);
            const privateKey = await this.importPrivateKey(keyData.privateKey);
            
            return {
                publicKey,
                privateKey,
                publicKeyBase64: keyData.publicKey
            };
        } catch (error) {
            console.error('載入密鑰失敗:', error);
            return null;
        }
    }

    // ==================== AES 加密功能 ====================
    
    // 生成 AES 密鑰
    static async generateAESKey() {
        try {
            const key = await window.crypto.subtle.generateKey(
                {
                    name: "AES-GCM",
                    length: 256
                },
                true,
                ["encrypt", "decrypt"]
            );
            return key;
        } catch (error) {
            console.error('生成 AES 密鑰失敗:', error);
            throw error;
        }
    }

    // 匯出 AES 密鑰為 base64
    static async exportAESKey(aesKey) {
        try {
            const exported = await window.crypto.subtle.exportKey("raw", aesKey);
            const exportedAsString = String.fromCharCode.apply(null, new Uint8Array(exported));
            const exportedAsBase64 = window.btoa(exportedAsString);
            return exportedAsBase64;
        } catch (error) {
            console.error('匯出 AES 密鑰失敗:', error);
            throw error;
        }
    }

    // 從 base64 匯入 AES 密鑰
    static async importAESKey(base64Key) {
        try {
            const binaryString = window.atob(base64Key);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            const key = await window.crypto.subtle.importKey(
                "raw",
                bytes.buffer,
                {
                    name: "AES-GCM",
                    length: 256
                },
                true,
                ["encrypt", "decrypt"]
            );
            return key;
        } catch (error) {
            console.error('匯入 AES 密鑰失敗:', error);
            throw error;
        }
    }

    // 使用 AES 加密數據
    static async encryptWithAES(data, aesKey) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            
            // 生成隨機 IV
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            const encrypted = await window.crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                aesKey,
                dataBuffer
            );
            
            // 組合 IV + 加密數據
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(encrypted), iv.length);
            
            // 轉為 base64
            const combinedString = String.fromCharCode.apply(null, combined);
            const combinedBase64 = window.btoa(combinedString);
            
            return combinedBase64;
        } catch (error) {
            console.error('AES 加密失敗:', error);
            throw error;
        }
    }

    // 使用 AES 解密數據
    static async decryptWithAES(encryptedBase64, aesKey) {
        try {
            // 從 base64 解碼
            const binaryString = window.atob(encryptedBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // 分離 IV 和加密數據
            const iv = bytes.slice(0, 12);
            const encryptedData = bytes.slice(12);
            
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                aesKey,
                encryptedData.buffer
            );
            
            const decoder = new TextDecoder();
            const data = decoder.decode(decrypted);
            
            return data;
        } catch (error) {
            console.error('AES 解密失敗:', error);
            throw error;
        }
    }
}

// 匯出為全域變數
window.CryptoHelper = CryptoHelper;

