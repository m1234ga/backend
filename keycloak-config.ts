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
    'allowedOrigins': ['http://localhost:3000', 'http://localhost:5000'],
    'allowedMethods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    'allowedHeaders': ['Content-Type', 'Authorization', 'X-Requested-With']
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
  store: memoryStore
});

export default keycloak;
