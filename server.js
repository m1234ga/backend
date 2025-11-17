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
const http_1 = __importDefault(require("http"));
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
const server = http_1.default.createServer(app);
app.use((0, cors_1.default)({
    origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:8080' // Allow Keycloak server
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
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
// Custom authentication callback handler
app.get('/auth/callback', (req, res) => {
    // Handle Keycloak callback and redirect back to frontend
    const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}`;
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
    console.log(`Server running on port ${PORT}`);
});
