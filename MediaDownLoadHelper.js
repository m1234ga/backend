"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
require('dotenv').config();
const process_1 = require("process");
const WuzURL = process_1.env.WUZAPI;
const WuzToken = process_1.env.WUZAPI_Token;
function DownLoadHelper() {
    async function saveImageBase64FromApi(message) {
        try {
            const isSticker = !!message.Message.stickerMessage;
            const mediaInfo = message.Message.imageMessage || message.Message.stickerMessage;
            if (!mediaInfo)
                return;
            const endpoint = '/chat/downloadimage';
            const response = await axios_1.default.post(WuzURL + endpoint, {
                Url: mediaInfo.URL,
                DirectPath: mediaInfo.directPath,
                MediaKey: mediaInfo.mediaKey,
                Mimetype: mediaInfo.mimetype,
                FileEncSHA256: mediaInfo.fileEncSHA256,
                FileSHA256: mediaInfo.fileSHA256,
                FileLength: mediaInfo.fileLength
            }, {
                headers: {
                    token: WuzToken,
                    'Content-Type': 'application/json'
                }
            });
            // Base64 data
            const base64Data = response.data.data.Data || response.data.data;
            const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
            // Detect extension
            const extension = response.data.Mimetype?.split('/')[1] || (isSticker ? 'webp' : 'jpeg');
            const saveDir = path_1.default.join(__dirname, 'imgs');
            if (!fs_1.default.existsSync(saveDir)) {
                fs_1.default.mkdirSync(saveDir, { recursive: true });
            }
            // Save file to backend/imgs/ID.extension
            const savePath = path_1.default.join(saveDir, `${message.Info.ID}.${extension}`);
            fs_1.default.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`✅ ${isSticker ? 'Sticker' : 'Image'} saved at: ${savePath}`);
        }
        catch (err) {
            console.error(`Error saving ${message.Message.stickerMessage ? 'sticker' : 'image'}:`, err.message);
        }
    }
    async function saveDocumentFromApi(message) {
        try {
            const documentInfo = message.Message.documentMessage;
            if (!documentInfo)
                return;
            const response = await axios_1.default.post(WuzURL + '/chat/downloaddocument', {
                Url: documentInfo.URL,
                DirectPath: documentInfo.directPath,
                MediaKey: documentInfo.mediaKey,
                Mimetype: documentInfo.mimetype,
                FileEncSHA256: documentInfo.fileEncSHA256,
                FileSHA256: documentInfo.fileSHA256,
                FileLength: documentInfo.fileLength
            }, {
                headers: {
                    token: WuzToken,
                    'Content-Type': 'application/json'
                }
            });
            const base64Data = response.data.data.Data || response.data.data;
            const cleanBase64 = base64Data.split(',')[1] || base64Data;
            const saveDir = path_1.default.join(__dirname, 'docs');
            if (!fs_1.default.existsSync(saveDir)) {
                fs_1.default.mkdirSync(saveDir, { recursive: true });
            }
            // Use the provided filename or default to ID
            const fileName = documentInfo.fileName || `${message.Info.ID}.${documentInfo.mimetype?.split('/')[1] || 'bin'}`;
            const savePath = path_1.default.join(saveDir, fileName);
            fs_1.default.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`📄 Document saved at: ${savePath}`);
        }
        catch (err) {
            console.error('Error saving document:', err.message);
        }
    }
    async function saveAudioFromApi(message) {
        try {
            var audioInfo = message.Message.audioMessage;
            var response = await axios_1.default.post(WuzURL + '/chat/downloadaudio', {
                Url: audioInfo.URL,
                DirectPath: audioInfo.directPath,
                MediaKey: audioInfo.mediaKey,
                Mimetype: audioInfo.mimetype,
                FileEncSHA256: audioInfo.fileEncSHA256,
                FileSHA256: audioInfo.fileSHA256,
                FileLength: audioInfo.fileLength
            }, {
                headers: {
                    token: WuzToken,
                    'Content-Type': 'application/json'
                }
            });
            var base64Data = response.data.data.Data;
            var cleanBase64 = base64Data.split(',')[1];
            var extension = 'ogg';
            var savePath = path_1.default.join(__dirname, 'audio', `${message.Info.ID}.${extension}`);
            fs_1.default.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`🎵 Audio saved at: ${savePath}`);
        }
        catch (err) {
            console.error('Error saving audio:', err.message);
        }
    }
    {
        return {
            saveAudioFromApi,
            saveImageBase64FromApi,
            saveDocumentFromApi
        };
    }
}
exports.default = DownLoadHelper;
