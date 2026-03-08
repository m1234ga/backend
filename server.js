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
const cors_1 = __importDefault(require("cors"));
// Configuration and utilities
const config_1 = require("./src/config");
const logger_1 = require("./src/utils/logger");
const timezone_1 = require("./src/utils/timezone");
const rateLimiter_1 = require("./src/middleware/rateLimiter");
const constants_1 = require("./src/constants");
// Handlers
const SocketHandler_1 = require("./src/handlers/SocketHandler");
// Routers
const Chat_1 = __importDefault(require("./Routers/Chat"));
const UserManagement_1 = __importDefault(require("./Routers/UserManagement"));
const Reports_1 = __importDefault(require("./Routers/Reports"));
const Dashboard_1 = __importDefault(require("./Routers/Dashboard"));
const Auth_1 = __importDefault(require("./Routers/Auth"));
const processWhatsAppHooks_1 = __importDefault(require("./processWhatsAppHooks"));
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
app.use('/api/chat', Chat_1.default);
app.use('/api/user-management', UserManagement_1.default);
app.use('/api/reports', Reports_1.default);
app.use('/api/dashboard', Dashboard_1.default);
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
// ============================================================================
// START SERVER
// ============================================================================
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
