"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketHandler = exports.SocketHandler = void 0;
const socket_io_1 = require("socket.io");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const rateLimiter_1 = require("../middleware/rateLimiter");
const schemas_1 = require("../validation/schemas");
const MessageSenderService_1 = require("../services/MessageSenderService");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger = (0, logger_1.createLogger)('SocketHandler');
/**
 * Socket.IO handler with proper validation, rate limiting, and error handling
 */
class SocketHandler {
    io = null;
    connectedUsers = new Map();
    messageSender;
    constructor() {
        this.messageSender = MessageSenderService_1.MessageSenderService.getInstance();
        // Cleanup disconnected users every 5 minutes
        setInterval(() => this.cleanupStaleConnections(), 5 * 60 * 1000);
    }
    /**
     * Initialize Socket.IO server
     */
    initialize(server) {
        const allowedOrigins = this.buildAllowedOrigins();
        this.io = new socket_io_1.Server(server, {
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
    buildAllowedOrigins() {
        const defaultUrl = config_1.CONFIG.FRONTEND_URL;
        return [
            defaultUrl,
            defaultUrl.replace(/^https?/, 'http'),
            defaultUrl.replace(/^https?/, 'https'),
            ...config_1.CONFIG.ALLOWED_ORIGINS,
        ];
    }
    /**
     * Setup all socket event handlers
     */
    setupEventHandlers() {
        if (!this.io)
            return;
        this.io.on('connection', (socket) => {
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
    registerHandler(socket, eventName, handler) {
        socket.on(eventName, async (...args) => {
            // Rate limiting
            if (!rateLimiter_1.socketRateLimiter.checkLimit(socket, eventName)) {
                socket.emit('rate_limit_exceeded', {
                    event: eventName,
                    message: 'Too many requests, please slow down',
                });
                return;
            }
            try {
                await handler(socket, ...args);
            }
            catch (error) {
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
    async handleJoin(socket, userId) {
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
    async handleJoinConversation(socket, conversationId) {
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
    async handleLeaveConversation(socket, conversationId) {
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
    toParticipantJid(value) {
        const raw = (value || '').trim();
        if (!raw)
            return '';
        if (raw.includes('@'))
            return raw;
        if (raw.includes('-'))
            return `${raw}@g.us`;
        return `${raw}@s.whatsapp.net`;
    }
    buildContextInfoFromPayload(payload, fallbackPhone) {
        const sourceContext = payload?.ContextInfo || payload?.contextInfo || payload?.forwardContext;
        const replyParticipantRaw = payload?.replyToMessage?.contactId ||
            payload?.replyToMessage?.ContactId ||
            payload?.replyToMessage?.phone;
        const stanzaId = sourceContext?.StanzaId ||
            sourceContext?.stanzaId ||
            payload?.replyToMessageId ||
            payload?.replyToId ||
            payload?.quotedMessageId;
        const participantRaw = sourceContext?.Participant ||
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
        const isForwarded = Boolean(sourceContext?.IsForwarded ??
            sourceContext?.isForwarded ??
            payload?.isForwarded ??
            payload?.forwarded ??
            payload?.isForward);
        const hasContext = Boolean(stanzaId || quotedMessage || isForwarded || (Array.isArray(mentionedJids) && mentionedJids.length > 0));
        if (!hasContext)
            return undefined;
        return {
            ...(stanzaId ? { StanzaId: String(stanzaId) } : {}),
            Participant: this.toParticipantJid(String(participantRaw || '')),
            IsForwarded: isForwarded,
            MentionedJID: Array.isArray(mentionedJids) ? mentionedJids.map((jid) => this.toParticipantJid(String(jid || ''))).filter(Boolean) : [],
            ...(quotedMessage ? { QuotedMessage: quotedMessage } : {}),
        };
    }
    /**
     * Handle send message
     */
    async handleSendMessage(socket, messageData) {
        const message = (0, schemas_1.validateInput)(schemas_1.chatMessageSchema, messageData);
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
    async handleSendImage(socket, data) {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                imageData: data.imageData || data.image,
                filename: (0, schemas_1.sanitizeFilename)(data.filename || `image_${Date.now()}.jpg`) || `image_${Date.now()}.jpg`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'image',
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                imageData: data?.imageData || data?.image,
                filename: (0, schemas_1.sanitizeFilename)(data?.filename || `image_${Date.now()}.jpg`) || `image_${Date.now()}.jpg`,
            };
        const validated = (0, schemas_1.validateInput)(schemas_1.imageUploadSchema, normalizedData);
        const sanitizedFilename = (0, schemas_1.sanitizeFilename)(validated.filename);
        const tempPath = path_1.default.join(config_1.CONFIG.PATHS.IMAGES, sanitizedFilename);
        try {
            const buffer = Buffer.from(validated.imageData, 'base64');
            // Ensure directory exists
            if (!fs_1.default.existsSync(config_1.CONFIG.PATHS.IMAGES)) {
                fs_1.default.mkdirSync(config_1.CONFIG.PATHS.IMAGES, { recursive: true });
            }
            fs_1.default.writeFileSync(tempPath, buffer);
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
        }
        catch (error) {
            // Cleanup on error
            if (fs_1.default.existsSync(tempPath)) {
                fs_1.default.unlinkSync(tempPath);
            }
            throw error;
        }
    }
    /**
     * Handle typing indicator
     */
    async handleTyping(socket, data) {
        const typingData = (0, schemas_1.validateInput)(schemas_1.typingDataSchema, data);
        socket.to(`conversation_${typingData.conversationId}`).emit('user_typing', {
            userId: typingData.userId,
            isTyping: typingData.isTyping,
            conversationId: typingData.conversationId,
        });
    }
    /**
     * Handle disconnect
     */
    handleDisconnect(socket) {
        if (socket.userId) {
            this.connectedUsers.delete(socket.userId);
            logger.info('User disconnected', { userId: socket.userId, socketId: socket.id });
        }
    }
    /**
     * Cleanup stale connections
     */
    cleanupStaleConnections() {
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
    getIO() {
        return this.io;
    }
    /**
     * Handle send video
     */
    async handleSendVideo(socket, data) {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                videoData: data.videoData || data.video || data.body,
                filename: (0, schemas_1.sanitizeFilename)(data.filename || `video_${Date.now()}.mp4`) || `video_${Date.now()}.mp4`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'video',
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                videoData: data?.videoData || data?.video || data?.body,
                filename: (0, schemas_1.sanitizeFilename)(data?.filename || `video_${Date.now()}.mp4`) || `video_${Date.now()}.mp4`,
            };
        const validated = (0, schemas_1.validateInput)(schemas_1.videoUploadSchema, normalizedData);
        const sanitizedFilename = (0, schemas_1.sanitizeFilename)(validated.filename);
        const tempPath = path_1.default.join(config_1.CONFIG.PATHS.VIDEOS, sanitizedFilename);
        try {
            const buffer = Buffer.from(validated.videoData, 'base64');
            if (!fs_1.default.existsSync(config_1.CONFIG.PATHS.VIDEOS)) {
                fs_1.default.mkdirSync(config_1.CONFIG.PATHS.VIDEOS, { recursive: true });
            }
            fs_1.default.writeFileSync(tempPath, buffer);
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
        }
        catch (error) {
            if (fs_1.default.existsSync(tempPath)) {
                fs_1.default.unlinkSync(tempPath);
            }
            throw error;
        }
    }
    /**
     * Handle send audio
     */
    async handleSendAudio(socket, data) {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                audioData: data.audioData || data.audio,
                filename: (0, schemas_1.sanitizeFilename)(data.filename || `audio_${Date.now()}.ogg`) || `audio_${Date.now()}.ogg`,
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'audio',
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    seconds: data?.seconds,
                    waveform: data?.waveform,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                audioData: data?.audioData || data?.audio || data?.audioBase64,
                filename: (0, schemas_1.sanitizeFilename)(data?.filename || `audio_${Date.now()}.ogg`) || `audio_${Date.now()}.ogg`,
            };
        const validated = (0, schemas_1.validateInput)(schemas_1.audioUploadSchema, normalizedData);
        const sanitizedFilename = (0, schemas_1.sanitizeFilename)(validated.filename);
        const tempPath = path_1.default.join(config_1.CONFIG.PATHS.AUDIO, sanitizedFilename);
        try {
            const buffer = Buffer.from(validated.audioData, 'base64');
            if (!fs_1.default.existsSync(config_1.CONFIG.PATHS.AUDIO)) {
                fs_1.default.mkdirSync(config_1.CONFIG.PATHS.AUDIO, { recursive: true });
            }
            fs_1.default.writeFileSync(tempPath, buffer);
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
        }
        catch (error) {
            if (fs_1.default.existsSync(tempPath)) {
                fs_1.default.unlinkSync(tempPath);
            }
            throw error;
        }
    }
    /**
     * Handle send document
     */
    async handleSendDocument(socket, data) {
        const contextInfo = this.buildContextInfoFromPayload(data?.message || data, data?.message?.phone || data?.phone || '');
        const normalizedData = data?.message
            ? {
                ...data,
                message: {
                    ...data.message,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                documentData: data.documentData || data.document || data.file,
                filename: (0, schemas_1.sanitizeFilename)(data.filename || `document_${Date.now()}.bin`) || `document_${Date.now()}.bin`,
                mimetype: data.mimetype || 'application/octet-stream',
            }
            : {
                message: {
                    id: data?.id,
                    chatId: data?.chatId,
                    phone: data?.phone,
                    message: data?.caption || data?.message || '',
                    messageType: 'document',
                    replyToMessageId: data?.replyToId,
                    isFromMe: true,
                    ...(contextInfo ? { contextInfo } : {}),
                },
                documentData: data?.documentData || data?.document || data?.file,
                filename: (0, schemas_1.sanitizeFilename)(data?.filename || `document_${Date.now()}.bin`) || `document_${Date.now()}.bin`,
                mimetype: data?.mimetype || 'application/octet-stream',
            };
        const validated = (0, schemas_1.validateInput)(schemas_1.documentUploadSchema, normalizedData);
        const sanitizedFilename = (0, schemas_1.sanitizeFilename)(validated.filename);
        const tempPath = path_1.default.join(config_1.CONFIG.PATHS.DOCUMENTS, sanitizedFilename);
        try {
            const buffer = Buffer.from(validated.documentData, 'base64');
            if (!fs_1.default.existsSync(config_1.CONFIG.PATHS.DOCUMENTS)) {
                fs_1.default.mkdirSync(config_1.CONFIG.PATHS.DOCUMENTS, { recursive: true });
            }
            fs_1.default.writeFileSync(tempPath, buffer);
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
        }
        catch (error) {
            if (fs_1.default.existsSync(tempPath)) {
                fs_1.default.unlinkSync(tempPath);
            }
            throw error;
        }
    }
    /**
     * Handle forward message
     */
    async handleForwardMessage(socket, data) {
        const validated = (0, schemas_1.validateInput)(schemas_1.forwardMessageSchema, data);
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
                Participant: this.toParticipantJid(validated.originalMessage.contactId ||
                    validated.originalMessage.ContactId ||
                    validated.originalMessage.phone ||
                    validated.targetPhone),
                IsForwarded: true,
                MentionedJID: [],
                ...(validated.originalMessage.message ? { QuotedMessage: { conversation: validated.originalMessage.message } } : {}),
            },
        };
        let result;
        if (forwardedMessage.messageType === 'text' || !forwardedMessage.messageType) {
            result = await this.messageSender.sendMessage(forwardedMessage, currentUser);
        }
        else if (forwardedMessage.mediaPath && fs_1.default.existsSync(forwardedMessage.mediaPath)) {
            const mockFile = {
                path: forwardedMessage.mediaPath,
                filename: path_1.default.basename(forwardedMessage.mediaPath),
                mimetype: forwardedMessage.messageType === 'image' ? 'image/jpeg' :
                    forwardedMessage.messageType === 'video' ? 'video/mp4' :
                        forwardedMessage.messageType === 'audio' ? 'audio/ogg' : 'application/octet-stream',
            };
            if (forwardedMessage.messageType === 'image') {
                result = await this.messageSender.sendImage(forwardedMessage, mockFile, currentUser);
            }
            else if (forwardedMessage.messageType === 'video') {
                result = await this.messageSender.sendVideo(forwardedMessage, mockFile, currentUser);
            }
            else if (forwardedMessage.messageType === 'audio') {
                result = await this.messageSender.sendAudio(forwardedMessage, mockFile, currentUser);
            }
            else {
                result = await this.messageSender.sendDocument(forwardedMessage, mockFile, currentUser);
            }
        }
        else {
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
    async handleCancelRecording(socket, data) {
        const filename = data?.filename;
        logger.debug('Recording cancelled', { filename, socketId: socket.id });
        if (filename) {
            const sanitizedFilename = (0, schemas_1.sanitizeFilename)(filename);
            const tempPath = path_1.default.join(config_1.CONFIG.PATHS.AUDIO, sanitizedFilename);
            if (fs_1.default.existsSync(tempPath)) {
                try {
                    fs_1.default.unlinkSync(tempPath);
                    logger.debug('Cleaned up cancelled recording', { filename: sanitizedFilename });
                }
                catch (error) {
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
exports.SocketHandler = SocketHandler;
// Export singleton instance
exports.socketHandler = new SocketHandler();
