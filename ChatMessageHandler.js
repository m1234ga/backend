"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const MediaDownLoadHelper_1 = __importDefault(require("./MediaDownLoadHelper"));
const DBHelper_1 = __importDefault(require("./DBHelper"));
const SocketEmits_1 = require("./SocketEmits");
function ChatMessageHandler() {
    async function ChatMessageHandler(message, token) {
        let type = "text";
        const userId = await (0, DBHelper_1.default)().GetUser(token);
        const chatId = getChatId(message);
        if (message.Message) {
            if (message.Message.imageMessage || message.Message.stickerMessage) {
                await (0, MediaDownLoadHelper_1.default)().saveImageBase64FromApi(message);
                if (message.Message.imageMessage)
                    type = "image";
                else
                    type = "sticker";
            }
            else if (message.Message.audioMessage) {
                await (0, MediaDownLoadHelper_1.default)().saveAudioFromApi(message);
                type = "audio";
            }
            if (message.Message.conversation ||
                message.Message.imageMessage ||
                message.Message.stickerMessage ||
                message.Message.audioMessage) {
                const chatResult = await (0, DBHelper_1.default)().upsertChat(chatId, resolveMessagePreview(message.Message), new Date(message.Info.Timestamp), message.unreadCount, false, false, message.Info.PushName, message.Info.ID, userId);
                const messageResult = await (0, DBHelper_1.default)().upsertMessage(message, chatId, type);
                // Emit socket events for real-time updates
                if (messageResult) {
                    (0, SocketEmits_1.emitNewMessage)(messageResult);
                }
                if (chatResult && chatResult.length > 0) {
                    (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
                }
            }
            if (message.Message.extendedTextMessage) {
                const chatResult = await (0, DBHelper_1.default)().upsertChat(chatId, message.Message.extendedTextMessage.text, new Date(message.Info.Timestamp), message.unreadCount, false, false, chatId, message.Info.ID, userId);
                const messageResult = await (0, DBHelper_1.default)().upsertMessage(message, chatId, type);
                // Emit socket events for real-time updates
                if (messageResult) {
                    (0, SocketEmits_1.emitNewMessage)(messageResult);
                }
                if (chatResult && chatResult.length > 0) {
                    (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
                }
            }
        }
    }
    async function ChatupsertHelper(con, token) {
        const userId = await (0, DBHelper_1.default)().GetUser(token);
        const isGroup = isGroupConversation(con);
        const groupParticipants = isGroup
            ? extractGroupParticipants(con)
            : undefined;
        const conversationId = (con.ID || con.id || "").split("@")[0] || "";
        const conversationTimestamp = normalizeConversationTimestamp(con.conversationTimestamp);
        const unreadCount = typeof con.unreadCount === "number" ? con.unreadCount : 0;
        const pushName = resolveConversationName(con);
        const latestMessage = getLatestConversationMessage(con);
        const lastMessagePreview = latestMessage
            ? resolveMessagePreview(latestMessage.message?.message)
            : "";
        if (conversationTimestamp && unreadCount >= 0) {
            await (0, DBHelper_1.default)().upsertChat(conversationId, lastMessagePreview || "", new Date(conversationTimestamp), unreadCount, false, false, pushName, con.ID, userId, {
                participants: groupParticipants,
            });
        }
        if (Array.isArray(con.messages) && con.messages.length > 0) {
            con.messages
                .sort((a, b) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0))
                .forEach(async (message) => {
                if (!message?.message?.messageTimestamp || !message?.message?.key) {
                    return;
                }
                message.Info = {
                    Chat: message.message.key.remoteJID,
                    Timestamp: new Date(Number(message.message.messageTimestamp) * 1000).toUTCString(),
                    ID: message.message.key.ID,
                    IsFromMe: message.message.key.fromMe,
                    SenderAlt: message.message.key.participant,
                    PushName: message.pushname ||
                        message.message?.pushName ||
                        resolveConversationName(con),
                };
                message.Message = message.message.message;
                await ChatMessageHandler(message, token);
            });
        }
    }
    function getChatId(message) {
        let chatId = (message.Info.Chat || "").split("@")[0];
        chatId = chatId.split(":")[0];
        if (!message.Info.IsFromMe && message.Info.SenderAlt) {
            chatId = (message.Info.SenderAlt || "").split("@")[0];
            chatId = chatId.split(":")[0];
        }
        else if (!message.Info.IsFromMe && !message.Info.SenderAlt) {
            chatId = (message.Info.Chat || "").split("@")[0];
            chatId = chatId.split(":")[0];
        }
        return chatId;
    }
    return {
        ChatMessageHandler,
        ChatupsertHelper,
    };
}
function resolveMessagePreview(content) {
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
    if (content.stickerMessage)
        return "[Sticker]";
    if (content.audioMessage)
        return "[Audio]";
    if (content.documentMessage?.title)
        return `[Document] ${content.documentMessage.title}`;
    return "";
}
function isGroupConversation(con) {
    const id = con?.ID || con?.id || con?.jid || "";
    return typeof id === "string" && id.includes("@g.us");
}
function extractGroupParticipants(con) {
    const metadata = con?.groupMetadata ||
        con?.GroupMetadata ||
        con?.metadata ||
        con?.groupInfo ||
        {};
    let rawParticipants = metadata?.participants ||
        metadata?.Participants ||
        metadata?.members ||
        metadata?.member ||
        con?.participants ||
        [];
    if (rawParticipants && typeof rawParticipants === "object") {
        if (!Array.isArray(rawParticipants)) {
            rawParticipants = Object.values(rawParticipants);
        }
    }
    else if (!Array.isArray(rawParticipants)) {
        rawParticipants = [];
    }
    const normalized = rawParticipants
        .map(normalizeParticipantEntry)
        .filter((participant) => !!participant);
    const unique = new Map();
    normalized.forEach((participant) => {
        if (!unique.has(participant.jid)) {
            unique.set(participant.jid, participant);
        }
        else {
            const existing = unique.get(participant.jid);
            unique.set(participant.jid, {
                ...existing,
                isAdmin: existing.isAdmin || participant.isAdmin,
                isSuperAdmin: existing.isSuperAdmin || participant.isSuperAdmin,
                displayName: existing.displayName || participant.displayName,
            });
        }
    });
    return Array.from(unique.values());
}
function normalizeParticipantEntry(entry) {
    if (!entry)
        return null;
    let jid;
    let displayName;
    if (typeof entry === "string") {
        jid = entry;
    }
    else if (typeof entry === "object") {
        if (typeof entry.id === "string") {
            jid = entry.id;
        }
        else if (entry.id && typeof entry.id === "object") {
            const user = entry.id.user || entry.id.local || entry.id.phone;
            const server = entry.id.server || entry.id.domain || "s.whatsapp.net";
            if (user) {
                jid = `${user}@${server}`;
            }
        }
        else if (typeof entry.jid === "string") {
            jid = entry.jid;
        }
        else if (typeof entry.participant === "string") {
            jid = entry.participant;
        }
        else if (entry.wid) {
            if (typeof entry.wid === "string") {
                jid = entry.wid;
            }
            else if (entry.wid.user) {
                jid = `${entry.wid.user}@${entry.wid.server || "s.whatsapp.net"}`;
            }
        }
        displayName =
            entry.name ||
                entry.displayName ||
                entry.pushName ||
                entry.notify ||
                entry.fullName;
    }
    if (!jid)
        return null;
    const phone = stripJid(jid);
    const adminFlag = typeof entry === "object" ? entry.admin : undefined;
    const isAdmin = adminFlag === "admin" ||
        adminFlag === "superadmin" ||
        entry?.isAdmin === true;
    const isSuperAdmin = adminFlag === "superadmin" || entry?.isSuperAdmin === true;
    return {
        jid,
        id: phone,
        phone,
        isAdmin: !!isAdmin,
        isSuperAdmin: !!isSuperAdmin,
        displayName,
    };
}
function stripJid(jid) {
    if (!jid)
        return "";
    return jid.split("@")[0] || jid;
}
function resolveConversationName(con) {
    return (con?.PushName ||
        con?.pushName ||
        con?.Name ||
        con?.name ||
        con?.subject ||
        con?.groupMetadata?.subject ||
        con?.GroupMetadata?.subject ||
        "");
}
function normalizeConversationTimestamp(timestamp) {
    if (timestamp === null || timestamp === undefined) {
        return null;
    }
    const value = Number(timestamp);
    if (Number.isNaN(value) || value <= 0) {
        return null;
    }
    // Most HistorySync timestamps are seconds; if the value looks like seconds, convert.
    return value < 10_000_000_000 ? value * 1000 : value;
}
function getLatestConversationMessage(con) {
    if (!Array.isArray(con?.messages) || con.messages.length === 0) {
        return null;
    }
    return [...con.messages].sort((a, b) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0))[0];
}
exports.default = ChatMessageHandler;
