"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ChatMessageHandler_1 = __importDefault(require("./ChatMessageHandler"));
const { v4: uuidv4 } = require('uuid');
const SocketEmits_1 = require("./SocketEmits");
class processWhatsAppHooks {
    constructor(HookObj) {
        if (HookObj.type) {
            if ((HookObj).type == "HistorySync")
                this.SyncHistory(HookObj);
            if ((HookObj).type == "Message")
                this.Message(HookObj);
            else if ((HookObj).type == "ChatPresence")
                this.ChatPresence(HookObj);
            else if ((HookObj).type == "ReadReceipt")
                this.ReadReceipt(HookObj);
            else if ((HookObj).type == "Presence")
                this.Presence(HookObj);
        }
    }
    Message(obj) {
        (0, ChatMessageHandler_1.default)().ChatMessageHandler(obj.event, obj.instanceName);
    }
    SyncHistory(obj) {
        if (obj.event && obj.event.Data && obj.event.Data.conversations && obj.event.Data.syncType == 3) {
            var conversations = obj.event.Data.conversations.filter((a) => a.ID != "status@broadcast");
            conversations.forEach(async (con) => {
                await (0, ChatMessageHandler_1.default)().ChatupsertHelper(con, obj.instanceName);
            });
        }
    }
    ChatPresence(obj) {
        try {
            if (obj.event && obj.event) {
                const presenceData = obj.event;
                const chatId = (presenceData.Chat || presenceData.Sender)?.match(/^[^@:]+/)?.[0] || "";
                const userId = presenceData.SenderAlt || presenceData.Sender?.match(/^[^@:]+/)?.[0] || "";
                // Extract presence information
                const isOnline = presenceData.State === 'available' || presenceData.State === 'online';
                const isTyping = presenceData.State === 'composing' || presenceData.State === 'recording';
                // Emit socket event for chat presence
                (0, SocketEmits_1.emitChatPresence)({
                    chatId: chatId,
                    userId: userId,
                    isOnline: isOnline,
                    isTyping: isTyping
                });
                console.log(`Chat presence updated for ${chatId}: online=${isOnline}, typing=${isTyping}`);
            }
        }
        catch (error) {
            console.error('Error handling chat presence:', error);
        }
    }
    ReadReceipt(obj) {
        if (obj.event && obj.event.MessageIDs) {
            (0, ChatMessageHandler_1.default)().handleMessageStatusUpdate(obj.event);
        }
    }
    Presence(obj) {
    }
}
exports.default = processWhatsAppHooks;
