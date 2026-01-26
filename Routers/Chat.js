"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const MessageSender_1 = __importDefault(require("./MessageSender"));
const SocketEmits_1 = require("../SocketEmits");
const timezone_1 = require("../utils/timezone");
const prismaClient_1 = __importDefault(require("../prismaClient"));
const router = (0, express_1.Router)();
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        // Use absolute paths to ensure consistency regardless of CWD
        const baseDir = path_1.default.join(__dirname, '..');
        let targetFolder = 'imgs';
        if (file.mimetype.startsWith('image/')) {
            targetFolder = 'imgs';
        }
        else if (file.mimetype.startsWith('video/')) {
            targetFolder = 'video';
        }
        else if (file.mimetype.startsWith('audio/')) {
            targetFolder = 'audio';
        }
        const destPath = path_1.default.join(baseDir, targetFolder);
        // Ensure directory exists
        if (!fs_1.default.existsSync(destPath)) {
            fs_1.default.mkdirSync(destPath, { recursive: true });
        }
        cb(null, destPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '_' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow images, videos, and audio files
        if (file.mimetype.startsWith('image/') ||
            file.mimetype.startsWith('video/') ||
            file.mimetype.startsWith('audio/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image, video, and audio files are allowed!'));
        }
    }
});
router.get('/api/GetContacts', async (req, res) => {
    try {
        const contacts = await prismaClient_1.default.cleaned_contacts.findMany();
        res.json(contacts);
    }
    catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/api/GetCleanedContacts', async (req, res) => {
    try {
        const contacts = await prismaClient_1.default.cleaned_contacts.findMany();
        res.json(contacts);
    }
    catch (error) {
        console.error('Error fetching cleaned contacts:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/api/GetChats', async (req, res) => {
    try {
        const chats = await prismaClient_1.default.$queryRawUnsafe('SELECT ci.*, c."closeReason" as reason FROM chatsInfo ci LEFT JOIN chats c ON ci.id = c.id ORDER BY ci."lastMessageTime" DESC');
        res.json(chats);
    }
    catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Paginated chats endpoint: supports ?page=1&limit=20&status=open
router.get('/api/GetChatsPage', async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page || '1', 10), 1);
        const limit = Math.max(parseInt(req.query.limit || '25', 10), 1);
        const offset = (page - 1) * limit;
        const status = req.query.status || null;
        let baseSql = 'SELECT ci.*, c."closeReason" as reason FROM chatsInfo ci LEFT JOIN chats c ON ci.id = c.id';
        const params = [];
        if (status) {
            baseSql += ' WHERE ci.status = $1';
            params.push(status);
        }
        baseSql += ' ORDER BY ci."lastMessageTime" DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(limit, offset);
        const chats = await prismaClient_1.default.$queryRawUnsafe(baseSql, ...params);
        res.json({ page, limit, chats });
    }
    catch (error) {
        console.error('Error fetching paginated chats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Small helper to call Wuz API endpoints; assumes WUZAPI and WUZAPI_Token env vars
async function callWuz(path, method = 'GET', body) {
    const base = (process.env.WUZAPI || '').replace(/\/$/, '');
    if (!base)
        throw new Error('WUZAPI env not configured');
    const url = `${base}/${path.replace(/^\//, '')}`;
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WUZAPI_Token)
        headers.token = process.env.WUZAPI_Token;
    const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data };
}
// Expose Wuz profile and presence endpoints
router.get('/api/GetWuzProfile/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await callWuz(`contact/profile?phone=${encodeURIComponent(phone)}`);
        if (!result.ok)
            return res.status(502).json({ error: 'Wuz API error', details: result });
        res.json(result.data);
    }
    catch (error) {
        console.error('Error fetching Wuz profile:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/api/GetWuzPresence/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await callWuz(`contact/presence?phone=${encodeURIComponent(phone)}`);
        if (!result.ok)
            return res.status(502).json({ error: 'Wuz API error', details: result });
        res.json(result.data);
    }
    catch (error) {
        console.error('Error fetching Wuz presence:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Refresh chat avatar from WuzAPI
router.post('/api/RefreshChatAvatar', async (req, res) => {
    try {
        const { chatId, phone } = req.body;
        if (!chatId || !phone) {
            return res.status(400).json({ error: 'chatId and phone are required' });
        }
        const apiResult = await callWuz('user/avatar', 'POST', {
            Phone: phone,
            Preview: true
        });
        if (!apiResult.ok) {
            return res.status(502).json({ error: 'Failed to fetch avatar from WuzAPI', details: apiResult });
        }
        const avatarUrl = apiResult.data?.data?.url;
        console.log(apiResult.data.data.url);
        if (avatarUrl) {
            // Update database
            await prismaClient_1.default.chats.update({
                where: { id: chatId },
                data: { avatar: avatarUrl }
            });
            res.json({ success: true, avatar: avatarUrl });
        }
        else {
            res.json({ success: false, message: 'No avatar returned' });
        }
    }
    catch (error) {
        console.error('Error refreshing chat avatar:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// // Update contact tags
// router.put('/api/UpdateContactTags/:contactId', async (req: Request, res: Response) => {
//   try {
//     const { contactId } = req.params;
//     const { tags } = req.body;
//     const updatedContact = await prisma.cleaned_contacts.update({
//       where: { c: contactId },
//       data: {
//         tags: tags // Prisma handles Json objects
//       }
//     });
//     res.json(updatedContact);
//   } catch (error) {
//     console.error('Error updating contact tags:', error);
//     res.status(500).json({ error: 'Internal Server Error' });
//   }
// });
router.get('/api/GetMessages/:id', async (req, res) => {
    const { id } = req.params; // ✅ Get route parameter
    const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
    const before = req.query.before || null;
    try {
        let messages;
        if (id) {
            if (before) {
                // Get messages before the specified timestamp (for pagination) with pushName from chats
                messages = await prismaClient_1.default.$queryRawUnsafe(`SELECT m.*, c.pushname as "pushName",
          CASE WHEN m."replyToMessageId" IS NOT NULL THEN 
            json_build_object(
              'id', reply.id,
              'message', reply.message,
              'isFromMe', reply."isFromMe",
              'pushName', reply."pushname",
              'contactId', reply."contactId",
              'mediaPath', reply."mediaPath"
            )
          ELSE NULL END as "replyToMessage",
          (
            SELECT json_agg(json_build_object(
              'emoji', mr.emoji,
              'participant', mr.participant,
              'contactName', COALESCE(cc.first_name, cc.full_name, cc.push_name, cc.business_name, mr.participant)
            ))
            FROM message_reactions mr
            LEFT JOIN cleaned_contacts cc ON SPLIT_PART(mr.participant, '@', 1) = cc.phone
            WHERE mr."messageId" = m.id
          ) as reactions
                   FROM messages m 
                   LEFT JOIN chats c ON m."chatId" = c.id
                   LEFT JOIN messages reply ON reply.id=m."replyToMessageId"
                   WHERE m."chatId" = $1 AND m."timeStamp" < $2::timestamp 
                   ORDER BY m."timeStamp" DESC LIMIT $3`, id, new Date(before).toISOString(), limit);
            }
            else {
                // Get last N messages (initial load) with pushName from chats
                messages = await prismaClient_1.default.$queryRawUnsafe(`SELECT m.*, c.pushname as "pushName",
          CASE WHEN m."replyToMessageId" IS NOT NULL THEN 
            json_build_object(
              'id', reply.id,
              'message', reply.message,
              'isFromMe', reply."isFromMe",
              'pushName', reply."pushname",
              'contactId', reply."contactId",
              'mediaPath', reply."mediaPath"
            )
          ELSE NULL END as "replyToMessage",
          (
            SELECT json_agg(json_build_object(
              'emoji', mr.emoji,
              'participant', mr.participant,
              'contactName', COALESCE(cc.first_name, cc.full_name, cc.push_name, cc.business_name, mr.participant)
            ))
            FROM message_reactions mr
            LEFT JOIN cleaned_contacts cc ON SPLIT_PART(mr.participant, '@', 1) = cc.phone
            WHERE mr."messageId" = m.id
          ) as reactions
                   FROM messages m 
                   LEFT JOIN chats c ON m."chatId" = c.id 
                   LEFT JOIN messages reply ON reply.id=m."replyToMessageId"
                   WHERE m."chatId" = $1 
                   ORDER BY m."timeStamp" DESC LIMIT $2`, id, limit);
            }
        }
        else {
            messages = await prismaClient_1.default.$queryRawUnsafe(`
              SELECT m.*, c.pushname as "pushName",
              CASE WHEN m."replyToMessageId" IS NOT NULL THEN 
                json_build_object(
                  'id', reply.id,
                  'message', reply.message,
                  'isFromMe', reply."isFromMe",
                  'pushName', reply."pushname",
                  'contactId', reply."contactId",
                  'mediaPath', reply."mediaPath"
                )
              ELSE NULL END as "replyToMessage"
              FROM messages m 
              LEFT JOIN chats c ON m."chatId" = c.id
              LEFT JOIN messages reply ON reply.id=m."replyToMessageId"
          `);
        }
        res.json({ messages: messages.reverse() }); // Reverse to show oldest first
    }
    catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Media sending routes
router.post('/api/sendImage', upload.single('image'), async (req, res) => {
    try {
        const messageSender = await (0, MessageSender_1.default)();
        const { phone, message, replyToId } = req.body;
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
            phone: phone,
            replyToMessageId: replyToId
        };
        const result = await messageSender.sendImage(chatMessage, req.file);
        res.json(result);
    }
    catch (error) {
        console.error('Error sending image:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/api/sendVideo', upload.single('video'), async (req, res) => {
    try {
        const messageSender = await (0, MessageSender_1.default)();
        const { phone, message, replyToId } = req.body;
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
            phone: phone,
            replyToMessageId: replyToId
        };
        const result = await messageSender.sendVideo(chatMessage, req.file);
        res.json(result);
    }
    catch (error) {
        console.error('Error sending video:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/api/sendAudio', upload.single('audio'), async (req, res) => {
    try {
        const messageSender = await (0, MessageSender_1.default)();
        const { phone, audioData, mimeType = 'audio/ogg', seconds, waveform, id, replyToId } = req.body;
        // Handle both file upload and base64 data
        let audioFile;
        if (req.file) {
            // File upload method
            console.log(`File upload method - File path: ${req.file.path}, Size: ${req.file.size}`);
            audioFile = req.file;
        }
        else if (audioData) {
            // Base64 data method (convert to OGG format)
            console.log(`Base64 data method - Audio data length: ${audioData.length}`);
            const audioBuffer = Buffer.from(audioData, 'base64');
            console.log(`Audio buffer size: ${audioBuffer.length} bytes`);
            if (audioBuffer.length === 0) {
                return res.status(400).json({ error: 'Audio data is empty or invalid' });
            }
            const filename = `audio_${Date.now()}.ogg`;
            const tempPath = path_1.default.join('Audio', filename);
            // Ensure Audio directory exists
            const audioDir = path_1.default.dirname(tempPath);
            if (!fs_1.default.existsSync(audioDir)) {
                fs_1.default.mkdirSync(audioDir, { recursive: true });
            }
            // Write as OGG file regardless of input format
            fs_1.default.writeFileSync(tempPath, audioBuffer);
            console.log(`Audio file written to: ${tempPath}, Size: ${audioBuffer.length} bytes`);
            audioFile = {
                path: tempPath,
                filename: filename,
                mimetype: 'audio/ogg' // Always use OGG format
            };
        }
        else {
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
            waveform: typeof waveform === 'string' ? JSON.parse(waveform) : (Array.isArray(waveform) ? waveform : []),
            replyToMessageId: replyToId
        };
        const result = await messageSender.sendAudio(chatMessage, audioFile);
        // Clean up temporary file if created from base64
        if (audioData && audioFile.path) {
            try {
                if (fs_1.default.existsSync(audioFile.path)) {
                    fs_1.default.unlinkSync(audioFile.path);
                }
            }
            catch (error) {
                console.error('Error cleaning up temp audio file:', error);
            }
        }
        res.json(result);
    }
    catch (error) {
        console.error('Error sending audio:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Tag management routes
// Get all tags from tages table
router.get('/api/GetTags', async (req, res) => {
    try {
        const tags = await prismaClient_1.default.tags.findMany();
        // Convert BigInt to string for JSON serialization
        const serializedTags = tags.map(tag => ({
            ...tag,
            tagId: tag.tagId.toString()
        }));
        res.json(serializedTags);
    }
    catch (error) {
        console.error('Error fetching tags:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Create a new tag in tages table
router.post('/api/CreateTag', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Tag name is required' });
        }
        // Check if tag already exists
        const existingTag = await prismaClient_1.default.tags.findFirst({
            where: { tagName: name.trim() }
        });
        if (existingTag) {
            return res.status(409).json({ error: 'Tag with this name already exists' });
        }
        // Insert new tag
        const newTag = await prismaClient_1.default.tags.create({
            data: { tagName: name.trim() }
        });
        res.status(201).json({
            ...newTag,
            tagId: newTag.tagId.toString()
        });
    }
    catch (error) {
        console.error('Error creating tag:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Delete a tag from tages table
router.delete('/api/DeleteTag/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedTag = await prismaClient_1.default.tags.delete({
            where: { tagId: BigInt(id) }
        });
        res.json({
            message: 'Tag deleted successfully',
            tag: {
                ...deletedTag,
                tagId: deletedTag.tagId.toString()
            }
        });
    }
    catch (error) {
        console.error('Error deleting tag:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Chat tag management routes
// Assign a tag to a chat
router.post('/api/AssignTagToChat', async (req, res) => {
    try {
        const { chatId, tagId, createdBy } = req.body;
        if (!chatId || !tagId || !createdBy) {
            return res.status(400).json({ error: 'chatId, tagId, and createdBy are required' });
        }
        const existingAssignment = await prismaClient_1.default.chatTags.findFirst({
            where: {
                tagId: BigInt(tagId),
                chatId: chatId
            }
        });
        if (existingAssignment) {
            return res.status(409).json({ error: 'Tag already assigned to this chat' });
        }
        // Insert new chat tag assignment
        const newAssignment = await prismaClient_1.default.chatTags.create({
            data: {
                tagId: BigInt(tagId),
                chatId: chatId,
                createdBy: createdBy,
                creationDate: (0, timezone_1.adjustToConfiguredTimezone)(new Date())
            }
        });
        res.status(201).json({
            ...newAssignment,
            tagId: newAssignment.tagId.toString(),
            chatTagId: newAssignment.chatTagId.toString()
        });
    }
    catch (error) {
        console.error('Error assigning tag to chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Remove a tag from a chat
router.delete('/api/RemoveTagFromChat/:chatId/:tagId', async (req, res) => {
    try {
        const { chatId, tagId } = req.params;
        await prismaClient_1.default.chatTags.deleteMany({
            where: {
                chatId: chatId,
                tagId: BigInt(tagId)
            }
        });
        res.json({ message: 'Tag removed from chat successfully' });
    }
    catch (error) {
        console.error('Error removing tag from chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get all tags assigned to a specific chat
router.get('/api/GetChatTags/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const tags = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT t.tagId, t.tagName, ct.chatTagId, ct.creationDate, ct.createdBy
      FROM "chatTags" ct
      JOIN tags t ON ct.tagId = t.tagId
      WHERE ct.chatId = $1
      ORDER BY ct.creationDate DESC
    `, chatId);
        // Convert BigInt to string
        const result = tags.map(tag => ({
            ...tag,
            tagId: tag.tagId?.toString(),
            chatTagId: tag.chatTagId?.toString()
        }));
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching chat tags:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get all chats with their assigned tags
router.get('/api/GetChatsWithTags', async (req, res) => {
    try {
        const chatsWithTags = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT * FROM chatsInfo
      ORDER BY "lastMessageTime" DESC
    `);
        res.json(chatsWithTags);
    }
    catch (error) {
        console.error('Error fetching chats with tags:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Forward message endpoint
router.post('/api/ForwardMessage', async (req, res) => {
    try {
        const { originalMessage, targetChatId, senderId } = req.body;
        if (!originalMessage || !targetChatId || !senderId) {
            return res.status(400).json({ error: 'originalMessage, targetChatId, and userId are required' });
        }
        // Build forwarded message payload
        const forwardedMessage = {
            id: Date.now().toString(),
            chatId: targetChatId,
            message: originalMessage.message,
            timestamp: (0, timezone_1.adjustToConfiguredTimezone)(new Date()),
            ContactId: originalMessage.senderId,
            messageType: originalMessage.messageType || 'text',
            isEdit: false,
            isRead: false,
            isDelivered: false,
            isFromMe: true,
            phone: originalMessage.phone
        };
        // Use the centralized MessageSender to actually send the forwarded message
        const messageSender = await (0, MessageSender_1.default)();
        let sendResult = { success: false, error: 'Unsupported message type' };
        if ((forwardedMessage.messageType || 'text') === 'text') {
            sendResult = await messageSender.sendMessage(forwardedMessage);
        }
        else if (forwardedMessage.messageType === 'image' && originalMessage.filePath) {
            // If original message had a file, try to use it
            const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'image.jpg' };
            sendResult = await messageSender.sendImage(forwardedMessage, mockFile);
        }
        else if (forwardedMessage.messageType === 'video' && originalMessage.filePath) {
            const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'video.mp4' };
            sendResult = await messageSender.sendVideo(forwardedMessage, mockFile);
        }
        else if (forwardedMessage.messageType === 'audio' && originalMessage.filePath) {
            const mockFile = { path: originalMessage.filePath, filename: originalMessage.fileName || 'audio.webm' };
            sendResult = await messageSender.sendAudio(forwardedMessage, mockFile);
        }
        else {
            // Fallback to sending text
            sendResult = await messageSender.sendMessage(forwardedMessage);
        }
        if (!sendResult || !sendResult.success) {
            return res.status(500).json({ success: false, error: sendResult?.error || 'Failed to forward message' });
        }
        // Return the sender's result (it already persists and emits)
        res.status(201).json({ success: true, forwarded: sendResult });
    }
    catch (error) {
        console.error('Error forwarding message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Archive chat endpoint
router.post('/api/ArchiveChat', async (req, res) => {
    try {
        const { chatId, userId } = req.body;
        if (!chatId || !userId) {
            return res.status(400).json({ error: 'chatId and userId are required' });
        }
        // Update chat table
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { isarchived: true }
        });
        res.json({ success: true, message: 'Chat archived successfully' });
    }
    catch (error) {
        console.error('Error archiving chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Unarchive chat endpoint
router.post('/api/UnarchiveChat', async (req, res) => {
    try {
        const { chatId, userId } = req.body;
        if (!chatId || !userId) {
            return res.status(400).json({ error: 'chatId and userId are required' });
        }
        // Update chat table
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { isarchived: false }
        });
        res.json({ success: true, message: 'Chat unarchived successfully' });
    }
    catch (error) {
        console.error('Error unarchiving chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get archived chats endpoint
router.get('/api/GetArchivedChats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const chats = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT *
      FROM chatsInfo 
      WHERE isArchived = TRUE
    `);
        res.json(chats);
    }
    catch (error) {
        console.error('Error fetching archived chats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Assign chat to user endpoint
router.post('/api/AssignChat', async (req, res) => {
    try {
        const { chatId, assignedTo, assignedBy } = req.body;
        if (!chatId || !assignedTo || !assignedBy) {
            return res.status(400).json({ error: 'chatId, assignedTo, and assignedBy are required' });
        }
        const assignedAt = (0, timezone_1.adjustToConfiguredTimezone)(new Date());
        // Assign the chat
        await prismaClient_1.default.chatAssignmentDetail.upsert({
            where: {
                chatId_assignedTo: {
                    chatId,
                    assignedTo
                }
            },
            update: {
                assignedBy,
                assignedAt
            },
            create: {
                chatId,
                assignedTo,
                assignedBy,
                assignedAt
            }
        });
        // Update chat table
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { assignedTo }
        });
        res.json({ success: true, message: 'Chat assigned successfully' });
    }
    catch (error) {
        console.error('Error assigning chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get assigned chats endpoint
router.get('/api/GetAssignedChats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const chats = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT c.*, ac."assignedAt", ac."assignedBy"
      FROM chatsInfo c
      JOIN "chatAssignmentDetail" ac ON c.Id = ac."chatId"
      WHERE ac."assignedTo" = $1
      ORDER BY ac."assignedAt" DESC
    `, userId);
        res.json(chats);
    }
    catch (error) {
        console.error('Error fetching assigned chats:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Mute chat endpoint
router.post('/api/MuteChat', async (req, res) => {
    try {
        const { chatId, userId } = req.body;
        if (!chatId || !userId) {
            return res.status(400).json({ error: 'chatId and userId are required' });
        }
        // Mute the chat using raw query for ON CONFLICT (muted_chats table not in Prisma schema?)
        // Wait, let me check if muted_chats is in schema.prisma
        await prismaClient_1.default.$executeRawUnsafe(`
      INSERT INTO muted_chats ("chatId", mutedBy) 
      VALUES ($1, $2) 
      ON CONFLICT (chatId, mutedBy) DO NOTHING
    `, chatId, userId);
        // Update chat table
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { ismuted: true }
        });
        res.json({ success: true, message: 'Chat muted successfully' });
    }
    catch (error) {
        console.error('Error muting chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Unmute chat endpoint
router.post('/api/UnmuteChat', async (req, res) => {
    try {
        const { chatId, userId } = req.body;
        if (!chatId || !userId) {
            return res.status(400).json({ error: 'chatId and userId are required' });
        }
        // Remove from muted chats
        await prismaClient_1.default.$executeRawUnsafe(`
      DELETE FROM muted_chats WHERE "chatId" = $1 AND mutedBy = $2
    `, chatId, userId);
        // Update chat table
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { ismuted: false }
        });
        res.json({ success: true, message: 'Chat unmuted successfully' });
    }
    catch (error) {
        console.error('Error unmuting chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Delete message endpoint
router.delete('/api/DeleteMessage/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        await prismaClient_1.default.messages.delete({
            where: { id: messageId }
        });
        res.json({ success: true, message: 'Message deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Message templates endpoints
router.get('/api/GetMessageTemplates', async (req, res) => {
    try {
        const templates = await prismaClient_1.default.messageTemplates.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(templates);
    }
    catch (error) {
        console.error('Error fetching message templates:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Accept an optional uploaded image for templates (drag & drop)
router.post('/api/CreateMessageTemplate', upload.single('image'), async (req, res) => {
    try {
        const { name, content, createdBy } = req.body;
        let imagePath = null;
        let mediaPath = null;
        if (!name || !content || !createdBy) {
            return res.status(400).json({ error: 'name, content, and createdBy are required' });
        }
        if (req.file) {
            imagePath = req.file.path;
            mediaPath = req.file.path; // Use mediaPath going forward
        }
        const template = await prismaClient_1.default.messageTemplates.create({
            data: {
                name,
                content,
                createdBy,
                imagePath,
                mediaPath
            }
        });
        res.status(201).json(template);
    }
    catch (error) {
        console.error('Error creating message template:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.put('/api/UpdateMessageTemplate/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, content } = req.body;
        if (!name || !content) {
            return res.status(400).json({ error: 'name and content are required' });
        }
        const template = await prismaClient_1.default.messageTemplates.update({
            where: { id: parseInt(id, 10) },
            data: {
                name,
                content,
                updatedat: new Date()
            }
        });
        res.json(template);
    }
    catch (error) {
        console.error('Error updating message template:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/api/DeleteMessageTemplate/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prismaClient_1.default.messageTemplates.delete({
            where: { id: parseInt(id, 10) }
        });
        res.json({ success: true, message: 'Template deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting message template:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Create new chat endpoint
router.post('/api/CreateNewChat', async (req, res) => {
    try {
        const { phoneNumber, contactName, userId } = req.body;
        if (!phoneNumber || !userId) {
            return res.status(400).json({ error: 'phoneNumber and userId are required' });
        }
        // Clean phone number (remove non-digits)
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        // Check if chat already exists
        const existingChat = await prismaClient_1.default.chats.findFirst({
            where: {
                OR: [
                    { id: cleanPhone },
                    { contactId: cleanPhone } // Adjust based on how phone is stored
                ]
            }
        });
        if (existingChat) {
            return res.status(409).json({
                error: 'Chat already exists',
                existingChat
            });
        }
        // Create new chat
        const chatId = cleanPhone;
        const displayName = contactName || `+${cleanPhone}`;
        const newChat = await prismaClient_1.default.chats.create({
            data: {
                id: chatId,
                pushname: displayName,
                contactId: cleanPhone,
                lastMessage: '',
                lastMessageTime: new Date(),
                unReadCount: 0,
                isOnline: false,
                isarchived: false,
                ismuted: false,
                assignedTo: null,
                userId: userId
            }
        });
        // Try to fetch avatar/profile from Wuz API and store in Contacts.Image if available
        try {
            const profile = await callWuz(`contact/profile?phone=${encodeURIComponent(cleanPhone)}`);
            if (profile && profile.ok && profile.data) {
                const avatarUrl = profile.data.avatar || profile.data.image || profile.data.profilePic;
                if (avatarUrl) {
                    await prismaClient_1.default.contacts.updateMany({
                        where: { phone: cleanPhone },
                        data: { image: avatarUrl }
                    });
                }
            }
        }
        catch (wErr) {
            const m = wErr?.message || wErr;
            console.warn('Wuz profile fetch failed (non-fatal):', m);
        }
        // Also create contact if it doesn't exist
        const existingContact = await prismaClient_1.default.contacts.findFirst({
            where: { phone: cleanPhone }
        });
        if (!existingContact) {
            await prismaClient_1.default.contacts.create({
                data: {
                    id: cleanPhone,
                    name: displayName,
                    phone: cleanPhone,
                    email: '',
                    address: '',
                    state: '',
                    zip: '',
                    country: '',
                    lastMessage: '',
                    lastMessageTime: new Date(),
                    unReadCount: 0,
                    isTyping: false,
                    isOnline: false,
                    image: '',
                    lastSeen: new Date(),
                    chatId: chatId
                }
            });
        }
        res.status(201).json({
            success: true,
            message: 'Chat created successfully',
            chat: newChat
        });
    }
    catch (error) {
        console.error('Error creating new chat:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Edit message endpoint
router.put('/api/EditMessage/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { newMessage } = req.body;
        if (!newMessage) {
            return res.status(400).json({ error: 'newMessage is required' });
        }
        const updatedMessage = await prismaClient_1.default.messages.update({
            where: { id: messageId },
            data: {
                message: newMessage,
                isEdit: true
                // Note: editedAt might not be in schema, if not, skip it or add it
            }
        });
        res.json({ success: true, message: 'Message edited successfully', editedMessage: updatedMessage });
    }
    catch (error) {
        console.error('Error editing message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Add note to message endpoint
router.put('/api/AddNoteToMessage/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { note } = req.body;
        if (!note) {
            return res.status(400).json({ error: 'note is required' });
        }
        const updatedMessage = await prismaClient_1.default.messages.update({
            where: { id: messageId },
            data: { note }
        });
        res.json({ success: true, message: 'Note added successfully', updatedMessage });
    }
    catch (error) {
        console.error('Error adding note to message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Pin message endpoint
router.put('/api/PinMessage/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { isPinned } = req.body;
        const updatedMessage = await prismaClient_1.default.messages.update({
            where: { id: messageId },
            data: { isPinned }
        });
        res.json({ success: true, message: `Message ${isPinned ? 'pinned' : 'unpinned'} successfully`, updatedMessage });
    }
    catch (error) {
        console.error('Error pinning/unpinning message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Reply to message endpoint
router.post('/api/ReplyToMessage', async (req, res) => {
    try {
        const { originalMessageId, replyMessage, userId, chatId } = req.body;
        if (!originalMessageId || !replyMessage || !userId || !chatId) {
            return res.status(400).json({ error: 'originalMessageId, replyMessage, userId, and chatId are required' });
        }
        const timestamp = new Date();
        // Insert reply message into database
        const newReply = await prismaClient_1.default.messages.create({
            data: {
                id: Date.now().toString(),
                chatId: chatId,
                message: replyMessage,
                timeStamp: timestamp,
                contactId: userId,
                messageType: 'text',
                isEdit: false,
                isRead: false,
                isDelivered: false,
                isFromMe: true,
                replyToMessageId: originalMessageId,
                userId: userId
            }
        });
        // Update chat's last message
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: {
                lastMessage: replyMessage,
                lastMessageTime: timestamp
            }
        });
        res.status(201).json({
            success: true,
            message: 'Reply sent successfully',
            replyMessage: newReply
        });
    }
    catch (error) {
        console.error('Error replying to message:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Add reaction to message endpoint
router.post('/api/AddReaction', async (req, res) => {
    try {
        const { messageId, userId, emoji, phone } = req.body;
        if (!messageId || !userId || !emoji) {
            return res.status(400).json({ error: 'messageId, userId, and emoji are required' });
        }
        // Check if user already reacted with this emoji
        const existingReaction = await prismaClient_1.default.message_reactions.findFirst({
            where: {
                messageId,
                userId,
                emoji
            }
        });
        const messageSender = await (0, MessageSender_1.default)();
        // Get message info to check if it's our own message
        const message = await prismaClient_1.default.messages.findUnique({
            where: { id: messageId },
            select: { chatId: true, isFromMe: true }
        });
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        const { chatId, isFromMe } = message;
        const targetId = phone || chatId || '';
        if (existingReaction) {
            // Remove existing reaction
            // Send removal to WhatsApp (empty string)
            await messageSender.sendReaction(targetId, messageId, "", !!isFromMe);
            await prismaClient_1.default.message_reactions.delete({
                where: { id: existingReaction.id }
            });
            // Fetch updated reactions to emit
            const updatedReactions = await prismaClient_1.default.message_reactions.findMany({
                where: { messageId }
            });
            (0, SocketEmits_1.emitReactionUpdate)(chatId || '', messageId, updatedReactions);
            res.json({ success: true, message: 'Reaction removed', action: 'removed' });
        }
        else {
            // Add new reaction
            // Send reaction to WhatsApp
            await messageSender.sendReaction(targetId, messageId, emoji, !!isFromMe);
            const reactionId = Date.now().toString();
            const newReaction = await prismaClient_1.default.message_reactions.create({
                data: {
                    id: reactionId,
                    messageId: messageId,
                    userId: userId,
                    emoji: emoji,
                    createdAt: new Date()
                }
            });
            // Fetch updated reactions to emit
            const updatedReactions = await prismaClient_1.default.message_reactions.findMany({
                where: { messageId }
            });
            (0, SocketEmits_1.emitReactionUpdate)(chatId || '', messageId, updatedReactions);
            res.status(201).json({
                success: true,
                message: 'Reaction added',
                action: 'added',
                reaction: newReaction
            });
        }
    }
    catch (error) {
        console.error('Error adding reaction:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get reactions for a message endpoint
router.get('/api/GetMessageReactions/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        const reactions = await prismaClient_1.default.message_reactions.findMany({
            where: { messageId },
            orderBy: { createdAt: 'asc' }
        });
        res.json(reactions);
    }
    catch (error) {
        console.error('Error fetching message reactions:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Remove reaction from message endpoint
router.delete('/api/RemoveReaction/:reactionId', async (req, res) => {
    // try {
    //   const { reactionId } = req.params;
    //   const result = await pool.query(`
    //     DELETE FROM message_reactions WHERE id = $1 RETURNING *
    //   `, [reactionId]);
    //   if (result.rows.length === 0) {
    //     return res.status(404).json({ error: 'Reaction not found' });
    //   }
    //   res.json({ success: true, message: 'Reaction removed successfully' });
    // } catch (error) {
    //   console.error('Error removing reaction:', error);
    //   res.status(500).json({ error: 'Internal Server Error' });
    // }
});
// Update chat status (open/closed)
router.put('/api/UpdateChatStatus/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { status, reason } = req.body;
        if (!status || !['open', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be "open" or "closed"' });
        }
        const updatedChat = await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: {
                status,
                closeReason: reason || null,
                closedAt: status === 'closed' ? new Date() : null
            }
        });
        res.json({ success: true, message: 'Chat status updated successfully', chat: updatedChat });
    }
    catch (error) {
        console.error('Error updating chat status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get chats by status
router.get('/api/GetChatsByStatus/:status', async (req, res) => {
    try {
        const { status } = req.params;
        if (!['open', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be "open" or "closed"' });
        }
        const chats = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT ci.*, c."closeReason" as reason 
      FROM chatsInfo ci 
      LEFT JOIN chats c ON ci.id = c.id
      WHERE ci.status = $1
      ORDER BY ci."lastMessageTime" DESC
    `, status);
        res.json(chats);
    }
    catch (error) {
        console.error('Error fetching chats by status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Mark chat as read (set unreadCount to 0)
router.put('/api/MarkChatAsRead/:chatId', async (req, res) => {
    try {
        const { chatId } = req.params;
        // Update unreadCount to 0
        await prismaClient_1.default.chats.update({
            where: { id: chatId },
            data: { unReadCount: 0 }
        });
        // Get the updated chat with all info
        const chatInfo = await prismaClient_1.default.$queryRawUnsafe(`
      SELECT * FROM chatsInfo WHERE id = $1
    `, chatId);
        const updatedChat = chatInfo[0];
        // Emit socket event to update all clients
        if (updatedChat) {
            (0, SocketEmits_1.emitChatUpdate)(updatedChat);
        }
        res.json({ success: true, message: 'Chat marked as read', chat: updatedChat });
    }
    catch (error) {
        console.error('Error marking chat as read:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
module.exports = router;
