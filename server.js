"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const Chat_1 = __importDefault(require("./Routers/Chat"));
const UserManagement_1 = __importDefault(require("./Routers/UserManagement"));
const Reports_1 = __importDefault(require("./Routers/Reports"));
const Dashboard_1 = __importDefault(require("./Routers/Dashboard"));
const processWhatsAppHooks_1 = __importDefault(require("./processWhatsAppHooks"));
const SocketEmits_1 = require("./SocketEmits");
const keycloak_config_1 = __importStar(require("./keycloak-config"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// SSL Certificate configuration
// Read certificate paths from environment variables
const useHttps = process.env.USE_HTTPS !== 'false'; // Default to true unless explicitly disabled
let server;
if (useHttps) {
    // Determine certificate paths from environment variables
    let certPath;
    let keyPath;
    // Option 1: Full paths from environment variables
    if (process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
        certPath = process.env.SSL_CERT_PATH;
        keyPath = process.env.SSL_KEY_PATH;
        console.log('📋 Using SSL certificate paths from environment variables:');
        console.log(`   Certificate: ${certPath}`);
        console.log(`   Private Key: ${keyPath}`);
    }
    // Option 2: Filenames with base path from environment variables
    else if (process.env.SSL_CERT_FILENAME && process.env.SSL_KEY_FILENAME) {
        const basePath = process.env.SSL_BASE_PATH || path_1.default.join(__dirname, 'ssl');
        certPath = path_1.default.join(basePath, process.env.SSL_CERT_FILENAME);
        keyPath = path_1.default.join(basePath, process.env.SSL_KEY_FILENAME);
        console.log('📋 Using SSL certificate filenames from environment variables:');
        console.log(`   Base Path: ${basePath}`);
        console.log(`   Certificate: ${process.env.SSL_CERT_FILENAME}`);
        console.log(`   Private Key: ${process.env.SSL_KEY_FILENAME}`);
        console.log(`   Full Certificate Path: ${certPath}`);
        console.log(`   Full Key Path: ${keyPath}`);
    }
    // Option 3: Default fallback (for backward compatibility)
    else {
        certPath = path_1.default.join(__dirname, 'ssl', 'cert.pem');
        keyPath = path_1.default.join(__dirname, 'ssl', 'key.pem');
        console.log('📋 Using default SSL certificate paths (no environment variables set):');
        console.log(`   Certificate: ${certPath}`);
        console.log(`   Private Key: ${keyPath}`);
        console.log('💡 Tip: Set SSL_CERT_PATH and SSL_KEY_PATH (or SSL_CERT_FILENAME and SSL_KEY_FILENAME) in your .env file');
    }
    try {
        // Check if certificate files exist
        if (fs_1.default.existsSync(certPath) && fs_1.default.existsSync(keyPath)) {
            const options = {
                cert: fs_1.default.readFileSync(certPath),
                key: fs_1.default.readFileSync(keyPath)
            };
            server = https_1.default.createServer(options, app);
            console.log('✅ HTTPS server initialized with SSL certificates');
        }
        else {
            console.warn(`⚠️  SSL certificates not found at:`);
            console.warn(`   Certificate: ${certPath}`);
            console.warn(`   Private Key: ${keyPath}`);
            console.warn('⚠️  Falling back to HTTP. To use HTTPS, please provide SSL certificates.');
            console.warn('⚠️  Set SSL_CERT_PATH and SSL_KEY_PATH in your .env file, or');
            console.warn('⚠️  For development, generate self-signed certificates using:');
            console.warn('⚠️  openssl req -x509 -newkey rsa:4096 -nodes -keyout ssl/key.pem -out ssl/cert.pem -days 365');
            server = http_1.default.createServer(app);
        }
    }
    catch (error) {
        console.error('❌ Error loading SSL certificates:', error);
        console.warn('⚠️  Falling back to HTTP server');
        server = http_1.default.createServer(app);
    }
}
else {
    server = http_1.default.createServer(app);
    console.log('ℹ️  HTTP server initialized (HTTPS disabled via USE_HTTPS=false)');
}
// Determine protocol based on server type
const protocol = server instanceof https_1.default.Server ? 'https' : 'http';
const defaultFrontendUrl = process.env.FRONTEND_URL || `${protocol}://localhost:3000`;
// Build allowed origins list
const allowedOrigins = [
    defaultFrontendUrl,
    defaultFrontendUrl.replace(/^https?/, 'http'), // Also allow HTTP version if HTTPS is used
    defaultFrontendUrl.replace(/^https?/, 'https'), // Also allow HTTPS version if HTTP is used
    'http://localhost:8080', // Allow Keycloak server
    'https://localhost:8080',
    process.env.KEYCLOAK_URL || 'http://localhost:8080', // Allow Keycloak server (HTTPS)
    // Production URLs
    'https://45.93.139.52:3443', // Production frontend
    'https://45.93.139.52:4443', // Production backend (for redirects)
    'https://45.93.139.52:8443', // Production Keycloak
    // Add any additional origins from environment variable (comma-separated)
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : [])
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, or curl)
        if (!origin) {
            return callback(null, true);
        }
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            // Log for debugging
            console.warn(`⚠️  CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true, // Enable credentials (cookies, authorization headers)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Set-Cookie'],
    exposedHeaders: ['Set-Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204
}));
// Additional CORS headers middleware to ensure all responses have CORS headers
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cookie, Set-Cookie');
        res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    }
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});
// Use session middleware
app.use(keycloak_config_1.sessionConfig);
// Use Keycloak middleware with custom error handling
app.use(keycloak_config_1.default.middleware({
    logout: '/logout',
    admin: '/'
}));
app.use('/imgs', express_1.default.static('imgs'));
app.use('/audio', express_1.default.static('Audio'));
app.use(express_1.default.json({ limit: '200mb' }));
app.use(express_1.default.urlencoded({ limit: '200mb', extended: true }));
// Custom authentication callback handler with CORS headers
app.get('/auth/callback', (req, res) => {
    // Add CORS headers before redirect
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    // Handle Keycloak callback and redirect back to frontend
    const redirectUri = process.env.FRONTEND_URL || defaultFrontendUrl;
    res.redirect(redirectUri);
});
// Temporary public debug endpoint (bypasses Keycloak) for local development
// Only enable when explicitly allowed via env DEBUG_API_PUBLIC=true to avoid exposing data in production.
if ((process.env.DEBUG_API_PUBLIC || 'false').toLowerCase() === 'true') {
    app.get('/ChatPublic/api/GetChatsPage', async (req, res) => {
        try {
            const page = Math.max(parseInt(req.query.page || '1', 10), 1);
            const limit = Math.max(parseInt(req.query.limit || '25', 10), 1);
            const offset = (page - 1) * limit;
            const status = req.query.status || null;
            let baseSql = 'SELECT * FROM chatsInfo';
            const params = [];
            if (status) {
                baseSql += ' WHERE status = $1';
                params.push(status);
            }
            baseSql += ' ORDER BY "lastMessageTime" DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
            params.push(limit, offset);
            const result = await global.pool.query(baseSql, params);
            res.json({ page, limit, chats: result.rows });
        }
        catch (error) {
            console.error('Error in public GetChatsPage:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
}
// Protect API routes with Keycloak
app.use('/Chat', keycloak_config_1.default.protect(), Chat_1.default);
app.use('/api/users', keycloak_config_1.default.protect(), UserManagement_1.default);
app.use('', Reports_1.default); // Reports accessible without protection for now
app.use('', Dashboard_1.default); // Dashboard accessible without protection for now
app.post('/webhook', async (req, res) => {
    var data = new processWhatsAppHooks_1.default(req.body);
    console.log('✅ Webhook received:', req.body);
    res.status(200).json({ message: 'Webhook received successfully' });
});
// Initialize Socket.IO
const io = (0, SocketEmits_1.initializeSocketIO)(server);
// Initialize database and start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    const serverType = server instanceof https_1.default.Server ? 'HTTPS' : 'HTTP';
    console.log(`🚀 ${serverType} Server running on port ${PORT}`);
    console.log(`📍 Server URL: ${protocol}://localhost:${PORT}`);
});
