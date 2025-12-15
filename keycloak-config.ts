import Keycloak from 'keycloak-connect';
import session from 'express-session';

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
    'allowedOrigins': [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:5000',
      'https://45.93.139.52:3443', // Production frontend
      'https://45.93.139.52:4443', // Production 
      // 
      // backend
      ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : [])
    ],
    'allowedMethods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    'allowedHeaders': ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Set-Cookie']
  }
};

// Session configuration
const memoryStore = new session.MemoryStore();

// Create Keycloak instance with session store
const keycloak = new Keycloak({ store: memoryStore }, keycloakConfig);

export const sessionConfig = session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  store: memoryStore,
  cookie: {
    secure: process.env.USE_HTTPS !== 'false', // Use secure cookies in HTTPS
    httpOnly: true, // Prevent XSS attacks
    sameSite: 'none', // Allow cross-origin requests (required for CORS with credentials)
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

export default keycloak;
