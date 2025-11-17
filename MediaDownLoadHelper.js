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
            var imageInfo = message.Message.imageMessage;
            var response = await axios_1.default.post(WuzURL + '/chat/downloadimage', {
                Url: imageInfo.URL,
                DirectPath: imageInfo.directPath,
                MediaKey: imageInfo.mediaKey,
                Mimetype: imageInfo.mimetype,
                FileEncSHA256: imageInfo.fileEncSHA256,
                FileSHA256: imageInfo.fileSHA256,
                FileLength: imageInfo.fileLength
            }, {
                headers: {
                    token: WuzToken,
                    'Content-Type': 'application/json'
                }
            });
            // Base64 data
            var base64Image = response.data.data.Data.replace(/^data:image\/\w+;base64,/, '');
            // Detect extension
            var extension = response.data.Mimetype?.split('/')[1] || 'webp';
            var saveDir = path_1.default.join(__dirname, 'imgs');
            if (!fs_1.default.existsSync(saveDir))
                fs_1.default.mkdirSync(saveDir, { recursive: true });
            // Save file to backend/imgs/image.<extension>
            var savePath = path_1.default.join(saveDir, message.Info.ID + `.${extension}`);
            fs_1.default.writeFileSync(savePath, Buffer.from(base64Image, 'base64'));
            console.log(`✅ Image saved at: ${savePath}`);
        }
        catch (err) {
            console.error('Error:', err.message);
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
            saveImageBase64FromApi
        };
    }
}
exports.default = DownLoadHelper;
