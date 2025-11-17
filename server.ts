import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRouter from './Routers/Chat';  
import userManagementRouter from './Routers/UserManagement';
import reportsRouter from './Routers/Reports';
import dashboardRouter from './Routers/Dashboard';
import processWhatsAppHooks from './processWhatsAppHooks';
import { initializeSocketIO } from './SocketEmits';
import keycloak, { sessionConfig } from './keycloak-config';
dotenv.config();

const app = express(); 
const server = http.createServer(app);

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:8080' // Allow Keycloak server
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Use session middleware
app.use(sessionConfig);

// Use Keycloak middleware with custom error handling
app.use(keycloak.middleware({
  logout: '/logout',
  admin: '/'
}));

app.use('/imgs', express.static('imgs'));
app.use('/audio', express.static('Audio'));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));


// Custom authentication callback handler
app.get('/auth/callback', (req, res) => {
  // Handle Keycloak callback and redirect back to frontend
  const redirectUri = `${process.env.FRONTEND_URL || 'http://localhost:3000'}`;
  res.redirect(redirectUri);
});

// Temporary public debug endpoint (bypasses Keycloak) for local development
// Only enable when explicitly allowed via env DEBUG_API_PUBLIC=true to avoid exposing data in production.
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

// Protect API routes with Keycloak
app.use('/Chat', keycloak.protect(), chatRouter);
app.use('/api/users', keycloak.protect(), userManagementRouter);
app.use('', reportsRouter); // Reports accessible without protection for now
app.use('', dashboardRouter); // Dashboard accessible without protection for now

app.post('/webhook',async(req:Request,res:Response)=>{
     var data= new processWhatsAppHooks(<any>req.body);
      console.log('✅ Webhook received:',req.body);
      res.status(200).json({ message: 'Webhook received successfully' });
})

// Initialize Socket.IO
const io = initializeSocketIO(server);

// Initialize database and start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
})