import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { CONFIG } from '../config';
import { createLogger } from '../utils/logger';
import { socketRateLimiter } from '../middleware/rateLimiter';
import {
    validateInput,
    chatMessageSchema,
    imageUploadSchema,
    videoUploadSchema,
    audioUploadSchema,
    documentUploadSchema,
    typingDataSchema,
    forwardMessageSchema,
    sanitizeFilename,
} from '../validation/schemas';
import { MessageSenderService } from '../services/MessageSenderService';
import path from 'path';
import fs from 'fs';

const logger = createLogger('SocketHandler');

interface ExtendedSocket extends Socket {
    userId?: string;
}

interface ConnectedUser {
    socketId: string;
    connectedAt: number;
}

interface OutgoingContextInfo {
    StanzaId?: string;
    Participant?: string;
    IsForwarded?: boolean;
    MentionedJID?: string[];
    QuotedMessage?: Record<string, unknown>;
}

/**
 * Socket.IO handler with proper validation, rate limiting, and error handling
 */
export class SocketHandler {
    private io: SocketIOServer | null = null;
    private connectedUsers: Map<string, ConnectedUser> = new Map();
    private messageSender: MessageSenderService;

    constructor() {
        this.messageSender = MessageSenderService.getInstance();

        // Cleanup disconnected users every 5 minutes
        setInterval(() => this.cleanupStaleConnections(), 5 * 60 * 1000);
    }

    /**
     * Initialize Socket.IO server
     */
    initialize(server: HTTPServer): SocketIOServer {
        const allowedOrigins = this.buildAllowedOrigins();

        this.io = new SocketIOServer(server, {
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Set-Cookie'],
                credentials: true,
            },
            pingTimeout: 60000,
            pingInterval: 25000,
        });

        this.setupEventHandlers();
        logger.info('Socket.IO initialized', { allowedOrigins: allowedOrigins.length });

        return this.io;
    }

    /**
     * Build allowed origins for CORS
     */
    private buildAllowedOrigins(): string[] {
        const defaultUrl = CONFIG.FRONTEND_URL;
        return [
            defaultUrl,
            defaultUrl.replace(/^https?/, 'http'),
            defaultUrl.replace(/^https?/, 'https'),
            ...CONFIG.ALLOWED_ORIGINS,
        ];
    }

    /**
     * Setup all socket event handlers
     */
    private setupEventHandlers(): void {
        if (!this.io) return;

        this.io.on('connection', (socket: ExtendedSocket) => {
            logger.info('User connected', { socketId: socket.id });

            // Register event handlers with rate limiting and validation
            this.registerHandler(socket, 'join', this.handleJoin.bind(this));
            this.registerHandler(socket, 'join_conversation', this.handleJoinConversation.bind(this));
            this.registerHandler(socket, 'leave_conversation', this.handleLeaveConversation.bind(this));
            this.registerHandler(socket, 'send_message', this.handleSendMessage.bind(this));
            this.registerHandler(socket, 'send_image', this.handleSendImage.bind(this));
            this.registerHandler(socket, 'send_video', this.handleSendVideo.bind(this));
            this.registerHandler(socket, 'send_audio', this.handleSendAudio.bind(this));
            this.registerHandler(socket, 'send_audio_message', this.handleSendAudio.bind(this));
            this.registerHandler(socket, 'send_document', this.handleSendDocument.bind(this));
            this.registerHandler(socket, 'typing', this.handleTyping.bind(this));
            this.registerHandler(socket, 'message_forwarded', this.handleForwardMessage.bind(this));
            this.registerHandler(socket, 'cancel_recording', this.handleCancelRecording.bind(this));

            socket.on('disconnect', () => this.handleDisconnect(socket));
        });
    }

    /**
     * Register event handler with rate limiting
     */
    private registerHandler(socket: ExtendedSocket, eventName: string, handler: Function): void {
        socket.on(eventName, async (...args: any[]) => {
            // Rate limiting
            if (!socketRateLimiter.checkLimit(socket, eventName)) {
                socket.emit('rate_limit_exceeded', {
                    event: eventName,
                    message: 'Too many requests, please slow down',
                });
                return;
            }

            try {
                await handler(socket, ...args);
            } catch (error) {
                logger.error(`Error in ${eventName} handler`, error, { socketId: socket.id });
                socket.emit('error', {
                    event: eventName,
                    message: error instanceof Error ? error.message : 'Internal server error',
                });
            }
        });
    }

    /**
     * Handle user join
     */
    private async handleJoin(socket: ExtendedSocket, userId: string): Promise<void> {
        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid userId');
        }

        this.connectedUsers.set(userId, {
            socketId: socket.id,
            connectedAt: Date.now(),
        });
        socket.userId = userId;
        logger.info('User joined', { userId, socketId: socket.id });
    }

    /**
     * Handle join conversation
     */
    private async handleJoinConversation(socket: ExtendedSocket, conversationId: string): Promise<void> {
        if (!conversationId || typeof conversationId !== 'string') {
            throw new Error('Invalid conversationId');
        }

        socket.join(`conversation_${conversationId}`);
        logger.debug('User joined conversation', {
            userId: socket.userId,
            conversationId,
            socketId: socket.id
        });
    }

    /**
     * Handle leave conversation
     */
    private async handleLeaveConversation(socket: ExtendedSocket, conversationId: string): Promise<void> {
        if (!conversationId || typeof conversationId !== 'string') {
            throw new Error('Invalid conversationId');
        }

        socket.leave(`conversation_${conversationId}`);
        logger.debug('User left conversation', {
            userId: socket.userId,
            conversationId,
            socketId: socket.id
        });
    }

    private toParticipantJid(value: string): string {
        const raw = (value || '').trim();
        if (!raw) return '';
        if (raw.includes('@')) return raw;
        if (raw.includes('-')) return `${raw}@g.us`;
        return `${raw}@s.whatsapp.net`;
    }

    private buildContextInfoFromPayload(payload: any, fallbackPhone: string): OutgoingContextInfo | undefined {
        const sourceContext = payload?.ContextInfo || payload?.contextInfo || payload?.forwardContext;
        const replyParticipantRaw =
            payload?.replyToMessage?.contactId ||
            payload?.replyToMessage?.ContactId ||
            payload?.replyToMessage?.phone;
        const stanzaId =
            sourceContext?.StanzaId ||
            sourceContext?.stanzaId ||
            payload?.replyToMessageId ||
            payload?.replyToId ||
            payload?.quotedMessageId;

        const participantRaw =
            sourceContext?.Participant ||
            sourceContext?.participant ||
            sourceContext?.contactId ||
            sourceContext?.ContactId ||
            replyParticipantRaw ||
            payload?.replyToParticipant ||
            payload?.participant ||
            fallbackPhone;

        const mentionedJids = sourceContext?.MentionedJID || sourceContext?.mentionedJID || sourceContext?.mentions || payload?.mentions || [];
        const quotedText = payload?.QuotedText || payload?.quotedText;
        const quotedMessage = sourceContext?.QuotedMessage || sourceContext?.quotedMessage || (quotedText ? { conversation: quotedText } : undefined);
        const isForwarded = Boolean(
            sourceContext?.IsForwarded ??
            sourceContext?.isForwarded ??
            payload?.isForwarded ??
            payload?.forwarded ??
            payload?.isForward
        );

        const hasContext = Boolean(stanzaId || quotedMessage || isForwarded || (Array.isArray(mentionedJids) && mentionedJids.length > 0));
        if (!hasContext) return undefined;

        return {
            ...(stanzaId ? { StanzaId: String(stanzaId) } : {}),
            Participant: this.toParticipantJid(String(participantRaw || '')),
            IsForwarded: isForwarded,
            MentionedJID: Array.isArray(mentionedJids) ? mentionedJids.map((jid: unknown) => this.toParticipantJid(String(jid || ''))).filter(Boolean) : [],
            ...(quotedMessage ? { QuotedMessage: quotedMessage } : {}),
        };
    }

    /**
     * Handle send message
     */
    private async handleSendMessage(socket: ExtendedSocket, messageData: any): Promise<void> {
        const message = validateInput(chatMessageSchema, messageData);
        const contextInfo = this.buildContextInfoFromPayload(messageData, message.phone);

        const enrichedMessage = {
            ...message,
            ...(contextInfo ? { contextInfo } : {}),
        };

        logger.debug('Received message', {
            messageId: message.id,
            chatId: message.chatId,
            replyTo: message.replyToMessageId,
            hasContextInfo: !!contextInfo,
        });

        const currentUser = {
            id: socket.userId || 'unknown',
            username: socket.userId || 'unknown',
        };

        const result = await this.messageSender.sendMessage(enrichedMessage, currentUser);

        if (!result.success) {
            socket.emit('message_error', {
                success: false,
                error: result.error || 'Failed to send message',
                originalMessage: enrichedMessage,
            });
            return;
        }

        socket.emit('message_sent', {
            success: true,
            messageId: result.messageId,
            originalMessage: enrichedMessage,
        });
    }

    /**
     * Handle send image
     */
    private async handleSendImage(socket: ExtendedSocket, data: any): Promise<void> {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                imageData: data.imageData || data.image,
                filename: sanitizeFilename(data.filename || `image_${Date.now()}.jpg`) || `image_${Date.now()}.jpg`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'image' as const,
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                imageData: data?.imageData || data?.image,
                filename: sanitizeFilename(data?.filename || `image_${Date.now()}.jpg`) || `image_${Date.now()}.jpg`,
            };

        const validated = validateInput(imageUploadSchema, normalizedData);
        const sanitizedFilename = sanitizeFilename(validated.filename);
        const tempPath = path.join(CONFIG.PATHS.IMAGES, sanitizedFilename);

        try {
            const buffer = Buffer.from(validated.imageData, 'base64');

            // Ensure directory exists
            if (!fs.existsSync(CONFIG.PATHS.IMAGES)) {
                fs.mkdirSync(CONFIG.PATHS.IMAGES, { recursive: true });
            }

            fs.writeFileSync(tempPath, buffer);

            const mockFile = {
                path: tempPath,
                filename: sanitizedFilename,
                mimetype: 'image/jpeg',
            };

            const currentUser = {
                id: socket.userId || 'unknown',
                username: socket.userId || 'unknown',
            };

            const messageForSend = {
                ...validated.message,
                ...(contextInfo ? { contextInfo } : {}),
            };

            const result = await this.messageSender.sendImage(messageForSend, mockFile, currentUser);

            if (!result.success) {
                socket.emit('message_error', {
                    success: false,
                    error: result.error || 'Failed to send image',
                    originalMessage: validated.message,
                });
                return;
            }

            socket.emit('message_sent', {
                success: true,
                messageId: result.messageId,
                originalMessage: validated.message,
            });
        } catch (error) {
            // Cleanup on error
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw error;
        }
    }

    /**
     * Handle typing indicator
     */
    private async handleTyping(socket: ExtendedSocket, data: any): Promise<void> {
        const typingData = validateInput(typingDataSchema, data);

        socket.to(`conversation_${typingData.conversationId}`).emit('user_typing', {
            userId: typingData.userId,
            isTyping: typingData.isTyping,
            conversationId: typingData.conversationId,
        });
    }

    /**
     * Handle disconnect
     */
    private handleDisconnect(socket: ExtendedSocket): void {
        if (socket.userId) {
            this.connectedUsers.delete(socket.userId);
            logger.info('User disconnected', { userId: socket.userId, socketId: socket.id });
        }
    }

    /**
     * Cleanup stale connections
     */
    private cleanupStaleConnections(): void {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000; // 30 minutes

        for (const [userId, user] of this.connectedUsers.entries()) {
            if (now - user.connectedAt > staleThreshold) {
                this.connectedUsers.delete(userId);
                logger.debug('Cleaned up stale connection', { userId });
            }
        }
    }

    /**
     * Get Socket.IO instance
     */
    getIO(): SocketIOServer | null {
        return this.io;
    }

    /**
     * Handle send video
     */
    private async handleSendVideo(socket: ExtendedSocket, data: any): Promise<void> {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                videoData: data.videoData || data.video || data.body,
                filename: sanitizeFilename(data.filename || `video_${Date.now()}.mp4`) || `video_${Date.now()}.mp4`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'video' as const,
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                videoData: data?.videoData || data?.video || data?.body,
                filename: sanitizeFilename(data?.filename || `video_${Date.now()}.mp4`) || `video_${Date.now()}.mp4`,
            };

        const validated = validateInput(videoUploadSchema, normalizedData);
        const sanitizedFilename = sanitizeFilename(validated.filename);
        const tempPath = path.join(CONFIG.PATHS.VIDEOS, sanitizedFilename);

        try {
            const buffer = Buffer.from(validated.videoData, 'base64');

            if (!fs.existsSync(CONFIG.PATHS.VIDEOS)) {
                fs.mkdirSync(CONFIG.PATHS.VIDEOS, { recursive: true });
            }

            fs.writeFileSync(tempPath, buffer);

            const mockFile = {
                path: tempPath,
                filename: sanitizedFilename,
                mimetype: 'video/mp4',
            };

            const currentUser = {
                id: socket.userId || 'unknown',
                username: socket.userId || 'unknown',
            };

            const messageForSend = {
                ...validated.message,
                ...(contextInfo ? { contextInfo } : {}),
            };

            const result = await this.messageSender.sendVideo(messageForSend, mockFile, currentUser);

            if (!result.success) {
                socket.emit('message_error', {
                    success: false,
                    error: result.error || 'Failed to send video',
                    originalMessage: validated.message,
                });
                return;
            }

            socket.emit('message_sent', {
                success: true,
                messageId: result.messageId,
                originalMessage: validated.message,
            });
        } catch (error) {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw error;
        }
    }

    /**
     * Handle send audio
     */
    private async handleSendAudio(socket: ExtendedSocket, data: any): Promise<void> {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                audioData: data.audioData || data.audio,
                filename: sanitizeFilename(data.filename || `audio_${Date.now()}.ogg`) || `audio_${Date.now()}.ogg`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'audio' as const,
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    seconds: data?.seconds,
                    waveform: data?.waveform,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                audioData: data?.audioData || data?.audio || data?.audioBase64,
                filename: sanitizeFilename(data?.filename || `audio_${Date.now()}.ogg`) || `audio_${Date.now()}.ogg`,
            };

        const validated = validateInput(audioUploadSchema, normalizedData);
        const sanitizedFilename = sanitizeFilename(validated.filename);
        const tempPath = path.join(CONFIG.PATHS.AUDIO, sanitizedFilename);

        try {
            const buffer = Buffer.from(validated.audioData, 'base64');

            if (!fs.existsSync(CONFIG.PATHS.AUDIO)) {
                fs.mkdirSync(CONFIG.PATHS.AUDIO, { recursive: true });
            }

            fs.writeFileSync(tempPath, buffer);

            const mockFile = {
                path: tempPath,
                filename: sanitizedFilename,
                mimetype: 'audio/ogg',
            };

            const currentUser = {
                id: socket.userId || 'unknown',
                username: socket.userId || 'unknown',
            };

            const messageForSend = {
                ...validated.message,
                ...(contextInfo ? { contextInfo } : {}),
            };

            const result = await this.messageSender.sendAudio(messageForSend, mockFile, currentUser);

            if (!result.success) {
                socket.emit('message_error', {
                    success: false,
                    error: result.error || 'Failed to send audio',
                    originalMessage: validated.message,
                });
                return;
            }

            socket.emit('message_sent', {
                success: true,
                messageId: result.messageId,
                originalMessage: validated.message,
            });
        } catch (error) {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw error;
        }
    }

    /**
     * Handle send document
     */
    private async handleSendDocument(socket: ExtendedSocket, data: any): Promise<void> {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                documentData: data.documentData || data.document || data.file,
                filename: sanitizeFilename(data.filename || `document_${Date.now()}.bin`) || `document_${Date.now()}.bin`,
                mimetype: data.mimetype || 'application/octet-stream',
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'document' as const,
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                documentData: data?.documentData || data?.document || data?.file,
                filename: sanitizeFilename(data?.filename || `document_${Date.now()}.bin`) || `document_${Date.now()}.bin`,
                mimetype: data?.mimetype || 'application/octet-stream',
            };

        const validated = validateInput(documentUploadSchema, normalizedData);
        const sanitizedFilename = sanitizeFilename(validated.filename);
        const tempPath = path.join(CONFIG.PATHS.DOCUMENTS, sanitizedFilename);

        try {
            const buffer = Buffer.from(validated.documentData, 'base64');

            if (!fs.existsSync(CONFIG.PATHS.DOCUMENTS)) {
                fs.mkdirSync(CONFIG.PATHS.DOCUMENTS, { recursive: true });
            }

            fs.writeFileSync(tempPath, buffer);

            const mockFile = {
                path: tempPath,
                filename: sanitizedFilename,
                mimetype: validated.mimetype,
            };

            const currentUser = {
                id: socket.userId || 'unknown',
                username: socket.userId || 'unknown',
            };

            const messageForSend = {
                ...validated.message,
                ...(contextInfo ? { contextInfo } : {}),
            };

            const result = await this.messageSender.sendDocument(messageForSend, mockFile, currentUser);

            if (!result.success) {
                socket.emit('message_error', {
                    success: false,
                    error: result.error || 'Failed to send document',
                    originalMessage: validated.message,
                });
                return;
            }

            socket.emit('message_sent', {
                success: true,
                messageId: result.messageId,
                originalMessage: validated.message,
            });
        } catch (error) {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
            throw error;
        }
    }

    /**
     * Handle forward message
     */
    private async handleForwardMessage(socket: ExtendedSocket, data: any): Promise<void> {
        const validated = validateInput(forwardMessageSchema, data);

        logger.debug('Forwarding message', {
            from: validated.originalMessage.chatId,
            to: validated.targetChatId,
        });

        const currentUser = {
            id: validated.senderId,
            username: validated.senderId,
        };

        const forwardedMessage = {
            ...validated.originalMessage,
            id: Date.now().toString(),
            chatId: validated.targetChatId,
            phone: validated.targetPhone,
            isFromMe: true,
            forwardContext: {
                StanzaId: validated.originalMessage.id || '',
                Participant: this.toParticipantJid(
                    (validated.originalMessage as any).contactId ||
                    (validated.originalMessage as any).ContactId ||
                    validated.originalMessage.phone ||
                    validated.targetPhone
                ),
                IsForwarded: true,
                MentionedJID: [],
                ...(validated.originalMessage.message ? { QuotedMessage: { conversation: validated.originalMessage.message } } : {}),
            },
        };

        let result;

        if (forwardedMessage.messageType === 'text' || !forwardedMessage.messageType) {
            result = await this.messageSender.sendMessage(forwardedMessage, currentUser);
        } else if (forwardedMessage.mediaPath && fs.existsSync(forwardedMessage.mediaPath)) {
            const mockFile = {
                path: forwardedMessage.mediaPath,
                filename: path.basename(forwardedMessage.mediaPath),
                mimetype: forwardedMessage.messageType === 'image' ? 'image/jpeg' :
                    forwardedMessage.messageType === 'video' ? 'video/mp4' :
                        forwardedMessage.messageType === 'audio' ? 'audio/ogg' : 'application/octet-stream',
            };

            if (forwardedMessage.messageType === 'image') {
                result = await this.messageSender.sendImage(forwardedMessage, mockFile, currentUser);
            } else if (forwardedMessage.messageType === 'video') {
                result = await this.messageSender.sendVideo(forwardedMessage, mockFile, currentUser);
            } else if (forwardedMessage.messageType === 'audio') {
                result = await this.messageSender.sendAudio(forwardedMessage, mockFile, currentUser);
            } else {
                result = await this.messageSender.sendDocument(forwardedMessage, mockFile, currentUser);
            }
        } else {
            result = await this.messageSender.sendMessage(forwardedMessage, currentUser);
        }

        if (!result.success) {
            socket.emit('message_error', {
                success: false,
                error: result.error || 'Failed to forward message',
                originalMessage: validated.originalMessage,
            });
            return;
        }

        socket.emit('message_forward_success', {
            success: true,
            messageId: result.messageId,
            targetChatId: validated.targetChatId,
        });
    }

    /**
     * Handle cancel recording
     */
    private async handleCancelRecording(socket: ExtendedSocket, data: any): Promise<void> {
        const filename = data?.filename;

        logger.debug('Recording cancelled', { filename, socketId: socket.id });

        if (filename) {
            const sanitizedFilename = sanitizeFilename(filename);
            const tempPath = path.join(CONFIG.PATHS.AUDIO, sanitizedFilename);

            if (fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                    logger.debug('Cleaned up cancelled recording', { filename: sanitizedFilename });
                } catch (error) {
                    logger.warn('Failed to cleanup cancelled recording', { filename: sanitizedFilename, error });
                }
            }
        }

        socket.emit('recording_cancelled', {
            success: true,
            message: 'Recording cancelled successfully',
        });
    }
}

// Export singleton instance
export const socketHandler = new SocketHandler();
