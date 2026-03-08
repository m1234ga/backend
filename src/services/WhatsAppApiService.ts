import { CONFIG } from '../config';
import { createLogger } from '../utils/logger';
import { HTTP_STATUS, ERROR_MESSAGES } from '../constants';

const logger = createLogger('WhatsAppApiService');

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    details?: any;
}

/**
 * WhatsApp API Service - Centralized API client for WuzAPI
 */
class WhatsAppApiService {
    private static instance: WhatsAppApiService;
    private baseUrl: string;
    private token: string;
    private timeout: number;

    private constructor() {
        this.baseUrl = CONFIG.WUZAPI.BASE_URL.replace(/\/$/, '');
        this.token = CONFIG.WUZAPI.TOKEN;
        this.timeout = CONFIG.WUZAPI.TIMEOUT_MS;
        logger.info('WhatsAppApiService initialized', { baseUrl: this.baseUrl });
    }

    public static getInstance(): WhatsAppApiService {
        if (!WhatsAppApiService.instance) {
            WhatsAppApiService.instance = new WhatsAppApiService();
        }
        return WhatsAppApiService.instance;
    }

    /**
     * Generic API request method
     */
    private async request<T>(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        body?: any
    ): Promise<ApiResponse<T>> {
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
                    error: ERROR_MESSAGES.EXTERNAL_API_ERROR,
                    details: errorText,
                };
            }

            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error('WhatsApp API request failed', error, {
                endpoint,
                duration,
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : ERROR_MESSAGES.EXTERNAL_API_ERROR,
            };
        }
    }

    /**
     * Send text message
     */
    async sendTextMessage(phone: string, body: string, id: string, contextInfo?: any): Promise<ApiResponse> {
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
    async sendImageMessage(
        phone: string,
        imageBase64: string,
        id: string,
        caption?: string,
        contextInfo?: any
    ): Promise<ApiResponse> {
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
    async sendVideoMessage(
        phone: string,
        videoBase64: string,
        id: string,
        caption?: string,
        contextInfo?: any
    ): Promise<ApiResponse> {
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
    async sendAudioMessage(
        phone: string,
        audioBase64: string,
        id: string,
        ptt: boolean = true,
        seconds?: number,
        waveform?: number[],
        contextInfo?: any
    ): Promise<ApiResponse> {
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
    async sendDocumentMessage(
        phone: string,
        documentBase64: string,
        fileName: string,
        id: string,
        contextInfo?: any
    ): Promise<ApiResponse> {
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
    async sendReaction(phone: string, messageId: string, emoji: string): Promise<ApiResponse> {
        return this.request('chat/react', 'POST', {
            Phone: phone,
            Body: emoji,
            Id: messageId,
        });
    }

    /**
     * Download image
     */
    async downloadImage(mediaInfo: any): Promise<ApiResponse> {
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
    async downloadAudio(mediaInfo: any): Promise<ApiResponse> {
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
    async downloadVideo(mediaInfo: any): Promise<ApiResponse> {
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

    async downloadDocument(mediaInfo: any): Promise<ApiResponse> {
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
    async getUserInfo(phones: string[]): Promise<ApiResponse> {
        const formattedPhones = phones.map(p => p.includes('@') ? p : `${p}@s.whatsapp.net`);
        return this.request('user/info', 'POST', { Phone: formattedPhones });
    }

    /**
     * Get user avatar
     */
    async getUserAvatar(phone: string, preview: boolean = true): Promise<ApiResponse> {
        return this.request('user/avatar', 'POST', {
            Phone: phone,
            Preview: preview,
        });
    }

    /**
     * Get contact profile
     */
    async getContactProfile(phone: string): Promise<ApiResponse> {
        return this.request(`contact/profile?phone=${encodeURIComponent(phone)}`);
    }

    /**
     * Get contact presence
     */
    async getContactPresence(phone: string): Promise<ApiResponse> {
        return this.request(`contact/presence?phone=${encodeURIComponent(phone)}`);
    }

}

export const whatsAppApiService = WhatsAppApiService.getInstance();
