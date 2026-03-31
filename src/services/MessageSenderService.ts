import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { whatsAppApiService } from './WhatsAppApiService';
import { databaseService, MessageData } from './DatabaseService';
import { createLogger } from '../utils/logger';
import { socketHandler } from '../handlers/SocketHandler';
import { CONFIG } from '../config';
import { MESSAGE_TYPES, WHATSAPP, SOCKET_EVENTS } from '../constants';
import { adjustToConfiguredTimezone } from '../utils/timezone';

const logger = createLogger('MessageSenderService');

export interface ChatMessage {
    id?: string;
    chatId: string;
    phone: string;
    message?: string;
    messageType?: string;
    timestamp?: Date | string;
    timeStamp?: Date | string;
    ContactId?: string;
    pushName?: string;
    isFromMe?: boolean;
    isEdit?: boolean;
    isRead?: boolean;
    isDelivered?: boolean;
    replyToMessageId?: string;
    replyToMessage?: any;
    seconds?: number;
    waveform?: number[];
    forwardContext?: any;
    contextInfo?: any;
    mediaPath?: string;
    latitude?: number;
    longitude?: number;
    locationName?: string;
    locationAddress?: string;
    contactName?: string;
    vcard?: string;
    pollName?: string;
    pollOptions?: string[];
    pollSelectableCount?: number;
}

export interface FileData {
    path: string;
    filename: string;
    mimetype: string;
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
    details?: any;
}

export interface CurrentUser {
    id: string;
    username: string;
    email?: string;
}

/**
 * Message Sender Service - Handles all outgoing messages
 */
export class MessageSenderService {
    private static instance: MessageSenderService;

    private constructor() {
        logger.info('MessageSenderService initialized');
    }

    public static getInstance(): MessageSenderService {
        if (!MessageSenderService.instance) {
            MessageSenderService.instance = new MessageSenderService();
        }
        return MessageSenderService.instance;
    }

    /**
     * Retrieve LID from WuzAPI for a given phone number
     * Returns the LID formatted like getChatId but without the @lid suffix
     */
    private async retrieveLidFromWuzAPI(phone: string): Promise<{ lid?: string; error?: string }> {
        try {
            const cleanPhone = phone.replace(/[^0-9]/g, '');
            if (!cleanPhone) {
                return { error: 'Invalid phone number' };
            }

            const response = await whatsAppApiService.getUserLid(cleanPhone);
            
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
        } catch (err) {
            logger.error('Error retrieving LID from WuzAPI', err, { phone });
            return { error: err instanceof Error ? err.message : 'Unknown error' };
        }
    }

    /**
     * Build forward/reply context for WhatsApp
     */
    private buildContext(message: ChatMessage): any {
        const normalizeParticipant = (value?: string): string => {
            const raw = (value || '').trim();
            if (!raw) return '';
            if (raw.includes('@')) return raw;
            return `${raw}${WHATSAPP.DOMAIN}`;
        };

        const ctx = message.forwardContext || message.contextInfo;

        if (!ctx) {
            // Build reply context if replyToMessage exists
            if (message.replyToMessage) {
                const reply = message.replyToMessage;
                const participant = normalizeParticipant(
                    (reply as any).contactId || (reply as any).ContactId || message.phone
                );

                let quotedMessage: any = { conversation: reply.message || '' };
                const msgType = reply.messageType || MESSAGE_TYPES.TEXT;

                if (msgType === MESSAGE_TYPES.IMAGE) {
                    quotedMessage = { imageMessage: { caption: reply.message || '' } };
                } else if (msgType === MESSAGE_TYPES.VIDEO) {
                    quotedMessage = { videoMessage: { caption: reply.message || '' } };
                } else if (msgType === MESSAGE_TYPES.AUDIO) {
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
            Participant: normalizeParticipant(
                ctx.Participant ||
                ctx.participant ||
                ctx.contactId ||
                ctx.ContactId ||
                (message.replyToMessage as any)?.contactId ||
                (message.replyToMessage as any)?.ContactId ||
                message.phone
            ),
            IsForwarded: !!ctx.IsForwarded || !!ctx.isForwarded,
            MentionedJID: ctx.MentionedJID || ctx.mentionedJID || ctx.mentions || [],
            ...(ctx.QuotedMessage || ctx.quotedMessage ? { QuotedMessage: ctx.QuotedMessage || ctx.quotedMessage } : {}),
        };
    }

    private resolveTimestamp(rawData: any): Date {
        const unixLike = rawData?.Timestamp ?? rawData?.TimeStamp ?? Date.now();

        if (typeof unixLike === 'string') {
            const parsedMillis = Date.parse(unixLike);
            if (Number.isFinite(parsedMillis)) {
                return adjustToConfiguredTimezone(new Date(parsedMillis));
            }
        }

        const asNumber = Number(unixLike);
        const millis = Number.isFinite(asNumber)
            ? (asNumber > 9_999_999_999 ? asNumber : asNumber * 1000)
            : Date.now();
        return adjustToConfiguredTimezone(new Date(millis));
    }

    private getApiPayloadData(result: any): any {
        // WuzAPI may return either { success, data: {...} } or { success, data: { data: {...} } }
        return result?.data?.data ?? result?.data ?? {};
    }

    private hasValidAckTimestamp(rawTimestamp: any): boolean {
        if (rawTimestamp === undefined || rawTimestamp === null) return false;

        if (typeof rawTimestamp === 'string') {
            const parsedMillis = Date.parse(rawTimestamp);
            if (Number.isFinite(parsedMillis)) return true;

            const numeric = Number(rawTimestamp);
            return Number.isFinite(numeric);
        }

        if (typeof rawTimestamp === 'number') {
            return Number.isFinite(rawTimestamp);
        }

        return false;
    }

    private validateSendAcknowledgement(result: any): { isValid: boolean; payload?: any; error?: string } {
        const payload = this.getApiPayloadData(result);
        const details = String(payload?.Details ?? payload?.details ?? '').trim().toLowerCase();
        const providerMessageId = String(payload?.Id ?? payload?.id ?? '').trim();
        const rawTimestamp = payload?.Timestamp ?? payload?.TimeStamp ?? payload?.timestamp ?? payload?.timeStamp;

        if (details !== 'sent') {
            return { isValid: false, error: 'WhatsApp API response missing sent acknowledgement' };
        }

        if (!providerMessageId) {
            return { isValid: false, error: 'WhatsApp API response missing message Id' };
        }

        if (!this.hasValidAckTimestamp(rawTimestamp)) {
            return { isValid: false, error: 'WhatsApp API response missing valid Timestamp' };
        }

        return { isValid: true, payload };
    }

    private normalizeReactionTarget(target: string): string {
        const raw = (target || '').trim();
        if (!raw) return '';

        if (raw.endsWith(WHATSAPP.GROUP_DOMAIN)) {
            return raw;
        }

        if (raw.endsWith('@c.us')) {
            return `${raw.split('@')[0]}${WHATSAPP.DOMAIN}`;
        }

        if (raw.includes('@')) {
            return raw;
        }

        return `${raw}${WHATSAPP.DOMAIN}`;
    }

    /**
     * Save message to database
     */
    private async saveMessageToDb(
        messageId: string,
        message: ChatMessage,
        messageType: string,
        content: string,
        timestamp: Date | string,
        mediaPath?: string,
        userId?: string
    ): Promise<any> {
        const messageData: MessageData = {
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

        return await databaseService.upsertMessage(messageData);
    }

    /**
     * Update chat in database
     */
    private async updateChat(
        message: ChatMessage,
        content: string,
        timestamp: Date | string,
        userId?: string
    ): Promise<any> {
        return await databaseService.upsertChat(
            message.chatId,
            content,
            timestamp,
            0, // unreadCount
            false, // isOnline
            false, // isTyping
            message.pushName ?? '',
            message.ContactId || message.phone,
            userId || 'current_user',
            { callerFunctionName: 'updateChat' },
            true // isFromMe
        );
    }

    private async emitChatUpdated(
        io: any,
        updatedChat: any[] | undefined,
        message: ChatMessage,
        fallbackLastMessage: string,
        fallbackTimestamp: Date | string
    ): Promise<void> {
        if (!updatedChat || updatedChat.length === 0) return;

        const dbChat = updatedChat[0] || {};
        const emittedChatId = String(dbChat.id || message.chatId || '');
        const groupName = emittedChatId
            ? await databaseService.getGroupName(emittedChatId).catch(() => null)
            : null;
        const isGroup = Boolean(groupName) || emittedChatId.includes('@g.us') || (message.phone || '').includes('@g.us');

        io.emit(SOCKET_EVENTS.CHAT_UPDATED, {
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
    async sendMessage(message: ChatMessage, currentUser?: CurrentUser): Promise<SendResult> {
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

            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendTextMessage(
                message.phone,
                message.message ?? '',
                messageId,
                contextInfo
            );

            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);

            const updatedChat = await this.updateChat(message, message.message ?? '', timestamp, currentUser?.id);

            // Save to database
            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.TEXT,
                message.message ?? '',
                timestamp,
                undefined,
                currentUser?.id
            );

            // Emit socket events for real-time updates
            const io = socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
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
        } catch (error) {
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
    async sendImage(message: ChatMessage, imageFile: FileData, currentUser?: CurrentUser): Promise<SendResult> {
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

            const imageBuffer = fs.readFileSync(imageFile.path);
            const base64Image = imageBuffer.toString('base64');
            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendImageMessage(
                message.phone,
                base64Image,
                messageId,
                message.message || '',
                contextInfo
            );

            if (!result.success) {
                this.cleanupFile(imageFile.path);
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                this.cleanupFile(imageFile.path);
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);

            const mediaPath = `imgs/${imageFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Image]', timestamp, currentUser?.id);

            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.IMAGE,
                message.message || '[Image]',
                timestamp,
                mediaPath,
                currentUser?.id
            );

            // Emit socket events for real-time updates
            const io = socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
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
        } catch (error) {
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
    async sendVideo(message: ChatMessage, videoFile: FileData, currentUser?: CurrentUser): Promise<SendResult> {
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

            const videoBuffer = fs.readFileSync(videoFile.path);
            const base64Video = videoBuffer.toString('base64');
            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendVideoMessage(
                message.phone,
                base64Video,
                messageId,
                message.message || '',
                contextInfo
            );

            if (!result.success) {
                this.cleanupFile(videoFile.path);
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                this.cleanupFile(videoFile.path);
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);

            const mediaPath = `video/${videoFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Video]', timestamp, currentUser?.id);

            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.VIDEO,
                message.message || '[Video]',
                timestamp,
                mediaPath,
                currentUser?.id
            );

            // Emit socket events for real-time updates
            const io = socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
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
        } catch (error) {
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
    async sendAudio(message: ChatMessage, audioFile: FileData, currentUser?: CurrentUser): Promise<SendResult> {
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

            const audioBuffer = fs.readFileSync(audioFile.path);
            const base64Audio = audioBuffer.toString('base64');
            const messageId = message.id || uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendAudioMessage(
                message.phone,
                base64Audio,
                messageId,
                true, // PTT
                message.seconds,
                message.waveform,
                contextInfo
            );

            if (!result.success) {
                this.cleanupFile(audioFile.path);
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                this.cleanupFile(audioFile.path);
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);

            const mediaPath = `audio/${audioFile.filename}`;
            const updatedChat = await this.updateChat(message, '[Audio]', timestamp, currentUser?.id);

            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.AUDIO,
                '[Audio]',
                timestamp,
                mediaPath,
                currentUser?.id
            );

            // Emit socket events for real-time updates
            const io = socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
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
        } catch (error) {
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
    async sendDocument(message: ChatMessage, documentFile: FileData, currentUser?: CurrentUser): Promise<SendResult> {
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

            const documentBuffer = fs.readFileSync(documentFile.path);
            const base64Document = documentBuffer.toString('base64');
            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendDocumentMessage(
                message.phone,
                base64Document,
                documentFile.filename,
                messageId,
                contextInfo
            );

            if (!result.success) {
                this.cleanupFile(documentFile.path);
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                this.cleanupFile(documentFile.path);
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);

            const mediaPath = `docs/${documentFile.filename}`;
            const updatedChat = await this.updateChat(message, message.message || '[Document]', timestamp, currentUser?.id);

            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.DOCUMENT,
                message.message || documentFile.filename || '[Document]',
                timestamp,
                mediaPath,
                currentUser?.id
            );

            // Emit socket events for real-time updates
            const io = socketHandler.getIO();
            if (io) {
                const tempId = message.id;
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
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
        } catch (error) {
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
    async sendSticker(message: ChatMessage, stickerFile: FileData, currentUser?: CurrentUser): Promise<SendResult> {
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

            const stickerBuffer = fs.readFileSync(stickerFile.path);
            const base64Sticker = stickerBuffer.toString('base64');
            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);

            const result = await whatsAppApiService.sendStickerMessage(
                message.phone,
                base64Sticker,
                messageId,
                contextInfo
            );

            if (!result.success) {
                this.cleanupFile(stickerFile.path);
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                this.cleanupFile(stickerFile.path);
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);
            const mediaPath = `imgs/${stickerFile.filename}`;
            const updatedChat = await this.updateChat(message, '[Sticker]', timestamp, currentUser?.id);

            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.STICKER,
                '[Sticker]',
                timestamp,
                mediaPath,
                currentUser?.id
            );

            const io = socketHandler.getIO();
            if (io) {
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });

                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, '[Sticker]', timestamp);
                }
            }

            return { success: true, messageId };
        } catch (error) {
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
    async sendLocation(message: ChatMessage, currentUser?: CurrentUser): Promise<SendResult> {
        try {
            if (!message.phone || typeof message.latitude !== 'number' || typeof message.longitude !== 'number') {
                return { success: false, error: 'Phone, latitude, and longitude are required' };
            }

            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);
            const result = await whatsAppApiService.sendLocationMessage(
                message.phone,
                message.latitude,
                message.longitude,
                messageId,
                message.locationName,
                message.locationAddress,
                contextInfo
            );

            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);
            // Always persist coordinates so the UI can open map links from history/sync messages.
            const content = `[Location] ${message.latitude.toFixed(6)},${message.longitude.toFixed(6)}${message.locationName ? ` (${message.locationName})` : ''}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.LOCATION,
                content,
                timestamp,
                undefined,
                currentUser?.id
            );

            const io = socketHandler.getIO();
            if (io) {
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }

            return { success: true, messageId };
        } catch (error) {
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
    async sendContact(message: ChatMessage, currentUser?: CurrentUser): Promise<SendResult> {
        try {
            if (!message.phone || !message.contactName || !message.vcard) {
                return { success: false, error: 'Phone, contact name, and vcard are required' };
            }

            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);
            const result = await whatsAppApiService.sendContactMessage(
                message.phone,
                message.contactName,
                message.vcard,
                messageId,
                contextInfo
            );

            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);
            const vcardPhoneMatch = String(message.vcard || '').match(/TEL[^:]*:([^\r\n]+)/i);
            const parsedPhone = vcardPhoneMatch ? vcardPhoneMatch[1].replace(/[\s-]/g, '').trim() : '';
            // Persist contact phone in a parseable format so UI can open call/details from stored history.
            const content = `[Contact] ${message.contactName}${parsedPhone ? `|${parsedPhone}` : ''}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.CONTACT,
                content,
                timestamp,
                undefined,
                currentUser?.id
            );

            const io = socketHandler.getIO();
            if (io) {
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }

            return { success: true, messageId };
        } catch (error) {
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
    async sendPoll(message: ChatMessage, currentUser?: CurrentUser): Promise<SendResult> {
        try {
            if (!message.phone || !message.pollName || !Array.isArray(message.pollOptions) || message.pollOptions.length < 2) {
                return { success: false, error: 'Phone, poll name, and at least two options are required' };
            }

            const messageId = uuidv4();
            const contextInfo = this.buildContext(message);
            const result = await whatsAppApiService.sendPollMessage(
                message.phone,
                message.pollName,
                message.pollOptions,
                messageId,
                message.pollSelectableCount || 1,
                contextInfo
            );

            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }

            const ack = this.validateSendAcknowledgement(result);
            if (!ack.isValid) {
                logger.warn('Skipping DB write due to invalid send acknowledgement payload', {
                    chatId: message.chatId,
                    payload: this.getApiPayloadData(result),
                });
                return { success: false, error: ack.error, details: result.data };
            }

            const timestamp = this.resolveTimestamp(ack.payload);
            const content = message.message || `[Poll] ${message.pollName}`;
            const updatedChat = await this.updateChat(message, content, timestamp, currentUser?.id);
            const savedMessage = await this.saveMessageToDb(
                messageId,
                message,
                MESSAGE_TYPES.POLL,
                content,
                timestamp,
                undefined,
                currentUser?.id
            );

            const io = socketHandler.getIO();
            if (io) {
                io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    tempId: message.id,
                    pushName: message.pushName,
                });
                if (updatedChat && updatedChat.length > 0) {
                    await this.emitChatUpdated(io, updatedChat, message, content, timestamp);
                }
            }

            return { success: true, messageId };
        } catch (error) {
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
    async sendReaction(chatId: string, messageId: string, emoji: string): Promise<SendResult> {
        try {
            logger.debug('Sending reaction', { chatId, messageId, emoji });

            const reactionTarget = this.normalizeReactionTarget(chatId);
            if (!reactionTarget) {
                return { success: false, error: 'Phone number is required' };
            }

            const result = await whatsAppApiService.sendReaction(reactionTarget, messageId, emoji);

            if (!result.success) {
                return { success: false, error: result.error, details: result.details };
            }

            logger.info('Reaction sent successfully', { chatId, messageId });
            return { success: true };
        } catch (error) {
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
    private cleanupFile(filePath?: string): void {
        if (!filePath) return;

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.debug('File cleaned up', { filePath });
            }
        } catch (error) {
            logger.warn('Failed to cleanup file', { filePath, error });
        }
    }
}

export const messageSenderService = MessageSenderService.getInstance();
