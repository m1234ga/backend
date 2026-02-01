import 'dotenv/config';
import express, { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import chatRouter from './Routers/Chat';
import userManagementRouter from './Routers/UserManagement';
import reportsRouter from './Routers/Reports';
import dashboardRouter from './Routers/Dashboard';
import processWhatsAppHooks from './processWhatsAppHooks';
import { initializeSocketIO } from './SocketEmits';



const app = express();
// Trigger restart

// SSL Certificate configuration
// Read certificate paths from environment variables
const useHttps = process.env.USE_HTTPS !== 'false'; // Default to true unless explicitly disabled
let server: https.Server | http.Server;

if (useHttps) {
  // Determine certificate paths from environment variables
  let certPath: string;
  let keyPath: string;

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
    const basePath = process.env.SSL_BASE_PATH || path.join(__dirname, 'ssl');
    certPath = path.join(basePath, process.env.SSL_CERT_FILENAME);
    keyPath = path.join(basePath, process.env.SSL_KEY_FILENAME);
    console.log('📋 Using SSL certificate filenames from environment variables:');
    console.log(`   Base Path: ${basePath}`);
    console.log(`   Certificate: ${process.env.SSL_CERT_FILENAME}`);
    console.log(`   Private Key: ${process.env.SSL_KEY_FILENAME}`);
    console.log(`   Full Certificate Path: ${certPath}`);
    console.log(`   Full Key Path: ${keyPath}`);
  }
  // Option 3: Default fallback (for backward compatibility)
  else {
    certPath = path.join(__dirname, 'ssl', 'cert.pem');
    keyPath = path.join(__dirname, 'ssl', 'key.pem');
    console.log('📋 Using default SSL certificate paths (no environment variables set):');
    console.log(`   Certificate: ${certPath}`);
    console.log(`   Private Key: ${keyPath}`);
    console.log('💡 Tip: Set SSL_CERT_PATH and SSL_KEY_PATH (or SSL_CERT_FILENAME and SSL_KEY_FILENAME) in your .env file');
  }

  try {
    // Check if certificate files exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      };
      server = https.createServer(options, app);
      console.log('✅ HTTPS server initialized with SSL certificates');
    } else {
      console.warn(`⚠️  SSL certificates not found at:`);
      console.warn(`   Certificate: ${certPath}`);
      console.warn(`   Private Key: ${keyPath}`);
      console.warn('⚠️  Falling back to HTTP. To use HTTPS, please provide SSL certificates.');
      console.warn('⚠️  Set SSL_CERT_PATH and SSL_KEY_PATH in your .env file, or');
      console.warn('⚠️  For development, generate self-signed certificates using:');
      console.warn('⚠️  openssl req -x509 -newkey rsa:4096 -nodes -keyout ssl/key.pem -out ssl/cert.pem -days 365');
      server = http.createServer(app);
    }
  } catch (error) {
    console.error('❌ Error loading SSL certificates:', error);
    console.warn('⚠️  Falling back to HTTP server');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
  console.log('ℹ️  HTTP server initialized (HTTPS disabled via USE_HTTPS=false)');
}

// Determine protocol based on server type
const protocol = server instanceof https.Server ? 'https' : 'http';
const defaultFrontendUrl = process.env.FRONTEND_URL || `${protocol}://localhost:3000`;

// Build allowed origins list
const allowedOrigins = [
  defaultFrontendUrl,
  defaultFrontendUrl.replace(/^https?/, 'http'), // Also allow HTTP version if HTTPS is used
  defaultFrontendUrl.replace(/^https?/, 'https'), // Also allow HTTPS version if HTTP is used
  // Add any additional origins from environment variable (comma-separated)
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : [])
];

import authRouter from './Routers/Auth';
import { authMiddleware, adminMiddleware } from './middleware/authMiddleware';

// ... (other imports)

// CORS middleware - must be before routes
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, or curl)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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
app.use((req: Request, res: Response, next) => {
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

// Configure session (removed as we use JWT)
// app.use(sessionConfig);

app.use('/imgs', express.static('imgs'));
app.use('/audio', express.static('audio'));
app.use('/video', express.static('video'));
app.use('/docs', express.static('docs'));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Auth Routes
app.use('/auth', authRouter);

// Temporary public debug endpoint
if ((process.env.DEBUG_API_PUBLIC || 'false').toLowerCase() === 'true') {
  app.get('/ChatPublic/api/GetChatsPage', async (req: Request, res: Response) => {
    try {
      const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
      const limit = Math.max(parseInt((req.query.limit as string) || '25', 10), 1);
      const offset = (page - 1) * limit;
      const status = (req.query.status as string) || null;

      let baseSql = 'SELECT * FROM chatsInfo';
      const params: any[] = [];
      if (status) {
        baseSql += ' WHERE status = $1';
        params.push(status);
      }
      baseSql += ' ORDER BY "lastMessageTime" DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);

      const result = await (global as any).pool.query(baseSql, params);
      res.json({ page, limit, chats: result.rows });
    } catch (error) {
      console.error('Error in public GetChatsPage:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
}

// Protect API routes with JWT Middleware
app.use('/Chat', authMiddleware, chatRouter);
app.use('/api/users', adminMiddleware, userManagementRouter);
app.use('', reportsRouter); // Reports accessible without protection for now
app.use('', dashboardRouter); // Dashboard accessible without protection for now

app.post('/webhook', async (req: Request, res: Response) => {
  var data = new processWhatsAppHooks(<any>req.body);
  console.log('✅ Webhook received:', req.body);
  res.status(200).json({ message: 'Webhook received successfully' });
})

// Initialize Socket.IO
const io = initializeSocketIO(server);

// Initialize database and start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  const serverType = server instanceof https.Server ? 'HTTPS' : 'HTTP';
  console.log(`🚀 ${serverType} Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${protocol}://localhost:${PORT}`);
})