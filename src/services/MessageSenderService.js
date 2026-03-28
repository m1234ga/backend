"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageSenderService = exports.MessageSenderService = void 0;
const uuid_1 = require("uuid");
const fs_1 = __importDefault(require("fs"));
const WhatsAppApiService_1 = require("./WhatsAppApiService");
const DatabaseService_1 = require("./DatabaseService");
const logger_1 = require("../utils/logger");
const SocketHandler_1 = require("../handlers/SocketHandler");
const constants_1 = require("../constants");
const timezone_1 = require("../utils/timezone");
const logger = (0, logger_1.createLogger)('MessageSenderService');
/**
 * Message Sender Service - Handles all outgoing messages
 */
class MessageSenderService {
    static instance;
    constructor() {
        logger.info('MessageSenderService initialized');
    }
    static getInstance() {
        if (!MessageSenderService.instance) {
            MessageSenderService.instance = new MessageSenderService();
        }
        return MessageSenderService.instance;
    }
    /**
     * Retrieve LID from WuzAPI for a given phone number
     * Returns the LID formatted like getChatId but without the @lid suffix
     */
    async retrieveLidFromWuzAPI(phone) {
        try {
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            if (!cleanPhone) {
                return { error: 'Invalid phone number' };
            }
            const response = await WhatsAppApiService_1.whatsAppApiService.getUserLid(cleanPhone);
            if (!response.success || !response.data) {
                logger.warn('Failed to retrieve LID from WuzAPI', { phone: cleanPhone, error: response.error });
                return { error: response.error };
            }
            // Extract LID from response (format: "123456789" without @lid)
            const lid = response.data.lid || response.data.Lid || response.data.ID || response.data.id;
            if (!lid) {
                logger.warn('LID not found in WuzAPI response', { phone: cleanPhone, response: response.data });
                return { error: 'LID not found in response' };
            }
            const sanitizedLid = lid.toString().trim().split('@')[0] || '';
            if (!sanitizedLid) {
                return { error: 'LID could not be sanitized' };
            }
            logger.debug('Successfully retrieved LID from WuzAPI', { phone: cleanPhone, lid: sanitizedLid });
            return { lid: sanitizedLid };
        }
        catch (err) {
            logger.error('Error retrieving LID from WuzAPI', err, { phone });
            return { error: err instanceof Error ? err.message : 'Unknown error' };
        }
    }
    /**
     * Build forward/reply context for WhatsApp
     */
    buildContext(message) {
        const normalizeParticipant = (value) => {
            const raw = (value || '').trim();
            if (!raw)
                return '';
            if (raw.includes('@'))
                return raw;
            return `${raw}${constants_1.WHATSAPP.DOMAIN}`;
        };
        const ctx = message.forwardContext || message.contextInfo;
        if (!ctx) {
            // Build reply context if replyToMessage exists
            if (message.replyToMessage) {
                const reply = message.replyToMessage;
                const participant = normalizeParticipant(reply.contactId || reply.ContactId || message.phone);
                let quotedMessage = { conversation: reply.message || '' };
                const msgType = reply.messageType || constants_1.MESSAGE_TYPES.TEXT;
                if (msgType === constants_1.MESSAGE_TYPES.IMAGE) {
                    quotedMessage = { imageMessage: { caption: reply.message || '' } };
                }
                else if (msgType === constants_1.MESSAGE_TYPES.VIDEO) {
                    quotedMessage = { videoMessage: { caption: reply.message || '' } };
                }
                else if (msgType === constants_1.MESSAGE_TYPES.AUDIO) {
                    quotedMessage = { audioMessage: { seconds: reply.seconds || 0 } };
                }
                return {
                    StanzaId: reply.id || '',
                    Participant: participant || '',
                    QuotedMessage: quotedMessage,
                    IsForwarded: false,
                    MentionedJID: [],
                };
            }
            return undefined;
        }
        return {
            StanzaId: ctx.StanzaId || ctx.stanzaId || '',
            Participant: normalizeParticipant(ctx.Participant ||
                ctx.participant ||
                ctx.contactId ||
                ctx.ContactId ||
                message.replyToMessage?.contactId ||
                message.replyToMessage?.ContactId ||
                message.phone),
            IsForwarded: !!ctx.IsForwarded || !!ctx.isForwarded,
            MentionedJID: ctx.MentionedJID || ctx.mentionedJID || ctx.mentions || [],
            ...(ctx.QuotedMessage || ctx.quotedMessage ? { QuotedMessage: ctx.QuotedMessage || ctx.quotedMessage } : {}),
        };
    }
    resolveTimestamp(rawData) {
        const unixLike = rawData?.Timestamp ?? rawData?.TimeStamp ?? Date.now();
        const asNumber = Number(unixLike);
        const millis = Number.isFinite(asNumber)
            ? (asNumber > 9_999_999_999 ? asNumber : asNumber * 1000)
            : Date.now();
        return (0, timezone_1.adjustToConfiguredTimezone)(new Date(millis));
    }
    normalizeReactionTarget(target) {
        const raw = (target || '').trim();
        if (!raw)
            return '';
        if (raw.endsWith(constants_1.WHATSAPP.GROUP_DOMAIN)) {
            return raw;
        }
        if (raw.endsWith('@c.us')) {
            return `${raw.split('@')[0]}${constants_1.WHATSAPP.DOMAIN}`;
        }
        if (raw.includes('@')) {
            return raw;
        }
        return `${raw}${constants_1.WHATSAPP.DOMAIN}`;
    }
    /**
     * Save message to database
     */
    async saveMessageToDb(messageId, message, messageType, content, timestamp, mediaPath, userId) {
        const messageData = {
            id: messageId,
            chatId: message.chatId,
            message: content,
            timestamp,
            messageType,
            isFromMe: true,
            contactId: message.ContactId || message.phone,
            mediaPath,
            userId,
            replyToMessageId: message.replyToMessageId,
        };
        return await DatabaseService_1.databaseService.upsertMessage(messageData);
    }
    /**
     * Update chat in database
     */
    async updateChat(message, content, timestamp, userId) {
        return await DatabaseService_1.databaseService.upsertChat(message.chatId, content, timestamp, 0, // unreadCount
        false, // isOnline
        false, // isTyping
        message.pushName ?? '', message.ContactId || message.phone, userId || 'current_user', { callerFunctionName: 'updateChat' }, true // isFromMe
        );
    }
    async emitChatUpdated(io, updatedChat, message, fallbackLastMessage, fallbackTimestamp) {
        if (!updatedChat || updatedChat.length === 0)
            return;
        const dbChat = updatedChat[0] || {};
        const emittedChatId = String(dbChat.id || message.chatId || '');
        const groupName = emittedChatId
            ? await DatabaseService_1.databaseService.getGroupName(emittedChatId).catch(() => null)
            : null;
        const isGroup = Boolean(groupName) || emittedChatId.includes('@g.us') || (message.phone || '').includes('@g.us');
        io.emit(constants_1.SOCKET_EVENTS.CHAT_UPDATED, {
            ...dbChat,
            id: emittedChatId,
            name: groupName || dbChat.name || dbChat.pushname || message.pushName || emittedChatId,
            lastMessage: dbChat.lastMessage || fallbackLastMessage,
            lastMessageTime: dbChat.lastMessageTime || fallbackTimestamp,
            phone: isGroup ? emittedChatId : (dbChat.phone || message.phone || emittedChatId),
            contactId: dbChat.contactId || message.ContactId || message.phone || emittedChatId,
        });
    }
    /**
     * Send text message
     */
    async sendMessage(message, currentUser) {
        try {
            logger.debug('Sending text message', { chatId: message.chatId, replyTo: message.replyToMessageId });
            if (!message.phone) {
                return { success: false, error: 'Phone number is required' };
            }
            // Retrieve LID and use it as chatId for 1-on-1 chats where phone === chatId
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
                logger.debug('Using LID as chatId', { phone: message.phone, lid: contactLid });
            }
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendTextMessage(message.phone, message.message ?? '', messageId, contextInfo);
            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const updatedChat = await this.updateChat(message, message.message ?? '', timestamp, currentUser?.id);
            // Save to database
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.TEXT, message.message ?? '', timestamp, undefined, currentUser?.id);
            // Emit socket events for real-time updates
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId,
                    pushName: message.pushName
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, message.message ?? '', timestamp);
                }
            }
            logger.info('Text message sent successfully', { messageId, chatId: message.chatId });
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send text message', error, { chatId: message.chatId });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send image message
     */
    async sendImage(message, imageFile, currentUser) {
        try {
            logger.debug('Sending image message', { chatId: message.chatId, filename: imageFile.filename });
            if (!message.phone || !imageFile) {
                return { success: false, error: 'Phone and image file are required' };
            }
            // Retrieve LID and use it as chatId for 1-on-1 chats where phone === chatId
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
                logger.debug('Using LID as chatId', { phone: message.phone, lid: contactLid });
            }
            const imageBuffer = fs_1.default.readFileSync(imageFile.path);
            const base64Image = imageBuffer.toString('base64');
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendImageMessage(message.phone, base64Image, messageId, message.message || '', contextInfo);
            if (!result.success) {
                this.cleanupFile(imageFile.path);
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const mediaPath = `imgs/${imageFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Image]', timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.IMAGE, message.message || '[Image]', timestamp, mediaPath, currentUser?.id);
            // Emit socket events for real-time updates
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId,
                    pushName: message.pushName
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, message.message || '[Image]', timestamp);
                }
            }
            logger.info('Image message sent successfully', { messageId, chatId: message.chatId });
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send image message', error, { chatId: message.chatId });
            this.cleanupFile(imageFile?.path);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send video message
     */
    async sendVideo(message, videoFile, currentUser) {
        try {
            logger.debug('Sending video message', { chatId: message.chatId, filename: videoFile.filename });
            if (!message.phone || !videoFile) {
                return { success: false, error: 'Phone and video file are required' };
            }
            // Retrieve LID and use it as chatId for 1-on-1 chats where phone === chatId
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
                logger.debug('Using LID as chatId', { phone: message.phone, lid: contactLid });
            }
            const videoBuffer = fs_1.default.readFileSync(videoFile.path);
            const base64Video = videoBuffer.toString('base64');
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendVideoMessage(message.phone, base64Video, messageId, message.message || '', contextInfo);
            if (!result.success) {
                this.cleanupFile(videoFile.path);
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const mediaPath = `video/${videoFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Video]', timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.VIDEO, message.message || '[Video]', timestamp, mediaPath, currentUser?.id);
            // Emit socket events for real-time updates
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId,
                    pushName: message.pushName
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, message.message || '[Video]', timestamp);
                }
            }
            logger.info('Video message sent successfully', { messageId, chatId: message.chatId });
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send video message', error, { chatId: message.chatId });
            this.cleanupFile(videoFile?.path);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send audio message
     */
    async sendAudio(message, audioFile, currentUser) {
        try {
            logger.debug('Sending audio message', { chatId: message.chatId, filename: audioFile.filename });
            if (!message.phone || !audioFile) {
                return { success: false, error: 'Phone and audio file are required' };
            }
            // Retrieve LID and use it as chatId for 1-on-1 chats where phone === chatId
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
                logger.debug('Using LID as chatId', { phone: message.phone, lid: contactLid });
            }
            const audioBuffer = fs_1.default.readFileSync(audioFile.path);
            const base64Audio = audioBuffer.toString('base64');
            const messageId = message.id || (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendAudioMessage(message.phone, base64Audio, messageId, true, // PTT
            message.seconds, message.waveform, contextInfo);
            if (!result.success) {
                this.cleanupFile(audioFile.path);
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const mediaPath = `audio/${audioFile.filename}`;
            const updatedChat = await this.updateChat(message, '[Audio]', timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.AUDIO, '[Audio]', timestamp, mediaPath, currentUser?.id);
            // Emit socket events for real-time updates
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId,
                    pushName: message.pushName
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, '[Audio]', timestamp);
                }
            }
            logger.info('Audio message sent successfully', { messageId, chatId: message.chatId });
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send audio message', error, { chatId: message.chatId });
            this.cleanupFile(audioFile?.path);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send document message
     */
    async sendDocument(message, documentFile, currentUser) {
        try {
            logger.debug('Sending document message', { chatId: message.chatId, filename: documentFile.filename });
            if (!message.phone || !documentFile) {
                return { success: false, error: 'Phone and document file are required' };
            }
            // Retrieve LID and use it as chatId for 1-on-1 chats where phone === chatId
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
                logger.debug('Using LID as chatId', { phone: message.phone, lid: contactLid });
            }
            const documentBuffer = fs_1.default.readFileSync(documentFile.path);
            const base64Document = documentBuffer.toString('base64');
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendDocumentMessage(message.phone, base64Document, documentFile.filename, messageId, contextInfo);
            if (!result.success) {
                this.cleanupFile(documentFile.path);
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = (0, timezone_1.adjustToConfiguredTimezone)(new Date(result.data?.data?.Timestamp * 1000 || result.data?.data?.TimeStamp * 1000 || Date.now()));
            const mediaPath = `docs/${documentFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Document]', timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.DOCUMENT, message.message || documentFile.filename || '[Document]', timestamp, mediaPath, currentUser?.id);
            // Emit socket events for real-time updates
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId,
                    pushName: message.pushName
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, message.message || '[Document]', timestamp);
                }
            }
            logger.info('Document message sent successfully', { messageId, chatId: message.chatId });
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send document message', error, { chatId: message.chatId });
            this.cleanupFile(documentFile?.path);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send sticker message
     */
    async sendSticker(message, stickerFile, currentUser) {
        try {
            logger.debug('Sending sticker message', { chatId: message.chatId, filename: stickerFile.filename });
            if (!message.phone || !stickerFile) {
                return { success: false, error: 'Phone and sticker file are required' };
            }
            const { lid: contactLid } = await this.retrieveLidFromWuzAPI(message.phone);
            const isGroup = message.chatId.includes('@g.us');
            if (contactLid && !isGroup && message.phone.replace(/[^0-9]/g, '') === message.chatId.replace(/[^0-9]/g, '')) {
                message = { ...message, chatId: contactLid };
            }
            const stickerBuffer = fs_1.default.readFileSync(stickerFile.path);
            const base64Sticker = stickerBuffer.toString('base64');
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendStickerMessage(message.phone, base64Sticker, messageId, contextInfo);
            if (!result.success) {
                this.cleanupFile(stickerFile.path);
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const mediaPath = `imgs/${stickerFile.filename}`;
            const updatedChat = await this.updateChat(message, '[Sticker]', timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.STICKER, '[Sticker]', timestamp, mediaPath, currentUser?.id);
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, '[Sticker]', timestamp);
                }
            }
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send sticker message', error, { chatId: message.chatId });
            this.cleanupFile(stickerFile?.path);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send location message
     */
    async sendLocation(message, currentUser) {
        try {
            if (!message.phone || typeof message.latitude !== 'number' || typeof message.longitude !== 'number') {
                return { success: false, error: 'Phone, latitude, and longitude are required' };
            }
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendLocationMessage(message.phone, message.latitude, message.longitude, messageId, message.locationName, message.locationAddress, contextInfo);
            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            // Always persist coordinates so the UI can open map links from history/sync messages.
            const content = `[Location] ${message.latitude.toFixed(6)},${message.longitude.toFixed(6)}${message.locationName ? ` (${message.locationName})` : ''}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.LOCATION, content, timestamp, undefined, currentUser?.id);
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send location message', error, { chatId: message.chatId });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send contact message
     */
    async sendContact(message, currentUser) {
        try {
            if (!message.phone || !message.contactName || !message.vcard) {
                return { success: false, error: 'Phone, contact name, and vcard are required' };
            }
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendContactMessage(message.phone, message.contactName, message.vcard, messageId, contextInfo);
            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const vcardPhoneMatch = String(message.vcard || '').match(/TEL[^:]*:([^\r\n]+)/i);
            const parsedPhone = vcardPhoneMatch ? vcardPhoneMatch[1].replace(/[\s-]/g, '').trim() : '';
            // Persist contact phone in a parseable format so UI can open call/details from stored history.
            const content = `[Contact] ${message.contactName}${parsedPhone ? `|${parsedPhone}` : ''}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.CONTACT, content, timestamp, undefined, currentUser?.id);
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send contact message', error, { chatId: message.chatId });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send poll message
     */
    async sendPoll(message, currentUser) {
        try {
            if (!message.phone || !message.pollName || !Array.isArray(message.pollOptions) || message.pollOptions.length < 2) {
                return { success: false, error: 'Phone, poll name, and at least two options are required' };
            }
            const messageId = (0, uuid_1.v4)();
            const contextInfo = this.buildContext(message);
            const result = await WhatsAppApiService_1.whatsAppApiService.sendPollMessage(message.phone, message.pollName, message.pollOptions, messageId, message.pollSelectableCount || 1, contextInfo);
            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }
            const timestamp = this.resolveTimestamp(result.data?.data);
            const content = message.message || `[Poll] ${message.pollName}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(messageId, message, constants_1.MESSAGE_TYPES.POLL, content, timestamp, undefined, currentUser?.id);
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }
            return { success: true, messageId };
        }
        catch (error) {
            logger.error('Failed to send poll message', error, { chatId: message.chatId });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Send reaction
     */
    async sendReaction(chatId, messageId, emoji) {
        try {
            logger.debug('Sending reaction', { chatId, messageId, emoji });
            const reactionTarget = this.normalizeReactionTarget(chatId);
            if (!reactionTarget) {
                return { success: false, error: 'Phone number is required' };
            }
            const result = await WhatsAppApiService_1.whatsAppApiService.sendReaction(reactionTarget, messageId, emoji);
            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }
            logger.info('Reaction sent successfully', { chatId, messageId });
            return { success: true };
        }
        catch (error) {
            logger.error('Failed to send reaction', error, { chatId, messageId });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error',
            };
        }
    }
    /**
     * Cleanup file with error handling
     */
    cleanupFile(filePath) {
        if (!filePath)
            return;
        try {
            if (fs_1.default.existsSync(filePath)) {
                fs_1.default.unlinkSync(filePath);
                logger.debug('File cleaned up', { filePath });
            }
        }
        catch (error) {
            logger.warn('Failed to cleanup file', { filePath, error });
        }
    }
}
exports.MessageSenderService = MessageSenderService;
exports.messageSenderService = MessageSenderService.getInstance();
