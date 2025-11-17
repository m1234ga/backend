"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatStatusManager = void 0;
const DBConnection_1 = __importDefault(require("./DBConnection"));
class ChatStatusManager {
    // Add a new status change record
    static async addStatusChange(chatId, status, changedBy, reason, notes) {
        const query = `
      INSERT INTO chat_status_details (chat_id, status, changed_by, reason, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
        const values = [chatId, status, changedBy, reason, notes];
        const result = await DBConnection_1.default.query(query, values);
        return result.rows[0];
    }
    // Get current status of a chat
    static async getCurrentStatus(chatId) {
        const query = `
      SELECT status, changed_at, changed_by, reason, notes
      FROM chat_status_details
      WHERE chat_id = $1
      ORDER BY changed_at DESC
      LIMIT 1
    `;
        const result = await DBConnection_1.default.query(query, [chatId]);
        return result.rows[0] || null;
    }
    // Get status history for a chat
    static async getStatusHistory(chatId) {
        const query = `
      SELECT status, changed_at, changed_by, reason, notes
      FROM chat_status_details
      WHERE chat_id = $1
      ORDER BY changed_at DESC
    `;
        const result = await DBConnection_1.default.query(query, [chatId]);
        return result.rows;
    }
    // Close a chat with reason
    static async closeChat(chatId, reason, changedBy, notes) {
        return await this.addStatusChange(chatId, 'closed', changedBy, reason, notes);
    }
    // Reopen a chat
    static async reopenChat(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'open', changedBy, 'Chat reopened', notes);
    }
    // Set chat to processing
    static async setProcessing(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'processing', changedBy, 'Chat assigned for processing', notes);
    }
    // Set chat to pending
    static async setPending(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'pending', changedBy, 'Chat pending response', notes);
    }
    // Set chat to unassigned
    static async setUnassigned(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'unassigned', changedBy, 'Chat unassigned', notes);
    }
    // Set chat to follow up
    static async setFollowUp(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'follow_up', changedBy, 'Chat requires follow up', notes);
    }
    // Set chat to resolved
    static async setResolved(chatId, changedBy, notes) {
        return await this.addStatusChange(chatId, 'resolved', changedBy, 'Chat resolved', notes);
    }
    // Get all chats with their current status
    static async getChatsWithStatus(limit = 50, offset = 0) {
        const query = `
      SELECT 
        c.*,
        csd.status as current_status,
        csd.changed_at as status_changed_at,
        csd.changed_by as status_changed_by,
        csd.reason as status_reason,
        csd.notes as status_notes
      FROM chats c
      LEFT JOIN (
        SELECT DISTINCT ON (chat_id) 
          chat_id, 
          status, 
          changed_at,
          changed_by,
          reason,
          notes
        FROM chat_status_details 
        ORDER BY chat_id, changed_at DESC
      ) csd ON c.id = csd.chat_id
      ORDER BY c."lastMessageTime" DESC
      LIMIT $1 OFFSET $2
    `;
        const result = await DBConnection_1.default.query(query, [limit, offset]);
        return result.rows;
    }
}
exports.ChatStatusManager = ChatStatusManager;
exports.default = ChatStatusManager;
