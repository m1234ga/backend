"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const DatabaseService_1 = require("./src/services/DatabaseService");
const SocketHandler_1 = require("./src/handlers/SocketHandler");
const logger_1 = require("./src/utils/logger");
const config_1 = require("./src/config");
const WhatsAppApiService_1 = require("./src/services/WhatsAppApiService");
const ContactSyncService_1 = require("./src/services/ContactSyncService");
const timezone_1 = require("./src/utils/timezone");
const constants_1 = require("./src/constants");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger = (0, logger_1.createLogger)('WhatsAppHooks');
let cachedUserJid = null;
let cachedUserJidPromise = null;
class ProcessWhatsAppHooks {
    userJid = 'system';
    lidToPnMap = new Map();
    // private constructor — can't be called directly
    constructor() { }
    // static async factory — caller can await this
    static async create(HookObj) {
        const instance = new ProcessWhatsAppHooks();
        await instance.initializeUser();
        await instance.handleWebhook(HookObj);
    }
    async initializeUser() {
        try {
            if (cachedUserJid) {
                this.userJid = cachedUserJid;
                return;
            }
            if (!cachedUserJidPromise) {
                cachedUserJidPromise = (async () => {
                    const jid = await DatabaseService_1.databaseService.getUserJid(config_1.CONFIG.WUZAPI.TOKEN);
                    return jid || 'system';
                })();
            }
            const resolvedJid = await cachedUserJidPromise;
            cachedUserJid = resolvedJid;
            this.userJid = resolvedJid;
        }
        catch (err) {
            logger.error('Failed to initialize user JID', err);
            this.userJid = cachedUserJid || 'system';
        }
    }
    ensureJid(value, suffix) {
        const jid = (value || '').trim();
        if (!jid)
            return '';
        return jid.includes('@') ? jid : `${jid}${suffix}`;
    }
    jidToPhone(value) {
        return (value || '').split('@')[0] || '';
    }
    sanitizeLid(value) {
        return (value || '').trim().split('@')[0] || '';
    }
    normalizeTimestamp(raw) {
        if (!raw)
            return (0, timezone_1.adjustToConfiguredTimezone)(new Date()).toISOString();
        const num = Number(raw);
        if (Number.isNaN(num) || num <= 0)
            return (0, timezone_1.adjustToConfiguredTimezone)(new Date()).toISOString();
        const seconds = num > 9_999_999_999 ? Math.floor(num / 1000) : num;
        return (0, timezone_1.adjustToConfiguredTimezone)(new Date(seconds * 1000)).toISOString();
    }
    // ... rest of methods
    async handleWebhook(HookObj) {
        try {
            if (HookObj.type) {
                if (HookObj.type == "HistorySync")
                    await this.SyncHistory(HookObj);
                else if (HookObj.type == "Message")
                    await this.Message(HookObj);
                else if (HookObj.type == "ChatPresence")
                    await this.ChatPresence(HookObj);
                else if (HookObj.type == "ReadReceipt")
                    await this.ReadReceipt(HookObj);
                else if (HookObj.type == "Presence")
                    this.Presence(HookObj);
            }
        }
        catch (err) {
            logger.error('Error processing webhook', err);
        }
    }
    async Message(obj) {
        try {
            const event = obj.event;
            if (!event || !event.Info)
                return;
            if (obj.event?.Info?.Chat === "status@broadcast")
                return;
            await this.processSingleMessage(event.Info, event.Message, true);
        }
        catch (err) {
            logger.error('Error processing Message webhook', err);
        }
    }
    /**
     * Unified message logic: Handles a single message from webhook or history sync
     */
    async processSingleMessage(info, message, isLiveMessage = false) {
        try {
            // 0. Skip broadcast status messages
            if (info.Chat === "status@broadcast") {
                return;
            }
            // 0b. Determine IDs and names using specialized logic
            const { chatId, phoneRaw, pushName } = await this.getChatId(info);
            // 1. Determine basic info (Mirrors old implementation)
            const messageId = info.ID;
            const isFromMe = info.IsFromMe || false;
            const timestamp = this.normalizeTimestamp(info.Timestamp || info.timeStamp);
            const isGroup = (info.Chat || "").includes("@g.us");
            let contactId = (info.ContactId || '').toString();
            if (!contactId) {
                if (isFromMe) {
                    contactId = (this.userJid || '').split('@')[0] || 'Me';
                }
                else {
                    contactId = (phoneRaw || '').split('@')[0] || '';
                }
            }
            // 2. Determine message type and content
            let messageType = 'text';
            let content = '';
            let mediaPath = undefined;
            let replyToMessageId = undefined;
            // Context info for replies
            const contextInfo = message.extendedTextMessage?.contextInfo ||
                message.imageMessage?.contextInfo ||
                message.videoMessage?.contextInfo ||
                message.audioMessage?.contextInfo ||
                message.documentMessage?.contextInfo ||
                message.stickerMessage?.contextInfo ||
                message.locationMessage?.contextInfo ||
                message.contactMessage?.contextInfo ||
                message.pollMessage?.contextInfo;
            if (contextInfo && (contextInfo.stanzaId || contextInfo.stanzaID)) {
                replyToMessageId = contextInfo.stanzaId || contextInfo.stanzaID;
            }
            if (message.conversation) {
                content = message.conversation;
            }
            else if (message.extendedTextMessage) {
                content = message.extendedTextMessage.text;
            }
            else if (message.hydratedContentText) {
                content = message.hydratedContentText;
            }
            else if (message.imageMessage) {
                messageType = 'image';
                content = message.imageMessage.caption || '[Image]';
                mediaPath = await this.handleMediaDownload(message.imageMessage, 'image', messageId);
            }
            else if (message.videoMessage) {
                messageType = 'video';
                content = message.videoMessage.caption || '[Video]';
                mediaPath = await this.handleMediaDownload(message.videoMessage, 'video', messageId);
            }
            else if (message.audioMessage) {
                messageType = 'audio';
                content = '[Audio]';
                mediaPath = await this.handleMediaDownload(message.audioMessage, 'audio', messageId);
            }
            else if (message.documentMessage) {
                messageType = 'document';
                content = message.documentMessage.fileName || '[Document]';
                mediaPath = await this.handleMediaDownload(message.documentMessage, 'document', messageId);
            }
            else if (message.stickerMessage) {
                messageType = 'sticker';
                content = '[Sticker]';
                mediaPath = await this.handleMediaDownload(message.stickerMessage, 'sticker', messageId);
            }
            else if (message.locationMessage) {
                messageType = 'location';
                const locMsg = message.locationMessage;
                const lat = locMsg.degreesLatitude ?? locMsg.latitude ?? 0;
                const lng = locMsg.degreesLongitude ?? locMsg.longitude ?? 0;
                const name = locMsg.name || '';
                content = `[Location] ${lat.toFixed(4)},${lng.toFixed(4)}${name ? ` (${name})` : ''}`;
            }
            else if (message.contactMessage) {
                messageType = 'contact';
                const contactMsg = message.contactMessage;
                const displayName = contactMsg.displayName || 'Contact';
                const rawVcard = contactMsg.vcard || contactMsg.Vcard || '';
                const telMatch = String(rawVcard).match(/TEL[^:]*:([^\r\n]+)/i);
                const contactPhone = telMatch ? telMatch[1].replace(/[\s-]/g, '').trim() : '';
                content = `[Contact] ${displayName}${contactPhone ? `|${contactPhone}` : ''}`;
            }
            else if (message.pollMessage) {
                messageType = 'poll';
                const pollMsg = message.pollMessage;
                const pollName = pollMsg.name || 'Poll';
                content = `[Poll] ${pollName}`;
            }
            // 3. Upsert Chat
            const unreadCount = typeof info.unreadCount === "number" ? info.unreadCount : undefined;
            const updatedChats = await DatabaseService_1.databaseService.upsertChat(chatId, content, timestamp, unreadCount, true, // isOnline
            false, // isTyping
            pushName, contactId, this.userJid, { incrementUnreadOnIncoming: isLiveMessage, callerFunctionName: 'processSingleMessage' }, // options
            isFromMe);
            // 4. Upsert Message
            const messageContactId = isFromMe
                ? (cachedUserJid || this.userJid || 'Me')
                : contactId;
            logger.debug('Upserting message', { messageId, chatId, contactId: messageContactId, isFromMe, content, mediaPath });
            const savedMessage = await DatabaseService_1.databaseService.upsertMessage({
                id: messageId,
                chatId,
                message: content,
                timestamp,
                messageType,
                isFromMe,
                contactId: messageContactId,
                status: isFromMe ? 'sent' : 'read',
                mediaPath,
                userId: isFromMe ? 'Me' : undefined,
                replyToMessageId
            });
            // 5. Handle Reactions
            if (message.reactionMessage) {
                try {
                    const reaction = message.reactionMessage;
                    const targetMessageId = reaction.key?.ID || reaction.key?.id;
                    const reactionId = info.ID;
                    const participant = (reaction.key?.remoteJID || reaction.key?.participant || info.Sender || info.Participant || "").split("@")[0];
                    const emoji = reaction.text;
                    const timestamp = this.normalizeTimestamp(info.Timestamp || info.timeStamp || Date.now());
                    if (targetMessageId && emoji) {
                        await DatabaseService_1.databaseService.upsertReaction(reactionId, targetMessageId, participant, emoji, timestamp);
                        // Emit update
                        const updatedReactions = await DatabaseService_1.databaseService.getMessageReactionsWithNames(targetMessageId);
                        SocketHandler_1.socketHandler.getIO()?.emit(constants_1.SOCKET_EVENTS.REACTION_UPDATED, { chatId, messageId: targetMessageId, reactions: updatedReactions });
                    }
                }
                catch (err) {
                    // Ignore P2003 (FK error if message doesn't exist yet)
                    if (err.code !== 'P2003') {
                        logger.error('Error handling reaction', err);
                    }
                }
                return; // Reaction handled
            }
            const unreadValue = updatedChats?.[0]?.unReadCount;
            // 6. Emit to Socket
            const io = SocketHandler_1.socketHandler.getIO();
            if (io) {
                io.emit(constants_1.SOCKET_EVENTS.NEW_MESSAGE, {
                    ...savedMessage,
                    pushName
                });
                // Emit minimal chat update
                io.emit(constants_1.SOCKET_EVENTS.CHAT_UPDATED, {
                    id: chatId,
                    lastMessage: content,
                    lastMessageTime: timestamp,
                    pushname: pushName,
                    unread_count: unreadValue,
                    unreadCount: unreadValue
                    // other fields omitted, frontend likely patches existing or fetches full
                });
            }
        }
        catch (err) {
            logger.error('Error processing single message', err, { id: info?.ID });
        }
    }
    /**
     * Determine the true chatId and phone using local LID mappings and local DB only.
     */
    async getChatId(info) {
        const isGroup = (info.Chat || "").includes("@g.us");
        let source = "";
        let phoneRaw = "";
        let pushName = info.PushName || "";
        if (!isGroup) {
            ({ source, phoneRaw } = await this.resolveDirectChatSource(info));
        }
        else {
            ({ source, phoneRaw } = this.resolveGroupSource(info));
        }
        // normalize sender
        if (phoneRaw)
            info.Sender = phoneRaw;
        if (pushName)
            info.PushName = pushName;
        const phone = phoneRaw.includes("@s.whatsapp.net")
            ? this.jidToPhone(phoneRaw)
            : "";
        if (phone) {
            pushName = await this.resolveAndStoreContact(phone, pushName);
        }
        const chatId = isGroup
            ? source?.match(/^[^@:]+/)?.[0] || ""
            : this.sanitizeLid(source || phoneRaw);
        phoneRaw = phoneRaw?.match(/^[^@:]+/)?.[0] || "";
        return { chatId, phoneRaw, pushName };
    }
    resolveGroupSource(info) {
        const source = info.Chat || info.RemoteJid || info.Sender || "";
        let phoneRaw = info.Sender || info.Participant || "";
        if (!info.Sender?.includes("@s.whatsapp.net")) {
            phoneRaw = info.SenderAlt || info.Sender;
        }
        return { source, phoneRaw };
    }
    async resolveDirectChatSource(info) {
        let source = "";
        let phoneRaw = "";
        if (!info.IsFromMe) {
            if (info.SenderAlt?.includes("@s.whatsapp.net")) {
                source = info.Sender;
                phoneRaw = info.SenderAlt;
            }
            else if (info.Sender?.endsWith("@lid")) {
                const resolved = await this.resolvePhoneJidFromLid(info.Sender);
                phoneRaw = resolved || info.SenderAlt;
                source = info.Sender;
            }
            else if (info.Sender?.includes("@s.whatsapp.net")) {
                source = info.SenderAlt;
                phoneRaw = info.Sender;
            }
            else {
                source = info.Sender;
                phoneRaw = info.SenderAlt;
            }
        }
        else {
            if ((info.RecipientAlt || "").includes("@lid")) {
                source = info.RecipientAlt;
                phoneRaw = (info.Chat || "").includes("@s.whatsapp.net")
                    ? info.Chat
                    : info.Sender;
            }
            else if (info.Sender?.includes("@s.whatsapp.net")) {
                source = info.Chat || info.RemoteJid || info.Sender || "";
                phoneRaw = info.Sender;
            }
            else if (info.SenderAlt?.includes("@lid")) {
                source = info.SenderAlt || info.Chat || info.RemoteJid || "";
                phoneRaw = info.Sender || info.SenderAlt;
            }
            else {
                source = info.Chat || info.RemoteJid || info.Sender || "";
                phoneRaw = info.SenderAlt || info.Sender;
            }
        }
        return { source, phoneRaw };
    }
    async resolveAndStoreContact(phone, pushName) {
        const resolved = await DatabaseService_1.databaseService.resolveContactName(phone);
        if (resolved?.displayName) {
            pushName = resolved.displayName;
        }
        else if (!pushName) {
            pushName = phone;
        }
        await DatabaseService_1.databaseService.upsertLidMapping({
            lid: phone,
            phone,
            pushName,
            fullName: null,
            firstName: null,
            businessName: null,
            isMyContact: false,
            isBusiness: false,
        });
        return pushName;
    }
    async handleMediaDownload(mediaMsg, type, messageId) {
        try {
            const mediaInfo = {
                URL: mediaMsg.URL,
                directPath: mediaMsg.directPath,
                mediaKey: mediaMsg.mediaKey,
                mimetype: mediaMsg.mimetype,
                fileEncSHA256: mediaMsg.fileEncSha256 || mediaMsg.fileEncSHA256,
                fileSHA256: mediaMsg.fileSha256 || mediaMsg.fileSHA256,
                fileLength: mediaMsg.fileLength
            };
            let result;
            let extension = '';
            let folder = '';
            if (type === 'image') {
                result = await WhatsAppApiService_1.whatsAppApiService.downloadImage(mediaInfo);
                extension = '.jpg';
                folder = config_1.CONFIG.PATHS.IMAGES;
            }
            else if (type === 'sticker') {
                result = await WhatsAppApiService_1.whatsAppApiService.downloadImage(mediaInfo);
                extension = '.webp';
                folder = config_1.CONFIG.PATHS.IMAGES;
            }
            else if (type === 'video') {
                result = await WhatsAppApiService_1.whatsAppApiService.downloadVideo(mediaInfo);
                extension = '.mp4';
                folder = config_1.CONFIG.PATHS.VIDEOS;
            }
            else if (type === 'audio') {
                result = await WhatsAppApiService_1.whatsAppApiService.downloadAudio(mediaInfo);
                extension = '.ogg';
                folder = config_1.CONFIG.PATHS.AUDIO;
            }
            else {
                result = await WhatsAppApiService_1.whatsAppApiService.downloadDocument(mediaInfo);
                extension = path_1.default.extname(mediaMsg.fileName || '') || '.bin';
                folder = config_1.CONFIG.PATHS.DOCUMENTS;
            }
            if (result && result.success && result.data) {
                const base64Data = result.data.data.Data || result.data.data;
                if (!base64Data || typeof base64Data !== 'string')
                    return undefined;
                let cleanBase64 = '';
                if (type === 'image' || type === 'sticker') {
                    cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
                }
                else {
                    cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
                }
                if (!cleanBase64)
                    return undefined;
                if (!fs_1.default.existsSync(folder)) {
                    fs_1.default.mkdirSync(folder, { recursive: true });
                }
                const filename = `${type}_${messageId}${extension}`;
                const filePath = path_1.default.join(folder, filename);
                fs_1.default.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
                const relativeFolder = (type === 'image' || type === 'sticker')
                    ? 'imgs'
                    : type === 'video'
                        ? 'video'
                        : type === 'audio'
                            ? 'audio'
                            : 'docs';
                return `${relativeFolder}/${filename}`;
            }
        }
        catch (err) {
            logger.error(`Failed to download ${type}`, err);
        }
        return undefined;
    }
    async SyncHistory(obj) {
        try {
            const event = obj.event;
            if (!event || !event.Data)
                return;
            const data = event.Data;
            // CRITICAL: syncType check from old code
            const VALID_SYNC_TYPES = new Set([0]); // BOOTSTRAP, FULL, RECENT, ON_DEMAND
            if (data.phoneNumberToLidMappings)
                await this.cachePhoneNumberToLidMappings(data.phoneNumberToLidMappings);
            if (!VALID_SYNC_TYPES.has(data.syncType)) {
                return logger.debug(`Skipping HistorySync with syncType ${data.syncType}`);
            }
            if (!Array.isArray(data.conversations))
                return;
            logger.info(`Processing History Sync for ${data.conversations.length} conversations`);
            const conversations = data.conversations.filter((c) => {
                const conversationId = c?.ID || c?.id || c?.jid || '';
                return conversationId !== 'status@broadcast'
                    && !conversationId.endsWith('@broadcast')
                    && !conversationId.endsWith('@newsletter');
            });
            logger.info(`SyncType ${data.syncType}: received ${data.conversations.length} conversations, processed ${conversations.length}`);
            for (const con of conversations) {
                await this.processConversation(con);
            }
        }
        catch (err) {
            logger.error('Error processing SyncHistory', err);
        }
    }
    /**
     * Process a single conversation from HistorySync (Adapts ChatupsertHelper)
     */
    async processConversation(con) {
        try {
            const id = con.accountLid || con.id || con.ID || con.jid;
            if (!id)
                return;
            const conversationId = id.split('@')[0];
            const isGroup = id.includes('@g.us');
            // 1. Group Upsert
            if (isGroup) {
                const subject = con.subject || con.name || con.Name;
                if (subject) {
                    await DatabaseService_1.databaseService.upsertGroup(conversationId, subject);
                }
            }
            // 2. Prep Info for Chat Upsert
            const unreadCount = typeof con.unreadCount === "number" ? con.unreadCount : 0;
            const pushName = this.resolveConversationName(con);
            const conversationTimestamp = this.normalizeTimestamp(con.conversationTimestamp);
            const latestMessage = this.getLatestConversationMessage(con);
            const lastMessagePreview = latestMessage ? this.resolveMessagePreview(latestMessage.message?.message) : "";
            const participants = isGroup ? this.extractGroupParticipants(con) : undefined;
            if (!isGroup) {
                const fullName = con.Name || con.name || null;
                const firstName = con.FirstName || con.firstName || null;
                const businessName = con.BusinessName || con.businessName || null;
                const profilePushName = con.PushName || con.pushName || null;
                const phone = con.pnJID.split('@')[0] || '';
                if (phone) {
                    await DatabaseService_1.databaseService.upsertLidMapping({
                        lid: id,
                        phone,
                        fullName,
                        firstName,
                        businessName,
                        pushName: profilePushName,
                        isMyContact: !!(fullName || firstName),
                        isBusiness: !!businessName,
                    });
                }
            }
            // 3. Upsert Chat (Parity with old ChatupsertHelper)
            if (unreadCount >= 0) {
                await DatabaseService_1.databaseService.upsertChat(conversationId, lastMessagePreview || "", conversationTimestamp, unreadCount, false, // isOnline
                false, // isTyping
                pushName, id, // original contactId
                this.userJid, { participants, callerFunctionName: 'processConversation' }, id.includes('@s.whatsapp.net') && con.messages?.[0]?.message?.key?.fromMe // approximate isFromMe
                );
            }
            // 4. Process individual messages
            if (Array.isArray(con.messages) && con.messages.length > 0) {
                const sortedMessages = [...con.messages].sort((a, b) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0));
                for (const msg of sortedMessages) {
                    const messageWrapper = msg.message;
                    const key = messageWrapper?.key;
                    if (!messageWrapper?.messageTimestamp || !key)
                        continue;
                    const groupMessage = id.includes('@g.us');
                    const senderJid = id.split('@')[0] || '';
                    const senderBare = senderJid.split('@')[0] || '';
                    const senderAlt = con.pnJID;
                    let contactId = key.remoteJID.split('@')[0] || '';
                    if (key.fromMe) {
                        contactId = (this.userJid || '').split('@')[0] || 'Me';
                    }
                    else if (groupMessage) {
                        const mapped = this.lidToPnMap.get(senderJid)
                            || this.lidToPnMap.get(senderBare);
                        const resolved = mapped?.split('@')[0]
                            || await DatabaseService_1.databaseService.resolveLid(senderBare);
                        contactId = resolved || senderBare;
                    }
                    else {
                        const altJid = await this.resolveSenderAltFromMappings(senderJid, key.remoteJID || id);
                        contactId = (altJid || '').split('@')[0] || senderBare;
                    }
                    // Construct standard Info block expected by processSingleMessage
                    const info = {
                        Chat: id,
                        Timestamp: messageWrapper.messageTimestamp,
                        ID: key.ID,
                        IsFromMe: key.fromMe,
                        Sender: id,
                        SenderAlt: senderAlt,
                        ContactId: contactId,
                        PushName: msg.pushname || messageWrapper.pushName || con.pushName || con.subject,
                        unreadCount // pass it along
                    };
                    const coreMessage = messageWrapper.message; // Actual content
                    if (!coreMessage || (!coreMessage.conversation && !coreMessage.extendedTextMessage &&
                        !coreMessage.imageMessage && !coreMessage.videoMessage &&
                        !coreMessage.audioMessage && !coreMessage.documentMessage &&
                        !coreMessage.stickerMessage && !coreMessage.locationMessage &&
                        !coreMessage.contactMessage && !coreMessage.pollMessage &&
                        !coreMessage.reactionMessage)) {
                        continue;
                    }
                    await this.processSingleMessage(info, coreMessage);
                }
            }
        }
        catch (err) {
            logger.error('Error processing conversation history', err);
        }
    }
    // --- Helpers for parity with old architecture ---
    resolveConversationName(con) {
        return (con?.Name ||
            con?.name ||
            con?.PushName ||
            con?.pushName ||
            con?.subject ||
            "");
    }
    async cachePhoneNumberToLidMappings(mappings) {
        await (0, ContactSyncService_1.syncContactsFromWuzAPI)(this.lidToPnMap, mappings);
    }
    async resolvePhoneJidFromLid(lidJid) {
        const lidFull = this.ensureJid(lidJid, '@lid');
        const lidBare = lidFull.split('@')[0];
        const fromMemory = this.lidToPnMap.get(lidFull) || this.lidToPnMap.get(lidBare);
        if (fromMemory) {
            return this.ensureJid(fromMemory, '@s.whatsapp.net');
        }
        const fromDb = await DatabaseService_1.databaseService.getPhoneFromLidMappings(lidFull);
        if (!fromDb)
            return null;
        const resolved = this.ensureJid(fromDb, '@s.whatsapp.net');
        this.lidToPnMap.set(lidFull, resolved);
        this.lidToPnMap.set(lidBare, resolved);
        return resolved;
    }
    async resolveSenderAltFromMappings(senderJid, fallbackJid) {
        const sender = senderJid || "";
        const fallback = fallbackJid || "";
        const mapped = this.lidToPnMap.get(sender) ||
            this.lidToPnMap.get(sender.split('@')[0]) ||
            this.lidToPnMap.get(fallback) ||
            this.lidToPnMap.get(fallback.split('@')[0]);
        if (mapped)
            return mapped;
        if (sender.endsWith('@lid')) {
            const senderResolved = await this.resolvePhoneJidFromLid(sender);
            if (senderResolved)
                return senderResolved;
        }
        if (fallback.endsWith('@lid')) {
            const fallbackResolved = await this.resolvePhoneJidFromLid(fallback);
            if (fallbackResolved)
                return fallbackResolved;
        }
        return mapped || fallback || sender;
    }
    getLatestConversationMessage(con) {
        if (!Array.isArray(con?.messages) || con.messages.length === 0)
            return null;
        return [...con.messages].sort((a, b) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0))[0];
    }
    resolveMessagePreview(content) {
        if (!content)
            return "";
        if (content.conversation)
            return content.conversation;
        if (content.extendedTextMessage?.text)
            return content.extendedTextMessage.text;
        if (content.imageMessage)
            return "[Image]";
        if (content.videoMessage)
            return "[Video]";
        if (content.audioMessage)
            return "[Audio]";
        if (content.stickerMessage)
            return "[Sticker]";
        if (content.locationMessage) {
            const lat = content.locationMessage.degreesLatitude ?? content.locationMessage.latitude;
            const lng = content.locationMessage.degreesLongitude ?? content.locationMessage.longitude;
            return typeof lat === 'number' && typeof lng === 'number' ? `[Location] ${lat},${lng}` : "[Location]";
        }
        if (content.contactMessage)
            return `[Contact] ${content.contactMessage.displayName || 'Contact'}`;
        if (content.pollMessage)
            return `[Poll] ${content.pollMessage.name || 'Poll'}`;
        if (content.documentMessage)
            return `[Document] ${content.documentMessage.fileName || 'File'}`;
        return "";
    }
    extractGroupParticipants(con) {
        const participants = con.participants || con.groupMetadata?.participants || [];
        if (!Array.isArray(participants))
            return [];
        return participants.map((p) => ({
            jid: p.id || p.jid || p.participant,
            isAdmin: p.admin === 'admin' || p.admin === 'superadmin' || !!p.isAdmin,
            displayName: p.name || p.displayName || p.pushName
        }));
    }
    async ChatPresence(obj) {
        try {
            if (obj.event) {
                const presenceData = obj.event;
                const chatId = (presenceData.Chat || presenceData.Sender)?.match(/^[^@:]+/)?.[0] || "";
                const userId = presenceData.Sender?.match(/^[^@:]+/)?.[0] || "";
                const isOnline = presenceData.State === 'available' || presenceData.State === 'online';
                const isTyping = presenceData.State === 'composing' || presenceData.State === 'recording';
                // Emit via socketHandler
                const io = SocketHandler_1.socketHandler.getIO();
                if (io) {
                    io.emit(constants_1.SOCKET_EVENTS.CHAT_PRESENCE, {
                        chatId,
                        userId,
                        isOnline,
                        isTyping
                    });
                    logger.debug(`Chat presence updated for ${chatId}: online=${isOnline}, typing=${isTyping}`);
                }
            }
        }
        catch (error) {
            logger.error('Error handling chat presence', error);
        }
    }
    async ReadReceipt(obj) {
        const event = obj.event;
        if (event && event.MessageIDs) {
            try {
                const numericType = Number(event.Type);
                const isReadType = numericType === 1 || numericType === 2;
                const status = isReadType ? 'read' : 'delivered';
                const updatedMessages = await DatabaseService_1.databaseService.updateMessageStatus(event.MessageIDs, status);
                const eventChatId = (event.Chat || '').split('@')[0] || '';
                let unreadValue = null;
                if (isReadType && eventChatId) {
                    unreadValue = await DatabaseService_1.databaseService.resetUnreadCount(eventChatId);
                }
                // Emit socket updates to refresh UI checkmarks
                const io = SocketHandler_1.socketHandler.getIO();
                if (io) {
                    updatedMessages.forEach(msg => {
                        io.emit(constants_1.SOCKET_EVENTS.MESSAGE_UPDATED, msg);
                    });
                    if (isReadType && eventChatId) {
                        io.emit(constants_1.SOCKET_EVENTS.CHAT_UPDATED, {
                            id: eventChatId,
                            unread_count: unreadValue ?? 0,
                            unreadCount: unreadValue ?? 0
                        });
                    }
                }
                logger.debug('Updated read/delivered status', { count: updatedMessages.length, status, eventType: numericType });
            }
            catch (error) {
                logger.error('Error updating read receipt', error);
            }
        }
    }
    Presence(obj) {
        // Usually legacy/placeholder in wuzapi hooks
    }
}
async function default_1(obj) {
    await ProcessWhatsAppHooks.create(obj);
}
