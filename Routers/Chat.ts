import { Router, Request, Response } from 'express';
import pool from '../DBConnection';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import messageSenderRouter from './MessageSender';

import { emitChatUpdate } from '../SocketEmits';
import { adjustToConfiguredTimezone } from '../utils/timezone';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use existing folders based on file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, 'imgs/');
    } else if (file.mimetype.startsWith('video/')) {
      cb(null, 'Video/');
    } else if (file.mimetype.startsWith('audio/')) {
      cb(null, 'Audio/');
    } else {
      cb(null, 'imgs/'); // Default to imgs folder
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req: any, file: Express.Multer.File, cb: FileFilterCallback) => {
    // Allow images, videos, and audio files
    if (file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image, video, and audio files are allowed!'));
    }
  }
});

router.get('/api/GetContacts', async (req: Request, res: Response) => {
  try {


    const result = await pool.query("SELECT * FROM Contacts");



    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
router.get('/api/GetChats', async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM chatsInfo ORDER BY \"lastMessageTime\" DESC");
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Paginated chats endpoint: supports ?page=1&limit=20&status=open
router.get('/api/GetChatsPage', async (req: Request, res: Response) => {
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

    const result = await pool.query(baseSql, params);
    res.json({ page, limit, chats: result.rows });
  } catch (error) {
    console.error('Error fetching paginated chats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Small helper to call Wuz API endpoints; assumes WUZAPI and WUZAPI_Token env vars
async function callWuz(path: string, method = 'GET', body?: any) {
  const base = (process.env.WUZAPI || '').replace(/\/$/, '');
  if (!base) throw new Error('WUZAPI env not configured');
  const url = `${base}/${path.replace(/^\//, '')}`;
  const headers: any = { 'Content-Type': 'application/json' };
  if (process.env.WUZAPI_Token) headers.token = process.env.WUZAPI_Token;
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data };
}

// Expose Wuz profile and presence endpoints
router.get('/api/GetWuzProfile/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const result = await callWuz(`contact/profile?phone=${encodeURIComponent(phone)}`);
    if (!result.ok) return res.status(502).json({ error: 'Wuz API error', details: result });
    res.json(result.data);
  } catch (error) {
    console.error('Error fetching Wuz profile:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/api/GetWuzPresence/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const result = await callWuz(`contact/presence?phone=${encodeURIComponent(phone)}`);
    if (!result.ok) return res.status(502).json({ error: 'Wuz API error', details: result });
    res.json(result.data);
  } catch (error) {
    console.error('Error fetching Wuz presence:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update contact tags
router.put('/api/UpdateContactTags/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;
    const { tags } = req.body;

    // Ensure the tags column exists
    await pool.query(`
      ALTER TABLE Contacts 
      ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb
    `);

    // Update the contact's tags
    const result = await pool.query(
      "UPDATE Contacts SET tags = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify(tags), contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const updatedContact = {
      ...result.rows[0],
      tags: result.rows[0].tags ? JSON.parse(result.rows[0].tags) : []
    };

    res.json(updatedContact);
  } catch (error) {
    console.error('Error updating contact tags:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
router.get('/api/GetMessages/:id', async (req, res) => {
  const { id } = req.params; // ✅ Get route parameter
  const limit = Math.max(parseInt((req.query.limit as string) || '10', 10), 1);
  const before = (req.query.before as string) || null;

  try {
    let result;
    if (id) {
      if (before) {
        // Get messages before the specified timestamp (for pagination) with pushName from chats
        result = await pool.query(
          `SELECT m.*, coalesce(cleaned_contacts.full_name,first_name,push_name,business_name) as "pushName" 
                   FROM messages m 
                   LEFT JOIN chats c ON m."chatId" = c.id
                   LEFT JOIN cleaned_contacts ON cleaned_contacts.id = m."contactId" 
                   WHERE m."chatId" = $1 AND m."timeStamp" < $2 
                   ORDER BY m."timeStamp" DESC LIMIT $3`,
          [id, adjustToConfiguredTimezone(new Date(before)).toISOString(), limit]
        );
      } else {
        // Get last N messages (initial load) with pushName from chats
        result = await pool.query(
          `SELECT m.*, c.pushname as "pushName" 
                   FROM messages m 
                   LEFT JOIN chats c ON m."chatId" = c.id 
                   WHERE m."chatId" = $1 
                   ORDER BY m."timeStamp" DESC LIMIT $2`,
          [id, limit]
        );
      }
    } else {
      result = await pool.query(`
              SELECT m.*, c.pushname as "pushName" 
              FROM messages m 
              LEFT JOIN chats c ON m."chatId" = c.id
          `);
    }

    res.json({ messages: result.rows.reverse() }); // Reverse to show oldest first
  } catch (error) {
    console.error('Error fetching Chats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Media sending routes
router.post('/api/sendImage', upload.single('image'), async (req: any, res: Response) => {
  try {
    const messageSender = await messageSenderRouter();
    const { phone, message } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const chatMessage = {
      id: Date.now().toString(),
      chatId: phone,
      message: message || '',
      timestamp: new Date(),
      timeStamp: new Date(),
      ContactId: 'current_user',
      messageType: 'image',
      isEdit: false,
      isRead: false,
      isDelivered: false,
      isFromMe: true,
      phone: phone
    };

    const result = await messageSender.sendImage(chatMessage, req.file);
    res.json(result);
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/api/sendVideo', upload.single('video'), async (req: any, res: Response) => {
  try {
    const messageSender = await messageSenderRouter();
    const { phone, message } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const chatMessage = {
      id: Date.now().toString(),
      chatId: phone,
      message: message || '',
      timestamp: new Date(),
      timeStamp: new Date(),
      ContactId: 'current_user',
      messageType: 'video',
      isEdit: false,
      isRead: false,
      isDelivered: false,
      isFromMe: true,
      phone: phone
    };

    const result = await messageSender.sendVideo(chatMessage, req.file);
    res.json(result);
  } catch (error) {
    console.error('Error sending video:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/api/sendAudio', upload.single('audio'), async (req: any, res: Response) => {
  try {
    const messageSender = await messageSenderRouter();
    const { phone, audioData, mimeType = 'audio/ogg', seconds, waveform, id } = req.body;

    // Handle both file upload and base64 data
    let audioFile;
    if (req.file) {
      // File upload method
      console.log(`File upload method - File path: ${req.file.path}, Size: ${req.file.size}`);
      audioFile = req.file;
    } else if (audioData) {
      // Base64 data method (convert to OGG format)
      console.log(`Base64 data method - Audio data length: ${audioData.length}`);
      const audioBuffer = Buffer.from(audioData, 'base64');
      console.log(`Audio buffer size: ${audioBuffer.length} bytes`);

      if (audioBuffer.length === 0) {
        return res.status(400).json({ error: 'Audio data is empty or invalid' });
      }

      const filename = `audio_${Date.now()}.ogg`;
      const tempPath = path.join('Audio', filename);

      // Ensure Audio directory exists
      const audioDir = path.dirname(tempPath);
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Write as OGG file regardless of input format
      fs.writeFileSync(tempPath, audioBuffer);
      console.log(`Audio file written to: ${tempPath}, Size: ${audioBuffer.length} bytes`);

      audioFile = {
        path: tempPath,
        filename: filename,
        mimetype: 'audio/ogg' // Always use OGG format
      };
    } else {
      return res.status(400).json({ error: 'No audio file or audioData provided' });
    }

    const chatMessage = {
      id: id || Date.now().toString(),
      chatId: phone,
      message: '',
      timestamp: new Date(),
      timeStamp: new Date(),
      ContactId: 'current_user',
      messageType: 'audio',
      isEdit: false,
      isRead: false,
      isDelivered: false,
      isFromMe: true,
      phone: phone,
      seconds: seconds ? parseInt(seconds.toString()) : 0,
      waveform: typeof waveform === 'string' ? JSON.parse(waveform) : (Array.isArray(waveform) ? waveform : [])
    };

    const result = await messageSender.sendAudio(chatMessage, audioFile);

    // Clean up temporary file if created from base64
    if (audioData && audioFile.path) {
      try {
        if (fs.existsSync(audioFile.path)) {
          fs.unlinkSync(audioFile.path);
        }
      } catch (error) {
        console.error('Error cleaning up temp audio file:', error);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Error sending audio:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Tag management routes
// Get all tags from tages table
router.get('/api/GetTags', async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM tags");
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create a new tag in tages table
router.post('/api/CreateTag', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    // Check if tag already exists
    const existingTag = await pool.query("SELECT * FROM public.tags WHERE  'tagName' = $1", [name.trim()]);
    if (existingTag.rows.length > 0) {
      return res.status(409).json({ error: 'Tag with this name already exists' });
    }

    // Insert new tag
    const result = await pool.query(
      'INSERT INTO tags ("tagName") VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete a tag from tages table
router.delete('/api/DeleteTag/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM tags WHERE "tagId" = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({ message: 'Tag deleted successfully', tag: result.rows[0] });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Chat tag management routes
// Assign a tag to a chat
router.post('/api/AssignTagToChat', async (req: Request, res: Response) => {
  try {
    const { chatId, tagId, createdBy } = req.body;

    if (!chatId || !tagId || !createdBy) {
      return res.status(400).json({ error: 'chatId, tagId, and createdBy are required' });
    }


    const existingAssignment = await pool.query(
      'SELECT * FROM public."chatTags" WHERE "tagId" = $1 AND "chatId" = $2',
      [tagId, chatId]
    );

    if (existingAssignment.rows.length > 0) {
      return res.status(409).json({ error: 'Tag already assigned to this chat' });
    }

    // Insert new chat tag assignment
    const result = await pool.query(
      'INSERT INTO public."chatTags" ("tagId", "chatId", "createdBy","creationDate") VALUES ($1, $2, $3, $4) RETURNING *',
      [tagId, chatId, createdBy, adjustToConfiguredTimezone(new Date())]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error assigning tag to chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Remove a tag from a chat
router.delete('/api/RemoveTagFromChat/:chatId/:tagId', async (req: Request, res: Response) => {
  try {
    const { chatId, tagId } = req.params;

    const result = await pool.query(
      'DELETE FROM public."chatTags" WHERE "chatId" = $1 AND "tagId" = $2 RETURNING *',
      [chatId, tagId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag assignment not found' });
    }

    res.json({ message: 'Tag removed from chat successfully', chatTag: result.rows[0] });
  } catch (error) {
    console.error('Error removing tag from chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all tags assigned to a specific chat
router.get('/api/GetChatTags/:chatId', async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;

    const result = await pool.query(`
      SELECT t.id as tagId, t.tagname, ct.chatTagId, ct.creationDate, ct.createdBy
      FROM ChatTag ct
      JOIN tags t ON ct.tagId = t.id
      WHERE ct.chatId = $1
      ORDER BY ct.creationDate DESC
    `, [chatId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chat tags:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all chats with their assigned tags
router.get('/api/GetChatsWithTags', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT * FROM chatsInfo
      ORDER BY "lastMessageTime" DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chats with tags:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
// Forward message endpoint
router.post('/api/ForwardMessage', async (req: Request, res: Response) => {
  try {
    const { originalMessage, targetChatId, senderId } = req.body;

    if (!originalMessage || !targetChatId || !senderId) {
      return res.status(400).json({ error: 'originalMessage, targetChatId, and userId are required' });
    }

    // Build forwarded message payload
    const forwardedMessage: any = {
      id: Date.now().toString(),
      chatId: targetChatId,
      message: originalMessage.message,
      timestamp: adjustToConfiguredTimezone(new Date()),
      ContactId: originalMessage.senderId,
      messageType: originalMessage.messageType || 'text',
      isEdit: false,
      isRead: false,
      isDelivered: false,
      isFromMe: true,
      phone: originalMessage.phone
    };

    // Use the centralized MessageSender to actually send the forwarded message
    const messageSender = await messageSenderRouter();

    let sendResult: any = { success: false, error: 'Unsupported message type' };

    if ((forwardedMessage.messageType || 'text') === 'text') {
      sendResult = await messageSender.sendMessage(forwardedMessage);
    } else if (forwardedMessage.messageType === 'image' && originalMessage.filePath) {
      // If original message had a file, try to use it
      const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'image.jpg' };
      sendResult = await messageSender.sendImage(forwardedMessage, mockFile);
    } else if (forwardedMessage.messageType === 'video' && originalMessage.filePath) {
      const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'video.mp4' };
      sendResult = await messageSender.sendVideo(forwardedMessage, mockFile);
    } else if (forwardedMessage.messageType === 'audio' && originalMessage.filePath) {
      const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'audio.webm' };
      sendResult = await messageSender.sendAudio(forwardedMessage, mockFile);
    } else {
      // Fallback to sending text
      sendResult = await messageSender.sendMessage(forwardedMessage);
    }

    if (!sendResult || !sendResult.success) {
      return res.status(500).json({ success: false, error: sendResult?.error || 'Failed to forward message' });
    }

    // Return the sender's result (it already persists and emits)
    res.status(201).json({ success: true, forwarded: sendResult });

  } catch (error) {
    console.error('Error forwarding message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Archive chat endpoint
router.post('/api/ArchiveChat', async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }

    // Update chat table
    await pool.query(`
      UPDATE chats SET isArchived = TRUE WHERE id = $1
    `, [chatId]);

    res.json({ success: true, message: 'Chat archived successfully' });
  } catch (error) {
    console.error('Error archiving chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Unarchive chat endpoint
router.post('/api/UnarchiveChat', async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }
    // Update chat table
    await pool.query(`
      UPDATE chats SET isArchived = FALSE WHERE id = $1
    `, [chatId]);

    res.json({ success: true, message: 'Chat unarchived successfully' });
  } catch (error) {
    console.error('Error unarchiving chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get archived chats endpoint
router.get('/api/GetArchivedChats/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT *
      FROM chatsInfo 
      WHERE  isArchived = TRUE
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching archived chats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Assign chat to user endpoint
router.post('/api/AssignChat', async (req: Request, res: Response) => {
  try {
    const { chatId, assignedTo, assignedBy } = req.body;
    if (!chatId || !assignedTo || !assignedBy) {
      return res.status(400).json({ error: 'chatId, assignedTo, and assignedBy are required' });
    }

    const assignedAt = adjustToConfiguredTimezone(new Date()).toISOString(); // Use toISOString() instead of toUTCString()

    // Assign the chat
    await pool.query(`
      INSERT INTO "chatAssignmentDetail" ("chatId", "assignedTo", "assignedBy", "assignedAt") 
      VALUES ($1, $2, $3, $4) 
      ON CONFLICT ( "chatId", "assignedTo") DO UPDATE SET
        "assignedBy" = EXCLUDED."assignedBy",
        "assignedAt" = CURRENT_TIMESTAMP
    `, [chatId, assignedTo, assignedBy, assignedAt]);


    // Update chat table
    await pool.query(`
      UPDATE chats SET "assignedTo" = $1 WHERE Id = $2;
    `, [assignedTo, chatId]);

    res.json({ success: true, message: 'Chat assigned successfully' });
  } catch (error) {
    console.error('Error assigning chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get assigned chats endpoint
router.get('/api/GetAssignedChats/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT c.*, ac."assignedAt", ac."assignedBy"
      FROM chatsInfo c
      JOIN "chatAssignmentDetail" ac ON c.Id = ac."chatId"
      WHERE ac."assignedTo" = $1
      ORDER BY ac."assignedAt" DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assigned chats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Mute chat endpoint
router.post('/api/MuteChat', async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }

    // Mute the chat
    await pool.query(`
      INSERT INTO muted_chats ("chatId", mutedBy) 
      VALUES ($1, $2) 
      ON CONFLICT (chatId, mutedBy) DO NOTHING
    `, [chatId, userId]);

    // Update chat table
    await pool.query(`
      UPDATE chats SET isMuted = TRUE WHERE id = $1
    `, [chatId]);

    res.json({ success: true, message: 'Chat muted successfully' });
  } catch (error) {
    console.error('Error muting chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Unmute chat endpoint
router.post('/api/UnmuteChat', async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }

    // Remove from muted chats
    await pool.query(`
      DELETE FROM muted_chats WHERE "chatId" = $1 AND mutedBy = $2
    `, [chatId, userId]);

    // Update chat table
    await pool.query(`
      UPDATE chats SET isMuted = FALSE WHERE id = $1
    `, [chatId]);

    res.json({ success: true, message: 'Chat unmuted successfully' });
  } catch (error) {
    console.error('Error unmuting chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete message endpoint
router.delete('/api/DeleteMessage/:messageId', async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    const result = await pool.query(`
      DELETE FROM messages WHERE id = $1 RETURNING *
    `, [messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true, message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Message templates endpoints
router.get('/api/GetMessageTemplates', async (req: Request, res: Response) => {
  try {
    // Ensure table exists first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "messageTemplates" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        "createdBy" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "imagePath" TEXT,
        "mediaPath" TEXT
      )
    `);

    const result = await pool.query(`
      SELECT * FROM "messageTemplates" 
      ORDER BY "createdAt" DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching message templates:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Accept an optional uploaded image for templates (drag & drop)
router.post('/api/CreateMessageTemplate', upload.single('image'), async (req: Request, res: Response) => {
  try {
    const { name, content, createdBy } = req.body;
    let imagePath: string | null = null;
    let mediaPath: string | null = null;

    if (!name || !content || !createdBy) {
      return res.status(400).json({ error: 'name, content, and createdBy are required' });
    }

    if (req.file) {
      imagePath = req.file.path;
      mediaPath = req.file.path; // Use mediaPath going forward
    }

    // Ensure table exists first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "messageTemplates" (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        "createdBy" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "imagePath" TEXT,
        "mediaPath" TEXT
      )
    `);

    // Ensure both columns exist for backward compatibility
    await pool.query(`ALTER TABLE "messageTemplates" ADD COLUMN IF NOT EXISTS "imagePath" TEXT`);
    await pool.query(`ALTER TABLE "messageTemplates" ADD COLUMN IF NOT EXISTS "mediaPath" TEXT`);

    const result = await pool.query(`
      INSERT INTO "messageTemplates" (name, content, "createdBy", "imagePath", "mediaPath") 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *
    `, [name, content, createdBy, imagePath, mediaPath]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating message template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/api/UpdateMessageTemplate/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, content } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'name and content are required' });
    }

    const result = await pool.query(`
      UPDATE "messageTemplates" 
      SET name = $1, content = $2, "updatedAt" = CURRENT_TIMESTAMP 
      WHERE id = $3 
      RETURNING *
    `, [name, content, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating message template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/api/DeleteMessageTemplate/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM "messageTemplates" WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting message template:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Create new chat endpoint
router.post('/api/CreateNewChat', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, contactName, userId } = req.body;

    if (!phoneNumber || !userId) {
      return res.status(400).json({ error: 'phoneNumber and userId are required' });
    }

    // Clean phone number (remove non-digits)
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    // Check if chat already exists
    const existingChat = await pool.query(`
      SELECT * FROM chats WHERE id = $1 OR phone = $2
    `, [cleanPhone, cleanPhone]);

    if (existingChat.rows.length > 0) {
      return res.status(409).json({
        error: 'Chat already exists',
        existingChat: existingChat.rows[0]
      });
    }

    // Create new chat
    const chatId = cleanPhone;
    const displayName = contactName || `+${cleanPhone}`;

    const newChat = {
      id: chatId,
      name: displayName,
      phone: cleanPhone,
      contactId: cleanPhone,
      lastMessage: '',
      lastMessageTime: new Date(),
      unreadCount: 0,
      isOnline: false,
      isTyping: false,
      isArchived: false,
      isMuted: false,
      assignedTo: null,
      userId: userId
    };

    // Insert into chats table
    const result = await pool.query(`
      INSERT INTO chats (
        id, name, phone, "contactId", "lastMessage", "lastMessageTime", 
        "unReadCount", "isOnline", "isTyping", "isArchived", "isMuted", 
        "assignedTo", "userId"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      newChat.id,
      newChat.name,
      newChat.phone,
      newChat.contactId,
      newChat.lastMessage,
      newChat.lastMessageTime,
      newChat.unreadCount,
      newChat.isOnline ? 1 : 0,
      newChat.isTyping ? 1 : 0,
      newChat.isArchived ? 1 : 0,
      newChat.isMuted ? 1 : 0,
      newChat.assignedTo,
      newChat.userId
    ]);

    // Try to fetch avatar/profile from Wuz API and store in Contacts.Image if available
    try {
      const profile = await callWuz(`contact/profile?phone=${encodeURIComponent(cleanPhone)}`);
      if (profile && profile.ok && profile.data) {
        const avatarUrl = profile.data.avatar || profile.data.image || profile.data.profilePic;
        if (avatarUrl) {
          // Ensure Image column exists
          await pool.query(`ALTER TABLE IF EXISTS Contacts ADD COLUMN IF NOT EXISTS Image TEXT`);
          await pool.query(`UPDATE Contacts SET Image = $1 WHERE phone = $2`, [avatarUrl, cleanPhone]);
        }
      }
    } catch (wErr) {
      const m = (wErr as any)?.message || wErr;
      console.warn('Wuz profile fetch failed (non-fatal):', m);
    }

    // Also create contact if it doesn't exist
    const existingContact = await pool.query(`
      SELECT * FROM Contacts WHERE phone = $1
    `, [cleanPhone]);

    if (existingContact.rows.length === 0) {
      await pool.query(`
        INSERT INTO Contacts (
          id, name, phone, email, address, state, zip, country,
          "lastMessage", "lastMessageTime", "unreadCount", "isTyping",
          "isOnline", Image, "lastSeen", "ChatId"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        cleanPhone,
        displayName,
        cleanPhone,
        '',
        '',
        '',
        '',
        '',
        '',
        new Date(),
        0,
        false,
        false,
        '',
        new Date(),
        chatId
      ]);
    }

    res.status(201).json({
      success: true,
      message: 'Chat created successfully',
      chat: result.rows[0]
    });

  } catch (error) {
    console.error('Error creating new chat:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Edit message endpoint
router.put('/api/EditMessage/:messageId', async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const { newMessage } = req.body;

    if (!newMessage) {
      return res.status(400).json({ error: 'newMessage is required' });
    }

    const result = await pool.query(`
      UPDATE messages 
      SET message = $1, "isEdit" = TRUE, "editedAt" = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [newMessage, messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true, message: 'Message edited successfully', editedMessage: result.rows[0] });
  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Add note to message endpoint
router.put('/api/AddNoteToMessage/:messageId', async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const { note } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }

    const result = await pool.query(`
      UPDATE messages 
      SET note = $1
      WHERE id = $2
      RETURNING *
    `, [note, messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true, message: 'Note added successfully', updatedMessage: result.rows[0] });
  } catch (error) {
    console.error('Error adding note to message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Pin message endpoint
router.put('/api/PinMessage/:messageId', async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const { isPinned } = req.body;

    const result = await pool.query(`
      UPDATE messages 
      SET "isPinned" = $1
      WHERE id = $2
      RETURNING *
    `, [isPinned, messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ success: true, message: `Message ${isPinned ? 'pinned' : 'unpinned'} successfully`, updatedMessage: result.rows[0] });
  } catch (error) {
    console.error('Error pinning/unpinning message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Reply to message endpoint
router.post('/api/ReplyToMessage', async (req: Request, res: Response) => {
  try {
    const { originalMessageId, replyMessage, userId, chatId } = req.body;

    if (!originalMessageId || !replyMessage || !userId || !chatId) {
      return res.status(400).json({ error: 'originalMessageId, replyMessage, userId, and chatId are required' });
    }

    // Create reply message
    const replyMessageData = {
      id: Date.now().toString(),
      chatId: chatId,
      message: replyMessage,
      timestamp: new Date(),
      ContactId: userId,
      messageType: 'text',
      isEdit: false,
      isRead: false,
      isDelivered: false,
      isFromMe: true,
      phone: chatId,
      replyToMessageId: originalMessageId
    };

    // Insert reply message into database
    const result = await pool.query(`
      INSERT INTO messages (
        id, "chatId", message, timestamp, "ContactId",
        "messageType", "isEdit", "isRead", "isDelivered",
        "isFromMe", phone, "replyToMessageId"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      replyMessageData.id,
      replyMessageData.chatId,
      replyMessageData.message,
      replyMessageData.timestamp,
      replyMessageData.ContactId,
      replyMessageData.messageType,
      replyMessageData.isEdit,
      replyMessageData.isRead,
      replyMessageData.isDelivered,
      replyMessageData.isFromMe,
      replyMessageData.phone,
      replyMessageData.replyToMessageId
    ]);

    // Update chat's last message
    await pool.query(`
      UPDATE chats 
      SET "lastMessage" = $1, "lastMessageTime" = $2
      WHERE id = $3
    `, [replyMessageData.message, replyMessageData.timestamp, chatId]);

    res.status(201).json({
      success: true,
      message: 'Reply sent successfully',
      replyMessage: result.rows[0]
    });

  } catch (error) {
    console.error('Error replying to message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Add reaction to message endpoint
router.post('/api/AddReaction', async (req: Request, res: Response) => {
  try {
    const { messageId, userId, emoji } = req.body;

    if (!messageId || !userId || !emoji) {
      return res.status(400).json({ error: 'messageId, userId, and emoji are required' });
    }

    // Check if user already reacted with this emoji
    const existingReaction = await pool.query(`
      SELECT * FROM message_reactions 
      WHERE "messageId" = $1 AND "userId" = $2 AND emoji = $3
    `, [messageId, userId, emoji]);

    if (existingReaction.rows.length > 0) {
      // Remove existing reaction
      await pool.query(`
        DELETE FROM message_reactions 
        WHERE "messageId" = $1 AND "userId" = $2 AND emoji = $3
      `, [messageId, userId, emoji]);

      res.json({ success: true, message: 'Reaction removed', action: 'removed' });
    } else {
      // Add new reaction
      const reactionId = Date.now().toString();
      const result = await pool.query(`
        INSERT INTO message_reactions (id, "messageId", "userId", emoji, "createdAt")
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        RETURNING *
      `, [reactionId, messageId, userId, emoji]);

      res.status(201).json({
        success: true,
        message: 'Reaction added',
        action: 'added',
        reaction: result.rows[0]
      });
    }

  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get reactions for a message endpoint
router.get('/api/GetMessageReactions/:messageId', async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;

    const result = await pool.query(`
      SELECT * FROM message_reactions 
      WHERE "messageId" = $1 
      ORDER BY "createdAt" ASC
    `, [messageId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching message reactions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Remove reaction from message endpoint
router.delete('/api/RemoveReaction/:reactionId', async (req: Request, res: Response) => {
  try {
    const { reactionId } = req.params;

    const result = await pool.query(`
      DELETE FROM message_reactions WHERE id = $1 RETURNING *
    `, [reactionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reaction not found' });
    }

    res.json({ success: true, message: 'Reaction removed successfully' });
  } catch (error) {
    console.error('Error removing reaction:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update chat status (open/closed)
router.put('/api/UpdateChatStatus/:chatId', async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const { status, reason } = req.body;

    if (!status || !['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "open" or "closed"' });
    }

    // Update chat status and optionally store the reason
    const result = await pool.query(`
      UPDATE chats 
      SET status = $1, 
          "closeReason" = $2,
          "closedAt" = CASE WHEN $1 = 'closed' THEN NOW() ELSE NULL END
      WHERE Id = $3
      RETURNING *
    `, [status, reason || null, chatId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ success: true, message: 'Chat status updated successfully', chat: result.rows[0] });
  } catch (error) {
    console.error('Error updating chat status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get chats by status
router.get('/api/GetChatsByStatus/:status', async (req: Request, res: Response) => {
  try {
    const { status } = req.params;

    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "open" or "closed"' });
    }

    const result = await pool.query(`
      SELECT * FROM chatsInfo 
      WHERE status = $1
      ORDER BY "lastMessageTime" DESC
    `, [status]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chats by status:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Mark chat as read (set unreadCount to 0)
router.put('/api/MarkChatAsRead/:chatId', async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;

    // Update unreadCount to 0
    const result = await pool.query(`
      UPDATE chats 
      SET "unReadCount" = 0
      WHERE id = $1
      RETURNING *
    `, [chatId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Get the updated chat with all info
    const chatInfo = await pool.query(`
      SELECT * FROM chatsInfo WHERE id = $1
    `, [chatId]);

    const updatedChat = chatInfo.rows[0];

    // Emit socket event to update all clients
    if (updatedChat) {
      emitChatUpdate(updatedChat);
    }

    res.json({ success: true, message: 'Chat marked as read', chat: updatedChat });
  } catch (error) {
    console.error('Error marking chat as read:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export = router;
