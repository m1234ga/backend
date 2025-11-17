import axios from 'axios';
import fs from 'fs';
import path from 'path';
require('dotenv').config();

import { env } from 'process';

const WuzURL=env.WUZAPI;
const WuzToken=env.WUZAPI_Token;

function DownLoadHelper(){

async  function saveImageBase64FromApi(message:any) {
    try {
        var imageInfo=message.Message.imageMessage;
        var response = await axios.post(WuzURL+'/chat/downloadimage', {
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
        var saveDir = path.join(__dirname, 'imgs');
        if (!fs.existsSync(saveDir))
            fs.mkdirSync(saveDir, { recursive: true });
        // Save file to backend/imgs/image.<extension>
        var savePath = path.join(saveDir, message.Info.ID+`.${extension}`);
        fs.writeFileSync(savePath, Buffer.from(base64Image, 'base64'));
        console.log(`✅ Image saved at: ${savePath}`);
    }
    catch (err) {
        console.error('Error:', (<any>err).message);
    }
  }
  async function saveAudioFromApi(message:any) {
    try {
        var audioInfo=message.Message.audioMessage;
        var response = await axios.post(WuzURL+'/chat/downloadaudio', {
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
  {return {
    saveAudioFromApi,
    saveImageBase64FromApi
  }}
}
export default DownLoadHelper;