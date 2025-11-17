"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = require("express");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const router = (0, express_1.Router)();
// Dashboard API endpoint
router.get('/api/dashboard', async (req, res) => {
    try {
        const { timeRange = 'today', field = 'general' } = req.query;
        // Calculate date range
        const now = new Date();
        let startDate = new Date();
        switch (timeRange) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(now.getMonth() - 1);
                break;
            case 'quarter':
                startDate.setMonth(now.getMonth() - 3);
                break;
            default:
                startDate.setHours(0, 0, 0, 0);
        }
        // Query real-time metrics from chats table with status details
        const realTimeQuery = `
      SELECT 
        COUNT(DISTINCT c.id) as allChats,
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
          status
        FROM chat_status_details 
        ORDER BY chat_id, changed_at DESC
      ) csd ON c.id = csd.chat_id
      WHERE c."lastMessageTime" >= $1
    `;
        const realTimeResult = await DBConnection_1.default.query(realTimeQuery, [startDate.toISOString()]);
        // Query messages for incoming/outgoing
        const messagesQuery = `
      SELECT 
        COUNT(CASE WHEN "isFromMe" = false THEN 1 END) as incoming,
        COUNT(CASE WHEN "isFromMe" = true THEN 1 END) as outgoing
      FROM messages
      WHERE "timeStamp" >= $1
    `;
        const messagesResult = await DBConnection_1.default.query(messagesQuery, [startDate.toISOString()]);
        // Query distinct contacts
        const contactsQuery = `
      SELECT COUNT(DISTINCT "contactId") as contacts
      FROM chats
      WHERE "lastMessageTime" >= $1
    `;
        const contactsResult = await DBConnection_1.default.query(contactsQuery, [startDate.toISOString()]);
        // Query distinct users
        const usersQuery = `
      SELECT COUNT(DISTINCT "userId") as users
      FROM chats
      WHERE "lastMessageTime" >= $1
    `;
        const usersResult = await DBConnection_1.default.query(usersQuery, [startDate.toISOString()]);
        const dashboardData = {
            // Real-time metrics
            allChats: parseInt(realTimeResult.rows[0]?.allChats || '0'),
            openChats: parseInt(realTimeResult.rows[0]?.openChats || '0'),
            closedChats: parseInt(realTimeResult.rows[0]?.closedChats || '0'),
            processing: parseInt(realTimeResult.rows[0]?.processingChats || '0'),
            pending: parseInt(realTimeResult.rows[0]?.pendingChats || '0'),
            unassigned: parseInt(realTimeResult.rows[0]?.unassignedChats || '0'),
            followUp: parseInt(realTimeResult.rows[0]?.followUpChats || '0'),
            done: parseInt(realTimeResult.rows[0]?.resolvedChats || '0'),
            // All-time metrics
            allInstances: parseInt(realTimeResult.rows[0]?.allChats || '0'),
            allUsers: parseInt(usersResult.rows[0]?.users || '0'),
            allContacts: parseInt(contactsResult.rows[0]?.contacts || '0'),
            allBots: 0,
            allSpeedMessages: parseInt(messagesResult.rows[0]?.outgoing || '0'),
            allSpeedFiles: 0,
            allBroadcasts: 0,
            allBulks: 0,
            // Chart data
            messagesData: {
                incoming: parseInt(messagesResult.rows[0]?.incoming || '0'),
                outgoing: parseInt(messagesResult.rows[0]?.outgoing || '0')
            },
            companyUnitsData: {
                interactiveContacts: parseInt(contactsResult.rows[0]?.contacts || '0'),
                aiReplies: 0,
                campaignSent: 0
            },
            contactsAnalyticsData: {
                newContacts: parseInt(contactsResult.rows[0]?.contacts || '0'),
                newGroupContacts: 0,
                restContacts: 0
            },
            broadcastData: {
                cantSend: 0,
                sent: 0,
                pending: 0
            },
            fieldType: field
        };
        res.json(dashboardData);
    }
    catch (error) {
        console.error('Dashboard API Error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});
module.exports = router;
