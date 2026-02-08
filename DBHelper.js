"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prismaClient_1 = __importDefault(require("./prismaClient"));
// Kept for compatibility but performs no operation as Prisma manages schema
async function ensureChatColumns() {
    return Promise.resolve();
}
function DBHelper() {
    async function GetUser(token) {
        const user = await prismaClient_1.default.users.findFirst({
            where: { name: token },
        });
        if (!user) {
            console.warn(`GetUser: User not found for token/name: ${token}`);
            return null;
        }
        return user.jid ? user.jid.split(":")[0] : null;
    }
    async function upsertChat(id, lastMessage, lastMessageTime, unreadCount, isOnline, isTyping, pushname, contactId, userId, statusOrOptions, isFromMe = false) {
        const normalizedOptions = normalizeUpsertOptions(statusOrOptions);
        const status = normalizedOptions.status || "open";
        const participants = normalizedOptions.participants &&
            Array.isArray(normalizedOptions.participants)
            ? normalizedOptions.participants
            : undefined;
        // Prisma logic for complex Upsert
        // We fetch first to handle the conditional logic for unReadCount and pushname
        const existingChat = await prismaClient_1.default.chats.findUnique({
            where: { id },
        });
        const isTypingStr = isTyping ? "1" : "0";
        const participantsVal = participants ? participants : (existingChat?.participants ?? []);
        if (existingChat) {
            // Logic for unReadCount:
            // If unreadCount arg is provided (not null/undefined), use it.
            // Else if isFromMe is false, increment.
            // Else keep existing.
            let newUnReadCount = existingChat.unReadCount || 0;
            if (unreadCount !== null && unreadCount !== undefined) {
                newUnReadCount = unreadCount;
            }
            else if (!isFromMe) {
                newUnReadCount += 1;
            }
            // Logic for pushname:
            // Update if passed, not empty, and not from me.
            let newPushname = existingChat.pushname;
            if (pushname && pushname !== "" && !isFromMe) {
                newPushname = pushname;
            }
            const updated = await prismaClient_1.default.chats.update({
                where: { id },
                data: {
                    lastMessage,
                    lastMessageTime,
                    unReadCount: newUnReadCount,
                    isOnline: isOnline,
                    isTyping: isTypingStr,
                    pushname: newPushname,
                    contactId: contactId || existingChat.contactId,
                    userId: userId || existingChat.userId,
                    status: normalizedOptions.status || existingChat.status || "open",
                    participants: participantsVal,
                },
            });
            return [updated];
        }
        else {
            // Create new
            const created = await prismaClient_1.default.chats.create({
                data: {
                    id,
                    lastMessage,
                    lastMessageTime,
                    unReadCount: unreadCount !== null && unreadCount !== undefined
                        ? unreadCount
                        : isFromMe
                            ? 0
                            : 1,
                    isOnline,
                    isTyping: isTypingStr,
                    // For new chats: Use pushname if not from me, else fallback to id (phone)
                    pushname: (!isFromMe && pushname && pushname !== "") ? pushname : '',
                    contactId,
                    userId,
                    status,
                    participants: (participants || []),
                },
            });
            return [created];
        }
    }
    async function upsertMessage(message, chatId, type, passedMediaPath, userId, senderRaw) {
        let content = message.Message.conversation ||
            message.Message.extendedTextMessage?.text ||
            message.Message.documentMessage?.title ||
            message.Message.documentMessage?.fileName ||
            "";
        var contactId = "";
        let mediaPath = passedMediaPath || message.Info?.mediaPath || null;
        if (!message.isFromMe) {
            const sender = senderRaw || message.Info?.Sender || "";
            contactId = sender.match(/^[^@:]+/)?.[0] || "";
        }
        // Determine media path based on message type if not already provided
        if (!mediaPath) {
            if (type == "image") {
                mediaPath = `imgs/${message.Info.ID}.jpeg`;
            }
            else if (type == "sticker") {
                mediaPath = `imgs/${message.Info.ID}.webp`;
            }
            else if (type == "audio") {
                mediaPath = `audio/${message.Info.ID}.ogg`;
            }
            else if (type == "video") {
                mediaPath = `video/${message.Info.ID}.mp4`;
            }
            else if (type == "document" || type == "media") {
                const docName = message.Message.documentMessage?.fileName ||
                    message.Message.documentMessage?.title ||
                    `${message.Info.ID}.${message.Message.documentMessage?.mimetype?.split('/')[1] || 'bin'}`;
                mediaPath = `docs/${docName}`;
            }
        }
        // Extract replyToMessageId from various possible locations in the message object
        console.log('--- DB Upsert Message Debug ---');
        console.log('Full Message Object:', JSON.stringify(message, null, 2));
        console.log('Message ID:', message.Info?.ID);
        console.log('Message Type:', type);
        // Helper to find reply/quoted message ID recursively in an object
        const findReplyId = (obj) => {
            if (!obj || typeof obj !== 'object')
                return null;
            if (obj.stanzaId)
                return obj.stanzaId;
            if (obj.StanzaId)
                return obj.StanzaId;
            if (obj.quotedMessageId)
                return obj.quotedMessageId;
            if (obj.QuotedMessageId)
                return obj.QuotedMessageId;
            for (const key in obj) {
                if (typeof obj[key] === 'object') {
                    const res = findReplyId(obj[key]);
                    if (res)
                        return res;
                }
            }
            return null;
        };
        // Check various paths for the reply/quoted message ID
        const replyToMessageId = message.Info?.replyToMessageId ||
            message.Info?.replyToMessageID ||
            message.replyToMessageId ||
            message.forwardContext?.StanzaId ||
            findReplyId(message.Message) ||
            findReplyId(message) ||
            null;
        console.log('Identified replyToMessageId:', replyToMessageId);
        const messageData = {
            chatId,
            message: content,
            timeStamp: new Date(message.Info.Timestamp),
            isDelivered: false,
            isRead: false,
            messageType: type,
            isFromMe: message.Info.IsFromMe,
            contactId,
            isEdit: message.Info.isEdit || false, // Ensure boolean
            mediaPath,
            userId: userId || null,
            replyToMessageId,
        };
        try {
            const result = await prismaClient_1.default.messages.upsert({
                where: { id: message.Info.ID },
                update: {
                    message: content,
                    timeStamp: new Date(message.Info.Timestamp),
                    isDelivered: false, // SQL updated these to EXCLUDED values which were defaulting to false?
                    // Wait, SQL VALUES ($5, $6) were false, false.
                    // UPDATE SET "isDelivered" = EXCLUDED."isDelivered" -> sets to false regardless?
                    // Yes, the original code resets isDelivered/isRead on update?
                    // Original SQL:
                    // VALUES (..., false, false, ...)
                    // UPDATE SET "isDelivered" = EXCLUDED."isDelivered"
                    // So yes, it seems it resets them.
                    isRead: false,
                    messageType: type,
                    isFromMe: message.Info.IsFromMe,
                    contactId,
                    isEdit: message.Info.isEdit || false,
                    mediaPath,
                    userId: userId || null,
                    replyToMessageId,
                },
                create: {
                    id: message.Info.ID,
                    ...messageData,
                },
            });
            console.log("Upserted message:", result);
            return result;
        }
        catch (err) {
            console.error("Error upserting message:", err);
            throw err;
        }
    }
    async function GetPhoneNum(chatId) {
        const res = await prismaClient_1.default.whatsmeow_lid_map.findUnique({
            where: { lid: chatId },
        });
        return res?.pn;
    }
    async function upsertGroup(id, name) {
        try {
            // Prisma handles table creation via migrations, assuming table exists.
            const result = await prismaClient_1.default.groups.upsert({
                where: { id },
                update: { name },
                create: { id, name },
            });
            return result;
        }
        catch (error) {
            console.error("Error upserting group:", error);
            throw error;
        }
    }
    async function updateMessageStatus(messageIds, status) {
        if (!messageIds || messageIds.length === 0)
            return [];
        const isRead = status === "read";
        const isDelivered = status === "read" || status === "delivered";
        const dataToUpdate = {};
        if (isRead)
            dataToUpdate.isRead = true;
        if (isDelivered)
            dataToUpdate.isDelivered = true;
        try {
            // Prisma updateMany returns count, not rows.
            // To emulate returning rows, we fetch them after update or try to find them.
            // However, since we update by ID, we can fetch all with these IDs.
            await prismaClient_1.default.messages.updateMany({
                where: {
                    id: { in: messageIds },
                },
                data: dataToUpdate,
            });
            const updatedMessages = await prismaClient_1.default.messages.findMany({
                where: {
                    id: { in: messageIds },
                },
            });
            return updatedMessages;
        }
        catch (err) {
            console.error("Error updating message status:", err);
            throw err;
        }
    }
    async function upsertReaction(id, messageId, participant, emoji, createdAt) {
        try {
            const result = await prismaClient_1.default.message_reactions.upsert({
                where: { id },
                update: {
                    messageId,
                    participant,
                    emoji,
                    createdAt,
                },
                create: {
                    id,
                    messageId,
                    participant,
                    emoji,
                    createdAt,
                },
            });
            return result;
        }
        catch (err) {
            console.error("Error upserting reaction:", err);
            throw err;
        }
    }
    async function getMessageReactionsWithNames(messageId) {
        try {
            const reactions = await prismaClient_1.default.$queryRawUnsafe(`
        SELECT 
          mr.id, 
          mr."messageId", 
          mr.participant, 
          mr.emoji, 
          mr."createdAt",
          COALESCE(cc.first_name, cc.full_name, cc.push_name, cc.business_name, mr.participant) as "contactName"
        FROM message_reactions mr
        LEFT JOIN cleaned_contacts cc ON SPLIT_PART(mr.participant, '@', 1) = cc.phone
        WHERE mr."messageId" = $1
        ORDER BY mr."createdAt" ASC
      `, messageId);
            return reactions;
        }
        catch (err) {
            console.error("Error fetching message reactions with names:", err);
            throw err;
        }
    }
    async function upsertCleanedContact(phone, pushName, chatId) {
        try {
            // Remove @s.whatsapp.net suffix if present
            const cleanPhone = phone.split('@')[0];
            const updateData = {};
            if (pushName)
                updateData.push_name = pushName;
            if (chatId)
                updateData.chatId = chatId;
            const result = await prismaClient_1.default.cleaned_contacts.upsert({
                where: { phone: cleanPhone },
                update: updateData,
                create: {
                    phone: cleanPhone,
                    push_name: pushName || null,
                    chatId: chatId || null,
                },
            });
            return result;
        }
        catch (err) {
            console.error("Error upserting cleaned contact:", err);
            throw err;
        }
    }
    return {
        GetUser,
        upsertChat,
        upsertMessage,
        GetPhoneNum,
        upsertGroup,
        updateMessageStatus,
        upsertReaction,
        getMessageReactionsWithNames,
        upsertCleanedContact,
    };
}
function normalizeUpsertOptions(statusOrOptions) {
    if (Array.isArray(statusOrOptions)) {
        return { participants: statusOrOptions };
    }
    if (typeof statusOrOptions === "string") {
        return { status: statusOrOptions };
    }
    if (statusOrOptions &&
        typeof statusOrOptions === "object" &&
        !Array.isArray(statusOrOptions)) {
        return {
            status: statusOrOptions.status,
            participants: statusOrOptions.participants,
        };
    }
    return {};
}
exports.default = DBHelper;
