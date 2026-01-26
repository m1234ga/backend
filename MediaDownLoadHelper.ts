import axios from 'axios';
import fs from 'fs';
import path from 'path';
require('dotenv').config();

import { env } from 'process';

const WuzURL = env.WUZAPI;
const WuzToken = env.WUZAPI_Token;

function DownLoadHelper() {

    async function saveImageBase64FromApi(message: any) {
        try {
            const isSticker = !!message.Message.stickerMessage;
            const mediaInfo = message.Message.imageMessage || message.Message.stickerMessage;

            if (!mediaInfo) return;

            const endpoint = '/chat/downloadimage';

            const response = await axios.post(WuzURL + endpoint, {
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
            const saveDir = path.join(__dirname, 'imgs');

            if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
            }

            // Save file to backend/imgs/ID.extension
            const savePath = path.join(saveDir, `${message.Info.ID}.${extension}`);
            fs.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`✅ ${isSticker ? 'Sticker' : 'Image'} saved at: ${savePath}`);
        } catch (err) {
            console.error(`Error saving ${message.Message.stickerMessage ? 'sticker' : 'image'}:`, (<any>err).message);
        }
    }
    async function saveDocumentFromApi(message: any) {
        try {
            const documentInfo = message.Message.documentMessage;
            if (!documentInfo) return;

            const response = await axios.post(WuzURL + '/chat/downloaddocument', {
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

            const saveDir = path.join(__dirname, 'docs');
            if (!fs.existsSync(saveDir)) {
                fs.mkdirSync(saveDir, { recursive: true });
            }

            // Use the provided filename or default to ID
            const fileName = documentInfo.fileName || `${message.Info.ID}.${documentInfo.mimetype?.split('/')[1] || 'bin'}`;
            const savePath = path.join(saveDir, fileName);
            fs.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`📄 Document saved at: ${savePath}`);
        } catch (err) {
            console.error('Error saving document:', (<any>err).message);
        }
    }
    async function saveAudioFromApi(message: any) {
        try {
            var audioInfo = message.Message.audioMessage;
            var response = await axios.post(WuzURL + '/chat/downloadaudio', {
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
            var savePath = path.join(__dirname, 'audio', `${message.Info.ID}.${extension}`);
            fs.writeFileSync(savePath, Buffer.from(cleanBase64, 'base64'));
            console.log(`🎵 Audio saved at: ${savePath}`);
        }
        catch (err) {
            console.error('Error saving audio:', (<any>err).message);
        }
    }
    {
        return {
            saveAudioFromApi,
            saveImageBase64FromApi,
            saveDocumentFromApi
        }
    }
}
export default DownLoadHelper;