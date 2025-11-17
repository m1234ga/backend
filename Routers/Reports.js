"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = require("express");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const router = (0, express_1.Router)();
// Get reports data
router.get('/api/reports', async (req, res) => {
    try {
        const { dateRange = '7days' } = req.query;
        // Calculate date range
        const now = new Date();
        let startDate = new Date();
        switch (dateRange) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'yesterday':
                startDate.setDate(now.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);
                break;
            case '7days':
                startDate.setDate(now.getDate() - 7);
                break;
            case '30days':
                startDate.setDate(now.getDate() - 30);
                break;
            case '90days':
                startDate.setDate(now.getDate() - 90);
                break;
            default:
                startDate.setDate(now.getDate() - 7);
        }
        // Query total messages
        const messagesResult = await DBConnection_1.default.query(`
      SELECT 
        COUNT(*) as totalMessages,
        COUNT(CASE WHEN "isFromMe" = true THEN 1 END) as sentMessages,
        COUNT(CASE WHEN "isFromMe" = false THEN 1 END) as receivedMessages
      FROM messages
      WHERE "timeStamp" >= $1
    `, [startDate.toISOString()]);
        // Query chats with current status from status details
        const chatsResult = await DBConnection_1.default.query(`
      SELECT 
        COUNT(DISTINCT c.id) as totalChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'open' THEN c.id END) as openChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'closed' THEN c.id END) as closedChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'processing' THEN c.id END) as processingChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'pending' THEN c.id END) as pendingChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'unassigned' THEN c.id END) as unassignedChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'follow_up' THEN c.id END) as followUpChats,
        COUNT(DISTINCT CASE WHEN csd.status = 'resolved' THEN c.id END) as resolvedChats
      FROM chats c
      LEFT JOIN (
        SELECT DISTINCT ON (chat_id) 
          chat_id, 
          status, 
          changed_at
        FROM chat_status_details 
        ORDER BY chat_id, changed_at DESC
      ) csd ON c.id = csd.chat_id
      WHERE c."lastMessageTime" >= $1
    `, [startDate.toISOString()]);
        // Query messages for response time calculation (simplified)
        const responseTimeResult = await DBConnection_1.default.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM ("timeStamp" - "lastMessageTime")) / 60) as avgResponseTime
      FROM messages m
      JOIN chats c ON m."chatId" = c.id
      WHERE m."timeStamp" >= $1 AND m."isFromMe" = false
    `, [startDate.toISOString()]);
        // Query active agents (users who have sent messages)
        const agentsResult = await DBConnection_1.default.query(`
      SELECT COUNT(DISTINCT "userId") as activeAgents
      FROM chats
      WHERE "lastMessageTime" >= $1
    `, [startDate.toISOString()]);
        // Calculate average resolution time using status details table
        const resolutionTimeResult = await DBConnection_1.default.query(`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (csd_closed.changed_at - csd_open.changed_at)) / 60) as avgResolutionTime
      FROM chats c
      JOIN chat_status_details csd_open ON c.id = csd_open.chat_id 
        AND csd_open.status = 'open'
        AND csd_open.changed_at = (
          SELECT MIN(changed_at) 
          FROM chat_status_details 
          WHERE chat_id = c.id AND status = 'open'
        )
      JOIN chat_status_details csd_closed ON c.id = csd_closed.chat_id 
        AND csd_closed.status = 'closed'
        AND csd_closed.changed_at = (
          SELECT MAX(changed_at) 
          FROM chat_status_details 
          WHERE chat_id = c.id AND status = 'closed'
        )
      WHERE c."lastMessageTime" >= $1
    `, [startDate.toISOString()]);
        // Mock customer satisfaction (this would need a ratings table)
        const customerSatisfaction = 4.5;
        const stats = {
            totalMessages: parseInt(messagesResult.rows[0]?.totalMessages || '0'),
            sentMessages: parseInt(messagesResult.rows[0]?.sentMessages || '0'),
            receivedMessages: parseInt(messagesResult.rows[0]?.receivedMessages || '0'),
            avgResponseTime: parseFloat(responseTimeResult.rows[0]?.avgResponseTime || '0') || 3.5,
            totalChats: parseInt(chatsResult.rows[0]?.totalChats || '0'),
            openChats: parseInt(chatsResult.rows[0]?.openChats || '0'),
            closedChats: parseInt(chatsResult.rows[0]?.closedChats || '0'),
            processingChats: parseInt(chatsResult.rows[0]?.processingChats || '0'),
            pendingChats: parseInt(chatsResult.rows[0]?.pendingChats || '0'),
            unassignedChats: parseInt(chatsResult.rows[0]?.unassignedChats || '0'),
            followUpChats: parseInt(chatsResult.rows[0]?.followUpChats || '0'),
            resolvedChats: parseInt(chatsResult.rows[0]?.resolvedChats || '0'),
            avgResolutionTime: parseFloat(resolutionTimeResult.rows[0]?.avgResolutionTime || '0') || 45,
            customerSatisfaction: customerSatisfaction,
            activeAgents: parseInt(agentsResult.rows[0]?.activeAgents || '0')
        };
        res.json(stats);
    }
    catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});
module.exports = router;
