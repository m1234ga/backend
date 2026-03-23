"use strict";
/**
 * Production-Ready Server Entry Point
 * Refactored with proper architecture, security, and error handling
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const cors_1 = __importDefault(require("cors"));
// Configuration and utilities
const config_1 = require("./src/config");
const logger_1 = require("./src/utils/logger");
const timezone_1 = require("./src/utils/timezone");
const rateLimiter_1 = require("./src/middleware/rateLimiter");
const constants_1 = require("./src/constants");
const DBConnection_1 = __importDefault(require("./DBConnection"));
const auth_1 = require("./src/utils/auth");
const WhatsAppApiService_1 = require("./src/services/WhatsAppApiService");
const DatabaseService_1 = require("./src/services/DatabaseService");
// Handlers
const SocketHandler_1 = require("./src/handlers/SocketHandler");
// Routers
const Chat_1 = __importDefault(require("./Routers/Chat"));
const UserManagement_1 = __importDefault(require("./Routers/UserManagement"));
const Reports_1 = __importDefault(require("./Routers/Reports"));
const Dashboard_1 = __importDefault(require("./Routers/Dashboard"));
const Auth_1 = __importDefault(require("./Routers/Auth"));
const processWhatsAppHooks_1 = __importDefault(require("./processWhatsAppHooks"));
const authMiddleware_1 = require("./middleware/authMiddleware");
const logger = (0, logger_1.createLogger)('Server');
// Validate configuration on startup
try {
    (0, config_1.validateConfig)();
    logger.info('Configuration validated successfully');
}
catch (error) {
    logger.error('Configuration validation failed', error);
    process.exit(1);
}
const app = (0, express_1.default)();
exports.app = app;
// ============================================================================
// MIDDLEWARE
// ============================================================================
// Body parsing
app.use(express_1.default.json({ limit: '200mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '200mb' }));
// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            config_1.CONFIG.FRONTEND_URL,
            config_1.CONFIG.FRONTEND_URL.replace(/^https?/, 'http'),
            config_1.CONFIG.FRONTEND_URL.replace(/^https?/, 'https'),
            ...config_1.CONFIG.ALLOWED_ORIGINS,
        ];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            logger.security('CORS blocked request', { origin });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use((0, cors_1.default)(corsOptions));
// Rate limiting
app.use('/api', rateLimiter_1.httpRateLimiter.middleware);
// Static file serving
app.use('/imgs', express_1.default.static(config_1.CONFIG.PATHS.IMAGES));
app.use('/video', express_1.default.static(config_1.CONFIG.PATHS.VIDEOS));
app.use('/audio', express_1.default.static(config_1.CONFIG.PATHS.AUDIO));
app.use('/docs', express_1.default.static(config_1.CONFIG.PATHS.DOCUMENTS));
// Request logging
app.use((req, res, next) => {
    const startTime = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.apiRequest(req.method, req.path, {
            status: res.statusCode,
            duration,
            ip: req.ip,
        });
    });
    next();
});
// ============================================================================
// ROUTES
// ============================================================================
// Health check endpoint
app.get('/health', (req, res) => {
    res.status(constants_1.HTTP_STATUS.OK).json({
        status: 'healthy',
        timestamp: (0, timezone_1.adjustToConfiguredTimezone)(new Date()),
        uptime: process.uptime(),
        environment: config_1.CONFIG.NODE_ENV,
    });
});
// API routes
app.use('/api/auth', Auth_1.default);
app.use('/api/chat', authMiddleware_1.authMiddleware, Chat_1.default);
app.use('/api/user-management', authMiddleware_1.adminMiddleware, UserManagement_1.default);
app.use('/api/reports', authMiddleware_1.adminMiddleware, Reports_1.default);
app.use('/api/dashboard', authMiddleware_1.adminMiddleware, Dashboard_1.default);
// WhatsApp webhook
app.post('/webhook', async (req, res) => {
    try {
        logger.debug('Received webhook', { type: req.body?.type });
        await (0, processWhatsAppHooks_1.default)(req.body);
        res.status(constants_1.HTTP_STATUS.OK).json({ success: true });
    }
    catch (error) {
        logger.error('Webhook processing failed', error);
        res.status(constants_1.HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: constants_1.ERROR_MESSAGES.INTERNAL_ERROR,
        });
    }
});
// 404 handler
app.use((req, res) => {
    logger.warn('Route not found', { path: req.path, method: req.method });
    res.status(constants_1.HTTP_STATUS.NOT_FOUND).json({
        error: constants_1.ERROR_MESSAGES.NOT_FOUND,
        path: req.path,
    });
});
// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', err, {
        path: req.path,
        method: req.method,
        body: req.body,
    });
    res.status(constants_1.HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: config_1.CONFIG.NODE_ENV === 'production'
            ? constants_1.ERROR_MESSAGES.INTERNAL_ERROR
            : err.message,
        ...(config_1.CONFIG.NODE_ENV !== 'production' && { stack: err.stack }),
    });
});
// ============================================================================
// SERVER INITIALIZATION
// ============================================================================
function createServer() {
    if (config_1.CONFIG.USE_HTTPS) {
        const certPath = config_1.CONFIG.SSL.CERT_PATH || path_1.default.join(config_1.CONFIG.SSL.BASE_PATH, config_1.CONFIG.SSL.CERT_FILENAME || 'server.crt');
        const keyPath = config_1.CONFIG.SSL.KEY_PATH || path_1.default.join(config_1.CONFIG.SSL.BASE_PATH, config_1.CONFIG.SSL.KEY_FILENAME || 'server.key');
        if (!fs_1.default.existsSync(certPath) || !fs_1.default.existsSync(keyPath)) {
            logger.error('SSL certificates not found', { certPath, keyPath });
            throw new Error('SSL certificates not found');
        }
        const httpsOptions = {
            cert: fs_1.default.readFileSync(certPath),
            key: fs_1.default.readFileSync(keyPath),
        };
        logger.info('Creating HTTPS server', { certPath, keyPath });
        return https_1.default.createServer(httpsOptions, app);
    }
    logger.info('Creating HTTP server');
    return http_1.default.createServer(app);
}
const server = createServer();
exports.server = server;
// Initialize Socket.IO
const io = SocketHandler_1.socketHandler.initialize(server);
exports.io = io;
logger.info('Socket.IO initialized');
// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown`);
    // Stop accepting new connections
    server.close(() => {
        logger.info('HTTP server closed');
    });
    // Close Socket.IO connections
    if (io) {
        io.close(() => {
            logger.info('Socket.IO server closed');
        });
    }
    // Wait for ongoing requests to complete (max 10 seconds)
    setTimeout(() => {
        logger.warn('Forcing shutdown after timeout');
        process.exit(0);
    }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', new Error(String(reason)), {
        promise: String(promise),
    });
});
// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});
async function shouldBaselineExistingDatabase() {
    const migrationTableResult = await DBConnection_1.default.query(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
        ) AS exists
        `);
    const hasMigrationTable = Boolean(migrationTableResult.rows[0]?.exists);
    if (hasMigrationTable) {
        const appliedMigrationsResult = await DBConnection_1.default.query('SELECT COUNT(*)::int AS count FROM "_prisma_migrations"');
        const appliedMigrationCount = Number(appliedMigrationsResult.rows[0]?.count || 0);
        if (appliedMigrationCount > 0) {
            return false;
        }
    }
    const appTablesResult = await DBConnection_1.default.query(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('app_users', 'chats', 'messages', 'contacts')
        ) AS exists
        `);
    return Boolean(appTablesResult.rows[0]?.exists);
}
function resolveExistingMigrationsAsApplied(schemaFile) {
    const migrationsDir = path_1.default.join(__dirname, path_1.default.dirname(schemaFile), 'migrations');
    if (!fs_1.default.existsSync(migrationsDir)) {
        throw new Error(`Prisma migrations directory not found: ${migrationsDir}`);
    }
    const migrationNames = fs_1.default.readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    if (migrationNames.length === 0) {
        throw new Error(`No Prisma migrations found in ${migrationsDir}`);
    }
    logger.warn('Existing app database detected without Prisma migration history; baselining migrations as applied', {
        migrationNames,
    });
    for (const migrationName of migrationNames) {
        (0, child_process_1.execSync)(`npx prisma migrate resolve --applied ${migrationName} --schema ${schemaFile}`, {
            stdio: 'inherit',
            cwd: __dirname,
            env: process.env,
        });
    }
}
async function syncDatabaseSchemaOnStartup() {
    const shouldSync = (process.env.DB_SCHEMA_SYNC_ON_START || 'true').toLowerCase() === 'true';
    if (!shouldSync) {
        logger.info('DB schema sync on startup is disabled');
        return;
    }
    const mode = (process.env.DB_SCHEMA_SYNC_MODE || 'push').toLowerCase();
    const schemaFile = process.env.DB_SCHEMA_FILE || 'prisma/schema.app.prisma';
    const command = mode === 'migrate'
        ? `npx prisma migrate deploy --schema ${schemaFile}`
        : `npx prisma db push --skip-generate --schema ${schemaFile}`;
    logger.info('DB schema file location', {
        schemaFile,
        pointsToAppDatabase: schemaFile.includes('schema.app.prisma'),
        noteWhatsMeowTablesFromWuzAPI: 'WhatsMeow data is read from WuzAPI database only, not created locally'
    });
    if (mode === 'migrate' && await shouldBaselineExistingDatabase()) {
        resolveExistingMigrationsAsApplied(schemaFile);
    }
    logger.info('Running DB schema sync on startup', { mode, command });
    (0, child_process_1.execSync)(command, {
        stdio: 'inherit',
        cwd: __dirname,
        env: process.env,
    });
    logger.info('DB schema sync completed successfully');
}
async function ensureChatsInfoView() {
    const sql = `
CREATE OR REPLACE VIEW public.chatsinfo AS
SELECT chats.id,
       chats."lastMessage",
       chats."lastMessageTime",
       chats."unReadCount",
       chats."isOnline",
       chats."contactId" AS contactid,
       chats."isTyping",
       COALESCE(groups.name, lm.full_name::text, lm.first_name::text, lm.business_name::text, lm.push_name::text, chats.pushname) AS name,
       COALESCE((groups.id || '@g.us'::text)::character varying,lm.phone)::character varying(50) AS phone,
       lm.is_my_contact,
       lm.is_business,
       tags.tagsname,
       chats.isarchived,
       chats."assignedTo",
       chats.ismuted,
       chats.status,
       chats.avatar,
       last_msg.status AS "lastMessageStatus"
FROM chats
LEFT JOIN lid_mappings lm ON lm.lid::text = chats.id::text
LEFT JOIN groups ON groups.id = chats.id::text
LEFT JOIN (
    SELECT "chatTags"."chatId",
           string_agg((tags_1."tagName" || '_-_'::text) || tags_1."tagId"::text, '-_-'::text) AS tagsname
    FROM tags tags_1
    JOIN "chatTags" ON "chatTags"."tagId" = tags_1."tagId"
    GROUP BY "chatTags"."chatId"
) tags ON tags."chatId"::text = chats.id::text
LEFT JOIN LATERAL (
    SELECT messages.status
    FROM messages
    WHERE messages."chatId"::text = chats.id::text
    ORDER BY messages."timeStamp" DESC
    LIMIT 1
) last_msg ON true;
`;
    logger.info('Ensuring chatsinfo view exists and is up to date');
    await DBConnection_1.default.query(sql);
}
async function ensureDefaultAdminUser() {
    const username = 'admin';
    const password = 'admin';
    const email = 'admin@example.com';
    const result = await DBConnection_1.default.query('SELECT id FROM app_users WHERE username = $1 LIMIT 1', [username]);
    if (result.rows.length > 0) {
        logger.info('Default admin user already exists');
        return;
    }
    const passwordHash = await (0, auth_1.hashPassword)(password);
    await DBConnection_1.default.query(`
        INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [(0, crypto_1.randomUUID)(), username, email, passwordHash, 'Admin', 'User', 'admin', true]);
    logger.warn('Default admin user created', { username });
}
function extractGroupsFromGroupListResponse(payload) {
    const candidates = [
        payload,
        payload?.data,
        payload?.groups,
        payload?.Groups,
        payload?.Data,
        payload?.data?.groups,
        payload?.data?.Groups,
        payload?.Data?.groups,
        payload?.Data?.Groups,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
}
async function syncGroupsFromWuzApiOnStartup() {
    try {
        logger.info('Syncing groups from WuzAPI /group/list on startup');
        const result = await WhatsAppApiService_1.whatsAppApiService.getGroupList();
        if (!result.success) {
            logger.warn('Failed to fetch groups from WuzAPI /group/list', {
                error: result.error,
                details: result.details,
            });
            return;
        }
        const groups = extractGroupsFromGroupListResponse(result.data);
        if (!groups.length) {
            logger.info('No groups returned from WuzAPI /group/list');
            return;
        }
        let upserted = 0;
        for (const group of groups) {
            const groupJid = String(group?.JID || group?.Jid || group?.jid || '').trim();
            if (!groupJid || !groupJid.includes('@g.us')) {
                continue;
            }
            const conversationId = groupJid.split('@')[0];
            const groupName = String(group?.Name || group?.name || group?.subject || 'Group');
            await DatabaseService_1.databaseService.upsertGroup(conversationId, groupName);
            upserted += 1;
        }
        logger.info('Startup group sync completed', {
            received: groups.length,
            upserted,
        });
    }
    catch (error) {
        logger.error('Startup group sync failed', error);
    }
}
// ============================================================================
// START SERVER
// ============================================================================
async function startServer() {
    try {
        await syncDatabaseSchemaOnStartup();
        await ensureChatsInfoView();
        await ensureDefaultAdminUser();
        await syncGroupsFromWuzApiOnStartup();
    }
    catch (error) {
        logger.error('DB schema sync failed, refusing to start server', error);
        process.exit(1);
    }
    server.listen(config_1.CONFIG.PORT, () => {
        const protocol = config_1.CONFIG.USE_HTTPS ? 'https' : 'http';
        logger.info(`Server started successfully`, {
            protocol,
            port: config_1.CONFIG.PORT,
            environment: config_1.CONFIG.NODE_ENV,
            url: `${protocol}://localhost:${config_1.CONFIG.PORT}`,
        });
        logger.info('Server is ready to accept connections');
    });
}
void startServer();
