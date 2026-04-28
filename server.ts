/**
 * Production-Ready Server Entry Point
 * Refactored with proper architecture, security, and error handling
 */

import express, { Request, Response, NextFunction } from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import cors from 'cors';

// Configuration and utilities
import { CONFIG, validateConfig } from './src/config';
import { createLogger } from './src/utils/logger';
import { adjustToConfiguredTimezone } from './src/utils/timezone';
import { httpRateLimiter } from './src/middleware/rateLimiter';
import { HTTP_STATUS, ERROR_MESSAGES } from './src/constants';
import pool from './DBConnection';
import { hashPassword } from './src/utils/auth';
import { whatsAppApiService } from './src/services/WhatsAppApiService';
import { databaseService } from './src/services/DatabaseService';

// Handlers
import { socketHandler } from './src/handlers/SocketHandler';

// Routers
import chatRouter from './Routers/Chat';
import userManagementRouter from './Routers/UserManagement';
import reportsRouter from './Routers/Reports';
import dashboardRouter from './Routers/Dashboard';
import authRouter from './Routers/Auth';
import processWhatsAppHooks from './processWhatsAppHooks';
import { authMiddleware, adminMiddleware } from './middleware/authMiddleware';

const logger = createLogger('Server');

// Validate configuration on startup
try {
    validateConfig();
    logger.info('Configuration validated successfully');
} catch (error) {
    logger.error('Configuration validation failed', error);
    process.exit(1);
}

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Body parsing
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// CORS configuration
const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowedOrigins = [
            CONFIG.FRONTEND_URL,
            CONFIG.FRONTEND_URL.replace(/^https?/, 'http'),
            CONFIG.FRONTEND_URL.replace(/^https?/, 'https'),
            ...CONFIG.ALLOWED_ORIGINS,
        ];

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.security('CORS blocked request', { origin });
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Rate limiting
app.use('/api', httpRateLimiter.middleware);

// Static file serving
app.use('/imgs', express.static(CONFIG.PATHS.IMAGES));
app.use('/video', express.static(CONFIG.PATHS.VIDEOS));
app.use('/audio', express.static(CONFIG.PATHS.AUDIO));
app.use('/docs', express.static(CONFIG.PATHS.DOCUMENTS));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
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
app.get('/health', (req: Request, res: Response) => {
    res.status(HTTP_STATUS.OK).json({
        status: 'healthy',
        timestamp: adjustToConfiguredTimezone(new Date()),
        uptime: process.uptime(),
        environment: CONFIG.NODE_ENV,
    });
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/chat', authMiddleware, chatRouter);
app.use('/api/user-management', adminMiddleware, userManagementRouter);
app.use('/api/reports', adminMiddleware, reportsRouter);
app.use('/api/dashboard', adminMiddleware, dashboardRouter);

// WhatsApp webhook
app.post('/webhook', async (req: Request, res: Response) => {
    try {
        logger.debug('Received webhook', { type: req.body?.type });
        await processWhatsAppHooks(req.body);
        res.status(HTTP_STATUS.OK).json({ success: true });
    } catch (error) {
        logger.error('Webhook processing failed', error);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: ERROR_MESSAGES.INTERNAL_ERROR,
        });
    }
});

// 404 handler
app.use((req: Request, res: Response) => {
    logger.warn('Route not found', { path: req.path, method: req.method });
    res.status(HTTP_STATUS.NOT_FOUND).json({
        error: ERROR_MESSAGES.NOT_FOUND,
        path: req.path,
    });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error', err, {
        path: req.path,
        method: req.method,
        body: req.body,
    });

    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: CONFIG.NODE_ENV === 'production'
            ? ERROR_MESSAGES.INTERNAL_ERROR
            : err.message,
        ...(CONFIG.NODE_ENV !== 'production' && { stack: err.stack }),
    });
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

function createServer(): http.Server | https.Server {
    if (CONFIG.USE_HTTPS) {
        const certPath = CONFIG.SSL.CERT_PATH || path.join(CONFIG.SSL.BASE_PATH, CONFIG.SSL.CERT_FILENAME || 'server.crt');
        const keyPath = CONFIG.SSL.KEY_PATH || path.join(CONFIG.SSL.BASE_PATH, CONFIG.SSL.KEY_FILENAME || 'server.key');

        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            logger.error('SSL certificates not found', { certPath, keyPath });
            throw new Error('SSL certificates not found');
        }

        const httpsOptions = {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
        };

        logger.info('Creating HTTPS server', { certPath, keyPath });
        return https.createServer(httpsOptions, app);
    }

    logger.info('Creating HTTP server');
    return http.createServer(app);
}

const server = createServer();

// Initialize Socket.IO
const io = socketHandler.initialize(server);
logger.info('Socket.IO initialized');

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
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

async function shouldBaselineExistingDatabase(): Promise<boolean> {
    const migrationTableResult = await pool.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
        ) AS exists
        `
    );

    const hasMigrationTable = Boolean(migrationTableResult.rows[0]?.exists);
    if (hasMigrationTable) {
        const appliedMigrationsResult = await pool.query('SELECT COUNT(*)::int AS count FROM "_prisma_migrations"');
        const appliedMigrationCount = Number(appliedMigrationsResult.rows[0]?.count || 0);
        if (appliedMigrationCount > 0) {
            return false;
        }
    }

    const appTablesResult = await pool.query(
        `
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('app_users', 'chats', 'messages', 'contacts')
        ) AS exists
        `
    );

    return Boolean(appTablesResult.rows[0]?.exists);
}

function resolveExistingMigrationsAsApplied(schemaFile: string): void {
    const migrationsDir = path.join(__dirname, path.dirname(schemaFile), 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        throw new Error(`Prisma migrations directory not found: ${migrationsDir}`);
    }

    const migrationNames = fs.readdirSync(migrationsDir, { withFileTypes: true })
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
        execSync(`npx prisma migrate resolve --applied ${migrationName} --schema ${schemaFile}`, {
            stdio: 'inherit',
            cwd: __dirname,
            env: process.env,
        });
    }
}

async function syncDatabaseSchemaOnStartup(): Promise<void> {
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
    try {
        execSync(command, {
            stdio: 'inherit',
            cwd: __dirname,
            env: process.env,
        });
    } catch (error) {
        const errorObject = error as { stderr?: Buffer; stdout?: Buffer; message?: string };
        const errorText = String(errorObject.stderr?.toString() || '')
            + String(errorObject.stdout?.toString() || '')
            + String(errorObject.message || '');

        if (mode === 'migrate' && errorText.includes('20260428000001_optimize_chatsinfo_view')) {
            logger.warn('Detected failed chatsinfo optimization migration; applying recovery path', {
                migration: '20260428000001_optimize_chatsinfo_view',
            });

            await ensureChatsInfoView();
            execSync(`npx prisma migrate resolve --applied 20260428000001_optimize_chatsinfo_view --schema ${schemaFile}`, {
                stdio: 'inherit',
                cwd: __dirname,
                env: process.env,
            });

            logger.info('Recovered failed chatsinfo optimization migration');
        } else {
            throw error;
        }
    }
    logger.info('DB schema sync completed successfully');
}

async function ensureChatsInfoView(): Promise<void> {
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
       NULL::character varying(20) AS "lastMessageStatus"
FROM chats
LEFT JOIN lid_mappings lm ON lm.lid::text = chats.id::text
LEFT JOIN groups ON groups.id = chats.id::text
LEFT JOIN (
    SELECT "chatTags"."chatId",
           string_agg((tags_1."tagName" || '_-_'::text) || tags_1."tagId"::text, '-_-'::text ORDER BY tags_1."tagId") AS tagsname
    FROM tags tags_1
    INNER JOIN "chatTags" ON "chatTags"."tagId" = tags_1."tagId"
    GROUP BY "chatTags"."chatId"
) tags ON tags."chatId"::text = chats.id::text;
`;

    logger.info('Ensuring chatsinfo view exists and is up to date');
    await pool.query(sql);
}

async function ensureDefaultAdminUser(): Promise<void> {
    const username = 'admin';
    const password = 'admin';
    const email = 'admin@example.com';

    const result = await pool.query(
        'SELECT id FROM app_users WHERE username = $1 LIMIT 1',
        [username]
    );

    if (result.rows.length > 0) {
        logger.info('Default admin user already exists');
        return;
    }

    const passwordHash = await hashPassword(password);
    await pool.query(
        `
        INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [randomUUID(), username, email, passwordHash, 'Admin', 'User', 'admin', true]
    );

    logger.warn('Default admin user created', { username });
}

interface StartupGroup {
    JID?: string;
    Jid?: string;
    jid?: string;
    Name?: string;
    name?: string;
    subject?: string;
}

function extractGroupsFromGroupListResponse(payload: any): StartupGroup[] {
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

async function syncGroupsFromWuzApiOnStartup(): Promise<void> {
    try {
        logger.info('Syncing groups from WuzAPI /group/list on startup');
        const result = await whatsAppApiService.getGroupList();

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
            await databaseService.upsertGroup(conversationId, groupName);
            upserted += 1;
        }

        logger.info('Startup group sync completed', {
            received: groups.length,
            upserted,
        });
    } catch (error) {
        logger.error('Startup group sync failed', error);
    }
}

// ============================================================================
// START SERVER
// ============================================================================

async function startServer(): Promise<void> {
    try {
        await syncDatabaseSchemaOnStartup();
        await ensureChatsInfoView();
        await ensureDefaultAdminUser();
        await syncGroupsFromWuzApiOnStartup();
    } catch (error) {
        logger.error('DB schema sync failed, refusing to start server', error);
        process.exit(1);
    }

    server.listen(CONFIG.PORT, () => {
        const protocol = CONFIG.USE_HTTPS ? 'https' : 'http';
        logger.info(`Server started successfully`, {
            protocol,
            port: CONFIG.PORT,
            environment: CONFIG.NODE_ENV,
            url: `${protocol}://localhost:${CONFIG.PORT}`,
        });

        logger.info('Server is ready to accept connections');
    });
}

void startServer();

export { app, server, io };
