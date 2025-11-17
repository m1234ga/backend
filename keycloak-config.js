"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionConfig = void 0;
const keycloak_connect_1 = __importDefault(require("keycloak-connect"));
const express_session_1 = __importDefault(require("express-session"));
// Keycloak configuration - Backend uses chat-app-backend client
const keycloakConfig = {
    realm: process.env.KEYCLOAK_REALM || "chat-app",
    'auth-server-url': process.env.KEYCLOAK_URL || 'http://localhost:8080',
    'ssl-required': 'external',
    resource: process.env.KEYCLOAK_CLIENT_ID || 'chat-app-backend',
    'confidential-port': 0,
    'bearer-only': false, // Enable authentication flows, not just bearer token validation
    'credentials': {
        'secret': process.env.KEYCLOAK_CLIENT_SECRET || 'your-client-secret'
    },
    'policy-enforcer': {},
    'cors': {
        'allowedOrigins': ['http://localhost:3000', 'http://localhost:5000'],
        'allowedMethods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        'allowedHeaders': ['Content-Type', 'Authorization', 'X-Requested-With']
    }
};
// Session configuration
const memoryStore = new express_session_1.default.MemoryStore();
// Create Keycloak instance with session store
const keycloak = new keycloak_connect_1.default({ store: memoryStore }, keycloakConfig);
exports.sessionConfig = (0, express_session_1.default)({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    store: memoryStore
});
exports.default = keycloak;
