"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = require("express");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const timezone_1 = require("../src/utils/timezone");
const router = (0, express_1.Router)();
// Dashboard API endpoint (mounted at /api/dashboard)
router.get('/', async (req, res) => {
    try {
        const { timeRange = 'today', field = 'general' } = req.query;
        // Calculate date range
        const now = (0, timezone_1.adjustToConfiguredTimezone)(new Date());
        let startDate = (0, timezone_1.adjustToConfiguredTimezone)(new Date());
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
        const realTimeResult = await DBConnection_1.default.query(realTimeQuery, [startDate]);
        // Query messages for incoming/outgoing
        const messagesQuery = `
      SELECT 
        COUNT(CASE WHEN "isFromMe" = false THEN 1 END) as incoming,
        COUNT(CASE WHEN "isFromMe" = true THEN 1 END) as outgoing
      FROM messages
      WHERE "timeStamp" >= $1
    `;
        const messagesResult = await DBConnection_1.default.query(messagesQuery, [startDate]);
        // Query distinct contacts
        const contactsQuery = `
      SELECT COUNT(DISTINCT "contactId") as contacts
      FROM chats
      WHERE "lastMessageTime" >= $1
    `;
        const contactsResult = await DBConnection_1.default.query(contactsQuery, [startDate]);
        // Query app users summary (real users + active logged-in users)
        const usersQuery = `
      SELECT
        COUNT(*)::int as total_users,
        COUNT(*) FILTER (WHERE COALESCE(is_active, false) = true)::int as active_users
      FROM app_users
    `;
        const usersResult = await DBConnection_1.default.query(usersQuery);
        // Query agent performance from app_users + assigned chats
        const agentMetricsQuery = `
      WITH latest_status AS (
        SELECT DISTINCT ON (chat_id) chat_id, status
        FROM chat_status_details
        ORDER BY chat_id, changed_at DESC
      ),
      first_incoming AS (
        SELECT "chatId", MIN("timeStamp") as first_incoming
        FROM messages
        WHERE "isFromMe" = false AND "timeStamp" >= $1
        GROUP BY "chatId"
      ),
      first_outgoing AS (
        SELECT "chatId", MIN("timeStamp") as first_outgoing
        FROM messages
        WHERE "isFromMe" = true AND "timeStamp" >= $1
        GROUP BY "chatId"
      )
      SELECT
        u.id as "agentId",
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.username) as "agentName",
        COALESCE(COUNT(DISTINCT c.id), 0)::int as "totalAssignedChats",
        COALESCE(COUNT(DISTINCT CASE WHEN ls.status = 'resolved' THEN c.id END), 0)::int as "resolvedChats",
        COALESCE(COUNT(DISTINCT CASE WHEN ls.status = 'open' THEN c.id END), 0)::int as "openChats",
        COALESCE(ROUND(AVG(
          CASE
            WHEN fi.first_incoming IS NOT NULL
             AND fo.first_outgoing IS NOT NULL
             AND fo.first_outgoing >= fi.first_incoming
            THEN EXTRACT(EPOCH FROM (fo.first_outgoing - fi.first_incoming))
          END
        ))::int, 0) as "responseTime",
        COALESCE(ROUND(AVG(
          CASE
            WHEN c."lastMessageTime" IS NOT NULL
            THEN EXTRACT(EPOCH FROM (NOW() - c."lastMessageTime"))
          END
        ))::int, 0) as "resolutionTime",
        COALESCE(ROUND((
          COUNT(DISTINCT CASE WHEN ls.status = 'resolved' THEN c.id END)::numeric
          / NULLIF(COUNT(DISTINCT c.id), 0)
        ) * 100)::int, 0) as "customerSatisfaction",
        COALESCE(u.is_active, false) as "isActive"
      FROM app_users u
      LEFT JOIN chats c
        ON c."assignedTo" = u.id::text
       AND c."lastMessageTime" >= $1
      LEFT JOIN latest_status ls ON ls.chat_id = c.id
      LEFT JOIN first_incoming fi ON fi."chatId" = c.id
      LEFT JOIN first_outgoing fo ON fo."chatId" = c.id
      GROUP BY u.id, u.username, u.first_name, u.last_name, u.is_active
      ORDER BY "totalAssignedChats" DESC, "agentName" ASC
    `;
        const agentMetricsResult = await DBConnection_1.default.query(agentMetricsQuery, [startDate]);
        const activeUsers = parseInt(usersResult.rows[0]?.active_users || '0');
        const totalUsers = parseInt(usersResult.rows[0]?.total_users || '0');
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
            allUsers: activeUsers,
            activeUsers,
            totalUsers,
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
            agentMetrics: agentMetricsResult.rows.map((row) => ({
                agentId: String(row.agentId || ''),
                agentName: String(row.agentName || 'Unknown'),
                responseTime: parseInt(String(row.responseTime || '0')),
                resolutionTime: parseInt(String(row.resolutionTime || '0')),
                customerSatisfaction: parseInt(String(row.customerSatisfaction || '0')),
                empathyScore: parseInt(String(row.customerSatisfaction || '0')),
                professionalismScore: parseInt(String(row.customerSatisfaction || '0')),
                problemSolvingScore: parseInt(String(row.customerSatisfaction || '0')),
                complianceScore: parseInt(String(row.customerSatisfaction || '0')),
                upsellScore: 0,
                productivityScore: parseInt(String(row.totalAssignedChats || '0')),
                totalAssignedChats: parseInt(String(row.totalAssignedChats || '0')),
                resolvedChats: parseInt(String(row.resolvedChats || '0')),
                openChats: parseInt(String(row.openChats || '0')),
                isActive: Boolean(row.isActive),
                fieldType: field,
            })),
            tatData: [],
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
