"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DBConnection_1 = __importDefault(require("./DBConnection"));
let ensureParticipantsColumnPromise = null;
async function ensureParticipantsColumn() {
    if (!ensureParticipantsColumnPromise) {
        ensureParticipantsColumnPromise = (async () => {
            try {
                await DBConnection_1.default.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]'::jsonb`);
            }
            catch (error) {
                console.error("Failed to ensure participants column on chats table:", error);
            }
        })();
    }
    return ensureParticipantsColumnPromise;
}
function DBHelper() {
    async function GetUser(token) {
        const res = await DBConnection_1.default.query("SELECT * FROM USERS WHERE name='" + token + "'");
        if (res.rows.length === 0) {
            console.warn(`GetUser: User not found for token/name: ${token}`);
            return null;
        }
        return res.rows[0].jid ? res.rows[0].jid.split(":")[0] : null;
    }
    async function upsertChat(id, lastMessage, lastMessageTime, unreadCount, isOnline, isTyping, pushname, contactId, userId, statusOrOptions) {
        await ensureParticipantsColumn();
        const normalizedOptions = normalizeUpsertOptions(statusOrOptions);
        const status = normalizedOptions.status || "open";
        const participants = normalizedOptions.participants &&
            Array.isArray(normalizedOptions.participants)
            ? normalizedOptions.participants
            : undefined;
        const hasParticipants = Array.isArray(participants);
        const query = `
        INSERT INTO chats (
          id, "lastMessage", "lastMessageTime", "unReadCount", "isOnline", "isTyping", "pushname", "contactId", "userId", "status", participants
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CAST($11 AS jsonb))
        ON CONFLICT (id) 
        DO UPDATE SET
          "lastMessage"     = EXCLUDED."lastMessage",
          "lastMessageTime" = EXCLUDED."lastMessageTime",
          "unReadCount"     = EXCLUDED."unReadCount",
          "isOnline"        = EXCLUDED."isOnline",
          "isTyping"        = EXCLUDED."isTyping",
          "pushname"        = EXCLUDED."pushname",
          "contactId"       = EXCLUDED."contactId",
          "userId"          = EXCLUDED."userId",
          "status"          = COALESCE(EXCLUDED."status", chats."status", 'open'),
          participants      = CASE WHEN $12 THEN EXCLUDED.participants ELSE chats.participants END
        RETURNING *;
      `;
        const values = [
            id,
            lastMessage,
            lastMessageTime,
            unreadCount,
            isOnline ? 1 : 0,
            isTyping ? 1 : 0,
            pushname,
            contactId,
            userId,
            status,
            hasParticipants ? JSON.stringify(participants) : JSON.stringify([]),
            hasParticipants,
        ];
        const result = await DBConnection_1.default.query(query, values);
        return result.rows;
    }
    async function upsertMessage(message, chatId, type) {
        let content = message.Message.conversation || message.Message.extendedTextMessage?.text;
        let mediaPath = null;
        // Determine media path based on message type
        if (type == "sticker" || type == "image") {
            // Keep caption in `content`; always store images/stickers as .webp path
            mediaPath = `imgs/${message.Info.ID}.webp`;
        }
        else if (type == "audio") {
            mediaPath = `Audio/${message.Info.ID}.ogg`;
        }
        else if (type == "video") {
            mediaPath = `Video/${message.Info.ID}.mp4`;
        }
        const query = `
          INSERT INTO messages (id,"chatId", message, "timeStamp", "isDelivered", "isRead","messageType","isFromMe","contactId","isEdit","mediaPath")
          VALUES ($1,$2, $3, $4, $5, $6, $7, $8,$9,$10,$11)
          ON CONFLICT (id)
           DO UPDATE
            SET message = EXCLUDED.message,
            "timeStamp"=EXCLUDED."timeStamp",
            "isDelivered" = EXCLUDED."isDelivered",
            "isRead" = EXCLUDED."isRead",
            "messageType"=EXCLUDED."messageType",
            "isFromMe"=EXCLUDED."isFromMe",
            "contactId"=EXCLUDED."contactId",
            "isEdit"=EXCLUDED."isEdit",
            "mediaPath"=EXCLUDED."mediaPath"
          RETURNING *;
        `;
        const values = [
            message.Info.ID,
            chatId,
            content,
            new Date(message.Info.Timestamp).toISOString(),
            false,
            false,
            type,
            message.Info.IsFromMe,
            message.Info.Chat,
            message.Info.isEdit,
            mediaPath,
        ];
        try {
            const result = await DBConnection_1.default.query(query, values);
            console.log("Upserted message:", result.rows[0]);
            return result.rows[0];
        }
        catch (err) {
            console.error("Error upserting message:", err);
            throw err;
        }
    }
    async function GetPhoneNum(chatId) {
        const res = await DBConnection_1.default.query("SELECT * FROM whatsmeow_lid_map WHERE lid='" + chatId + "'");
        return res.rows[0].pn;
    }
    return {
        GetUser,
        upsertChat,
        upsertMessage,
        GetPhoneNum,
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
