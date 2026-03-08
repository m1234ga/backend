/**
 * Production-Ready Server Entry Point
 * Refactored with proper architecture, security, and error handling
 */

import express, { Request, Response, NextFunction } from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import cors from 'cors';

// Configuration and utilities
import { CONFIG, validateConfig } from './src/config';
import { createLogger } from './src/utils/logger';
import { adjustToConfiguredTimezone } from './src/utils/timezone';
import { httpRateLimiter } from './src/middleware/rateLimiter';
import { HTTP_STATUS, ERROR_MESSAGES } from './src/constants';

// Handlers
import { socketHandler } from './src/handlers/SocketHandler';

// Routers
import chatRouter from './Routers/Chat';
import userManagementRouter from './Routers/UserManagement';
import reportsRouter from './Routers/Reports';
import dashboardRouter from './Routers/Dashboard';
import authRouter from './Routers/Auth';
import processWhatsAppHooks from './processWhatsAppHooks';

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
app.use('/api/chat', chatRouter);
app.use('/api/user-management', userManagementRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);

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

// ============================================================================
// START SERVER
// ============================================================================

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

export { app, server, io };
