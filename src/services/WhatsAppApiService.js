"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsAppApiService = void 0;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const constants_1 = require("../constants");
const logger = (0, logger_1.createLogger)('WhatsAppApiService');
/**
 * WhatsApp API Service - Centralized API client for WuzAPI
 */
class WhatsAppApiService {
    static instance;
    baseUrl;
    token;
    timeout;
    constructor() {
        this.baseUrl = config_1.CONFIG.WUZAPI.BASE_URL.replace(/\/$/, '');
        this.token = config_1.CONFIG.WUZAPI.TOKEN;
        this.timeout = config_1.CONFIG.WUZAPI.TIMEOUT_MS;
        logger.info('WhatsAppApiService initialized', { baseUrl: this.baseUrl });
    }
    static getInstance() {
        if (!WhatsAppApiService.instance) {
            WhatsAppApiService.instance = new WhatsAppApiService();
        }
        return WhatsAppApiService.instance;
    }
    /**
     * Generic API request method
     */
    async request(endpoint, method = 'GET', body) {
        const url = `${this.baseUrl}/${endpoint.replace(/^\//, '')}`;
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            logger.apiRequest(method, url, body ? { bodySize: JSON.stringify(body).length } : undefined);
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    token: this.token,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const duration = Date.now() - startTime;
            logger.apiResponse(method, url, response.status, duration);
            if (!response.ok) {
                const errorText = await response.text();
                logger.error('WhatsApp API error', new Error(errorText), {
                    status: response.status,
                    endpoint,
                });
                return {
                    success: false,
                    error: constants_1.ERROR_MESSAGES.EXTERNAL_API_ERROR,
                    details: errorText,
                };
            }
            const data = await response.json();
            return { success: true, data };
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger.error('WhatsApp API request failed', error, {
                endpoint,
                duration,
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : constants_1.ERROR_MESSAGES.EXTERNAL_API_ERROR,
            };
        }
    }
    /**
     * Send text message
     */
    async sendTextMessage(phone, body, id, contextInfo) {
        logger.info('Sending text message', { phone, bodyLength: body, id, contextInfo });
        return this.request('chat/send/text', 'POST', {
            Phone: phone,
            Body: body,
            Id: id,
            ContextInfo: contextInfo,
        });
    }
    /**
     * Send image message
     */
    async sendImageMessage(phone, imageBase64, id, caption, contextInfo) {
        return this.request('chat/send/image', 'POST', {
            Phone: phone,
            Image: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`,
            Id: id,
            Caption: caption || '',
            ContextInfo: contextInfo,
        });
    }
    /**
     * Send video message
     */
    async sendVideoMessage(phone, videoBase64, id, caption, contextInfo) {
        return this.request('chat/send/video', 'POST', {
            Phone: phone,
            Body: videoBase64,
            Id: id,
            Caption: caption || '',
            ContextInfo: contextInfo,
        });
    }
    /**
     * Send audio message
     */
    async sendAudioMessage(phone, audioBase64, id, ptt = true, seconds, waveform, contextInfo) {
        return this.request('chat/send/audio', 'POST', {
            Phone: phone,
            Audio: audioBase64.startsWith('data:') ? audioBase64 : `data:audio/ogg;base64,${audioBase64}`,
            Id: id,
            PTT: ptt,
            MimeType: 'audio/ogg; codecs=opus',
            Seconds: seconds || 0,
            Waveform: waveform || [],
            ContextInfo: contextInfo,
        });
    }
    /**
     * Send document message
     */
    async sendDocumentMessage(phone, documentBase64, fileName, id, contextInfo) {
        return this.request('chat/send/document', 'POST', {
            Phone: phone,
            Document: documentBase64.startsWith('data:')
                ? documentBase64
                : `data:application/octet-stream;base64,${documentBase64}`,
            FileName: fileName,
            Id: id,
            ContextInfo: contextInfo,
        });
    }
    /**
     * Send reaction
     */
    async sendReaction(phone, messageId, emoji) {
        return this.request('chat/react', 'POST', {
            Phone: phone,
            Body: emoji,
            Id: messageId,
        });
    }
    /**
     * Download image
     */
    async downloadImage(mediaInfo) {
        return this.request('chat/downloadimage', 'POST', {
            Url: mediaInfo.URL,
            DirectPath: mediaInfo.directPath,
            MediaKey: mediaInfo.mediaKey,
            Mimetype: mediaInfo.mimetype,
            FileEncSHA256: mediaInfo.fileEncSHA256,
            FileSHA256: mediaInfo.fileSHA256,
            FileLength: mediaInfo.fileLength,
        });
    }
    /**
     * Download audio
     */
    async downloadAudio(mediaInfo) {
        return this.request('chat/downloadaudio', 'POST', {
            Url: mediaInfo.URL,
            DirectPath: mediaInfo.directPath,
            MediaKey: mediaInfo.mediaKey,
            Mimetype: mediaInfo.mimetype,
            FileEncSHA256: mediaInfo.fileEncSHA256,
            FileSHA256: mediaInfo.fileSHA256,
            FileLength: mediaInfo.fileLength,
        });
    }
    /**
     * Download document
     */
    async downloadVideo(mediaInfo) {
        return this.request('chat/downloadvideo', 'POST', {
            Url: mediaInfo.URL,
            DirectPath: mediaInfo.directPath,
            MediaKey: mediaInfo.mediaKey,
            Mimetype: mediaInfo.mimetype,
            FileEncSHA256: mediaInfo.fileEncSHA256,
            FileSHA256: mediaInfo.fileSHA256,
            FileLength: mediaInfo.fileLength,
        });
    }
    async downloadDocument(mediaInfo) {
        return this.request('chat/downloaddocument', 'POST', {
            Url: mediaInfo.URL,
            DirectPath: mediaInfo.directPath,
            MediaKey: mediaInfo.mediaKey,
            Mimetype: mediaInfo.mimetype,
            FileEncSHA256: mediaInfo.fileEncSHA256,
            FileSHA256: mediaInfo.fileSHA256,
            FileLength: mediaInfo.fileLength,
        });
    }
    /**
     * Get user info
     */
    async getUserInfo(phones) {
        const formattedPhones = phones.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
        return this.request('user/info', 'POST', { Phone: formattedPhones });
    }
    /**
     * Get user avatar
     */
    async getUserAvatar(phone, preview = true) {
        return this.request('user/avatar', 'POST', {
            Phone: phone,
            Preview: preview,
        });
    }
    /**
     * Get contact profile
     */
    async getContactProfile(phone) {
        return this.request(`contact/profile?phone=${encodeURIComponent(phone)}`);
    }
    /**
     * Get contact presence
     */
    async getContactPresence(phone) {
        return this.request(`contact/presence?phone=${encodeURIComponent(phone)}`);
    }
    /**
     * Get user LID (Local ID)
     */
    async getUserLid(phone) {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        return this.request(`user/lid/${encodeURIComponent(cleanPhone)}`);
    }
}
exports.whatsAppApiService = WhatsAppApiService.getInstance();
