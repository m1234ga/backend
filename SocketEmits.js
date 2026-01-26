"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocketIO = initializeSocketIO;
exports.emitNewMessage = emitNewMessage;
exports.emitChatUpdate = emitChatUpdate;
exports.emitChatPresence = emitChatPresence;
exports.emitMessageUpdate = emitMessageUpdate;
exports.emitReactionUpdate = emitReactionUpdate;
const socket_io_1 = require("socket.io");
const process_1 = __importDefault(require("process"));
const MessageSender_1 = __importDefault(require("./Routers/MessageSender"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const stream_1 = __importDefault(require("stream"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const timezone_1 = require("./utils/timezone");
// Set ffmpeg path
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) {
        fluent_ffmpeg_1.default.setFfmpegPath(ffmpegPath);
        console.log('✅ ffmpeg path set to:', ffmpegPath);
    }
}
catch (err) {
    console.error('⚠️ Failed to set ffmpeg path:', err);
}
const messageSender = (0, MessageSender_1.default)();
// Global io instance to be used across the application
let globalIO = null;
// Function to initialize Socket.IO
function initializeSocketIO(server) {
    // Build allowed origins list - same as server CORS configuration
    const defaultFrontendUrl = process_1.default.env.FRONTEND_URL || 'http://localhost:3000';
    const socketAllowedOrigins = [
        defaultFrontendUrl,
        defaultFrontendUrl.replace(/^https?/, 'http'), // Also allow HTTP version if HTTPS is used
        defaultFrontendUrl.replace(/^https?/, 'https'), // Also allow HTTPS version if HTTP is used
        'http://localhost:8080', // Allow Keycloak server
        'https://localhost:8080',
        process_1.default.env.KEYCLOAK_URL || 'http://localhost:8080', // Allow Keycloak server (HTTPS)
        // Production URLs
        'https://45.93.139.52:3443', // Production frontend
        'https://45.93.139.52:4443', // Production backend (for redirects)
        'https://45.93.139.52:8443', // Production Keycloak
        // Add any additional origins from environment variable (comma-separated)
        ...(process_1.default.env.ALLOWED_ORIGINS ? process_1.default.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : [])
    ];
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: socketAllowedOrigins,
            methods: ["GET", "POST", "OPTIONS"],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie', 'Set-Cookie'],
            credentials: true
        }
    });
    // Store global reference
    globalIO = io;
    // Socket.IO connection handling
    const connectedUsers = new Map();
    io.on('connection', (socket) => {
        console.log('User connected:', socket.id);
        socket.on('join', (userId) => {
            connectedUsers.set(userId, socket.id);
            socket.userId = userId;
            console.log(`User ${userId} joined`);
        });
        socket.on('join_conversation', (conversationId) => {
            socket.join(`conversation_${conversationId}`);
            console.log(`User ${socket.userId} joined conversation ${conversationId}`);
        });
        socket.on('leave_conversation', (conversationId) => {
            socket.leave(`conversation_${conversationId}`);
            console.log(`User ${socket.userId} left conversation ${conversationId}`);
        });
        socket.on('send_message', async (message) => {
            try {
                console.log('Received message via Socket.IO:', message.id, 'ReplyTo:', message.replyToMessageId);
                console.log('Received message via Socket.IO:', message);
                // Send message via WuzAPI (MessageSender handles DB insertion and socket emits)
                const currentUser = {
                    id: socket.userId || 'unknown',
                    username: socket.userId || 'unknown',
                    email: undefined
                };
                const result = await (await messageSender).sendMessage(message, currentUser);
                if (!result.success) {
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to send message',
                        originalMessage: message
                    });
                    return;
                }
                // MessageSender already handled DB insertion and socket emits
                socket.emit('message_sent', {
                    success: true,
                    messageId: result.messageId,
                    originalMessage: message
                });
            }
            catch (error) {
                console.error('Error sending message:', error);
                socket.emit('message_error', {
                    success: false,
                    error: error instanceof Error ? error.message : 'Internal server error',
                    originalMessage: message
                });
            }
        });
        socket.on('send_image', async (data) => {
            const fs = require('fs');
            const path = require('path');
            const tempPath = path.join('imgs', data.filename);
            try {
                console.log('Received image via Socket.IO:', data.message);
                const buffer = Buffer.from(data.imageData, 'base64');
                fs.writeFileSync(tempPath, buffer);
                const mockFile = {
                    path: tempPath,
                    filename: data.filename,
                    mimetype: 'image/jpeg'
                };
                // Send image via MessageSender (handles DB insertion and socket emits)
                const currentUser = {
                    id: socket.userId || 'unknown',
                    username: socket.userId || 'unknown',
                    email: undefined
                };
                const result = await (await messageSender).sendImage(data.message, mockFile, currentUser);
                if (!result.success) {
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to send image',
                        originalMessage: data.message
                    });
                    return;
                }
                // MessageSender already handled DB insertion and socket emits
                socket.emit('message_sent', {
                    success: true,
                    messageId: result.messageId,
                    originalMessage: data.message
                });
            }
            catch (error) {
                console.error('Error handling send_image:', error);
                // Clean up file on error
                try {
                    if (fs.existsSync(tempPath))
                        fs.unlinkSync(tempPath);
                }
                catch (_) { }
                socket.emit('message_error', {
                    success: false,
                    error: error instanceof Error ? error.message : 'Internal server error',
                    originalMessage: data?.message
                });
            }
        });
        socket.on('send_video', async (data) => {
            const tempPath = path_1.default.join('video', data.filename);
            try {
                console.log('Received video via Socket.IO:', data.message);
                const buffer = Buffer.from(data.videoData, 'base64');
                fs_1.default.writeFileSync(tempPath, buffer);
                const mockFile = { path: tempPath, filename: data.filename, mimetype: 'video/mp4' };
                // Send video via MessageSender (handles DB insertion and socket emits)
                const currentUser = {
                    id: socket.userId || 'unknown',
                    username: socket.userId || 'unknown',
                    email: undefined
                };
                const result = await (await messageSender).sendVideo(data.message, mockFile, currentUser);
                if (!result.success) {
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to send video',
                        originalMessage: data.message
                    });
                    return;
                }
                // MessageSender already handled DB insertion and socket emits
                socket.emit('message_sent', {
                    success: true,
                    messageId: result.messageId,
                    originalMessage: data.message
                });
            }
            catch (error) {
                console.error('Error handling send_video:', error);
                // Clean up file on error
                try {
                    if (fs_1.default.existsSync(tempPath))
                        fs_1.default.unlinkSync(tempPath);
                }
                catch (_) { }
                socket.emit('message_error', {
                    success: false,
                    error: error instanceof Error ? error.message : 'Internal server error',
                    originalMessage: data?.message
                });
            }
        });
        socket.on('send_audio', async (data) => {
            const tempDir = 'audio';
            const baseName = path_1.default.basename(data.filename, path_1.default.extname(data.filename));
            const outputOggPath = path_1.default.join(tempDir, `${baseName}.ogg`);
            try {
                console.log('🎤 Received send_audio request');
                console.log('📦 Message data:', JSON.stringify({
                    id: data.message?.id,
                    chatId: data.message?.chatId,
                    phone: data.message?.phone,
                    messageType: data.message?.messageType
                }));
                console.log('📁 Filename:', data.filename);
                console.log('🔊 Audio data present:', !!data.audioData);
                if (data.message && !data.message.phone && data.message.chatId) {
                    console.log('⚠️ Phone missing, using chatId as phone fallback');
                    data.message.phone = data.message.chatId;
                }
                // Ensure output directory exists
                if (!fs_1.default.existsSync(tempDir)) {
                    fs_1.default.mkdirSync(tempDir, { recursive: true });
                }
                // Convert base64 to readable stream
                const inputBuffer = Buffer.from(data.audioData, 'base64');
                const inputStream = new stream_1.default.PassThrough();
                inputStream.end(inputBuffer);
                // Output file stream
                const outputStream = fs_1.default.createWriteStream(outputOggPath);
                // Convert directly from memory → OGG (no temp .webm file)
                console.log(`🎧 Converting in memory → ${outputOggPath}`);
                await new Promise((resolve, reject) => {
                    const command = (0, fluent_ffmpeg_1.default)(inputStream)
                        .noVideo()
                        .audioCodec('libopus')
                        .format('ogg')
                        .on('start', (cmd) => console.log('ffmpeg started:', cmd))
                        .on('stderr', (line) => console.log('ffmpeg stderr:', line))
                        .on('end', () => {
                        console.log('ffmpeg ended successfully');
                        resolve();
                    })
                        .on('error', (err) => {
                        console.error('ffmpeg error:', err);
                        reject(err);
                    });
                    command.pipe(outputStream, { end: true });
                });
                console.log(`✅ Saved converted OGG file: ${outputOggPath}`);
                // Prepare mock file for your message sender
                const mockFile = {
                    path: outputOggPath,
                    filename: `${baseName}.ogg`,
                    mimetype: 'audio/ogg',
                };
                const currentUser = {
                    id: socket.userId || 'unknown',
                    username: socket.userId || 'unknown',
                    email: undefined,
                };
                // Get the message sender instance
                const senderInstance = await messageSender;
                if (!senderInstance) {
                    throw new Error('Message sender instance not initialized');
                }
                console.log('🚀 Calling sendAudio with phone:', data.message.phone);
                // Send audio via MessageSender (handles WuzAPI, DB insertion, and socket emits)
                const result = await senderInstance.sendAudio(data.message, mockFile, currentUser);
                if (!result.success) {
                    console.error('❌ sendAudio failed:', result.error, result.details);
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to send audio',
                        details: result.details,
                        originalMessage: data.message,
                    });
                    return;
                }
                // MessageSender already handled WuzAPI send, DB insertion, and socket emits
                socket.emit('message_sent', {
                    success: true,
                    messageId: result.messageId,
                    originalMessage: data.message
                });
            }
            catch (error) {
                console.error('❌ Error handling send_audio:', error);
                socket.emit('message_error', {
                    success: false,
                    error: error?.message || 'Internal server error',
                    originalMessage: data?.message,
                });
            }
        });
        socket.on('send_document', async (data) => {
            const tempDir = 'docs';
            const tempPath = path_1.default.join(tempDir, data.filename);
            try {
                console.log('Received document via Socket.IO:', data.message);
                if (!fs_1.default.existsSync(tempDir)) {
                    fs_1.default.mkdirSync(tempDir, { recursive: true });
                }
                const buffer = Buffer.from(data.documentData, 'base64');
                fs_1.default.writeFileSync(tempPath, buffer);
                const mockFile = {
                    path: tempPath,
                    filename: data.filename,
                    mimetype: data.mimetype || 'application/octet-stream'
                };
                const currentUser = {
                    id: socket.userId || 'unknown',
                    username: socket.userId || 'unknown',
                    email: undefined
                };
                const result = await (await messageSender).sendDocument(data.message, mockFile, currentUser);
                if (!result.success) {
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to send document',
                        originalMessage: data.message
                    });
                    return;
                }
                socket.emit('message_sent', {
                    success: true,
                    messageId: result.messageId,
                    originalMessage: data.message
                });
            }
            catch (error) {
                console.error('Error handling send_document:', error);
                try {
                    if (fs_1.default.existsSync(tempPath))
                        fs_1.default.unlinkSync(tempPath);
                }
                catch (_) { }
                socket.emit('message_error', {
                    success: false,
                    error: error instanceof Error ? error.message : 'Internal server error',
                    originalMessage: data?.message
                });
            }
        });
        socket.on('cancel_recording', async (data) => {
            try {
                console.log('Recording cancelled:', data);
                // Clean up any temporary files if filename is provided
                if (data.filename) {
                    const path = require('path');
                    const tempPath = path.join('audio', data.filename);
                    if (fs_1.default.existsSync(tempPath)) {
                        fs_1.default.unlinkSync(tempPath);
                        console.log('Cleaned up cancelled recording file:', data.filename);
                    }
                }
                socket.emit('recording_cancelled', {
                    success: true,
                    message: 'Recording cancelled successfully'
                });
            }
            catch (error) {
                console.error('Error cancelling recording:', error);
                socket.emit('recording_cancelled', {
                    success: false,
                    error: 'Failed to cancel recording'
                });
            }
        });
        socket.on('typing', (data) => {
            const { conversationId, userId, isTyping } = data;
            // Emit typing status to all users in the conversation except sender
            socket.to(`conversation_${conversationId}`).emit('user_typing', {
                userId,
                isTyping,
                conversationId
            });
        });
        socket.on('message_forwarded', async (data) => {
            try {
                const { originalMessage, targetChatId, targetPhone, senderId } = data;
                console.log(`Forwarding message from ${originalMessage.chatId} to ${targetChatId} (${targetPhone})`);
                // Use the phone number provided from the selected conversation in the UI
                const recipientPhone = targetPhone || (targetChatId.includes('@') ? targetChatId.split('@')[0] : targetChatId);
                // Build Participant JID for forward context
                // Participant should be the original sender's WhatsApp JID
                let participantJID = originalMessage.ContactId;
                if (participantJID && !participantJID.includes('@')) {
                    participantJID = `${participantJID}@s.whatsapp.net`;
                }
                // Build forwarded message payload with context for proper WhatsApp labeling
                const forwardedMessage = {
                    ...originalMessage, // Incorporate original message fields (message, attachments, etc.)
                    id: Date.now().toString(),
                    chatId: targetChatId,
                    phone: recipientPhone, // Use the provided recipient phone number for the API call
                    timestamp: (0, timezone_1.adjustToConfiguredTimezone)(new Date()),
                    timeStamp: (0, timezone_1.adjustToConfiguredTimezone)(new Date()),
                    ContactId: senderId, // The person who is doing the forwarding
                    isFromMe: true,
                    isEdit: false,
                    isRead: false,
                    isDelivered: false,
                    // Context for WhatsApp to recognize this as a forwarded message
                    forwardContext: {
                        StanzaId: originalMessage.id, // ID of the original message
                        Participant: participantJID, // The original sender's JID
                        IsForwarded: true
                    }
                };
                const senderInstance = await messageSender;
                const currentUser = { id: senderId, username: senderId };
                let result = { success: false, error: 'Unsupported message type' };
                if (forwardedMessage.messageType === 'text') {
                    result = await senderInstance.sendMessage(forwardedMessage, currentUser);
                }
                else {
                    // For media messages, we need the local file path to resend
                    if (forwardedMessage.mediaPath) {
                        // Determine the absolute path to the file
                        let filePath = forwardedMessage.mediaPath;
                        if (!path_1.default.isAbsolute(filePath)) {
                            // Usually paths are relative to the project root (e.g., 'imgs/file.jpg')
                            filePath = path_1.default.join(process_1.default.cwd(), filePath);
                        }
                        if (fs_1.default.existsSync(filePath)) {
                            const mockFile = {
                                path: filePath,
                                filename: path_1.default.basename(filePath),
                                mimetype: forwardedMessage.messageType === 'image' ? 'image/jpeg' :
                                    (forwardedMessage.messageType === 'video' ? 'video/mp4' : 'audio/ogg')
                            };
                            if (forwardedMessage.messageType === 'image') {
                                result = await senderInstance.sendImage(forwardedMessage, mockFile, currentUser);
                            }
                            else if (forwardedMessage.messageType === 'video') {
                                result = await senderInstance.sendVideo(forwardedMessage, mockFile, currentUser);
                            }
                            else if (forwardedMessage.messageType === 'audio') {
                                result = await senderInstance.sendAudio(forwardedMessage, mockFile, currentUser);
                            }
                        }
                        else {
                            console.error('Media file not found for forwarding:', filePath);
                            // Fallback to text message if the file is missing
                            forwardedMessage.messageType = 'text';
                            forwardedMessage.message = `${forwardedMessage.message || '[Media]'} (Original file not found on server)`;
                            result = await senderInstance.sendMessage(forwardedMessage, currentUser);
                        }
                    }
                    else {
                        // No mediaPath available, fallback to text
                        forwardedMessage.messageType = 'text';
                        result = await senderInstance.sendMessage(forwardedMessage, currentUser);
                    }
                }
                if (result.success) {
                    socket.emit('message_forward_success', {
                        success: true,
                        messageId: result.messageId,
                        targetChatId: targetChatId
                    });
                }
                else {
                    socket.emit('message_error', {
                        success: false,
                        error: result.error || 'Failed to forward message',
                        originalMessage: originalMessage
                    });
                }
            }
            catch (error) {
                console.error('Error in message_forwarded handler:', error);
                socket.emit('message_error', {
                    success: false,
                    error: error instanceof Error ? error.message : 'Internal server error',
                    originalMessage: data.originalMessage
                });
            }
        });
        socket.on('disconnect', () => {
            if (socket.userId) {
                connectedUsers.delete(socket.userId);
                console.log(`User ${socket.userId} disconnected`);
            }
        });
    });
    return io;
}
// Export functions to emit events from other parts of the application
function emitNewMessage(messageData) {
    if (globalIO) {
        try {
            // Handle timestamp field (lowercase)
            if (messageData?.timestamp) {
                if (messageData.timestamp instanceof Date) {
                    messageData.timestamp = messageData.timestamp.toISOString();
                }
                else if (typeof messageData.timestamp === 'number') {
                    // Assume number is absolute timestamp, check if it needs adjustment?
                    // Usually messageData comes from DB or Sender, so it's already adjusted or is a date.
                    messageData.timestamp = new Date(messageData.timestamp).toISOString();
                }
                else if (typeof messageData.timestamp === 'string') {
                    // Already a string, ensure it's ISO format
                    messageData.timestamp = new Date(messageData.timestamp).toISOString();
                }
            }
            // Handle timeStamp field (from database) - ensure it's also set as timestamp
            if (messageData?.timeStamp) {
                let timeStampValue;
                if (messageData.timeStamp instanceof Date) {
                    timeStampValue = messageData.timeStamp;
                }
                else if (typeof messageData.timeStamp === 'number') {
                    timeStampValue = new Date(messageData.timeStamp);
                }
                else if (typeof messageData.timeStamp === 'string') {
                    timeStampValue = new Date(messageData.timeStamp);
                }
                else {
                    timeStampValue = (0, timezone_1.adjustToConfiguredTimezone)(new Date());
                }
                // Set both fields for consistency
                messageData.timeStamp = timeStampValue;
                if (!messageData.timestamp) {
                    messageData.timestamp = timeStampValue.toISOString();
                }
            }
        }
        catch (e) {
            console.error('Error formatting timestamp in emitNewMessage:', e);
        }
        globalIO.to(`conversation_${messageData.chatId}`).emit('new_message', messageData);
    }
}
function emitChatUpdate(chatData) {
    if (globalIO) {
        try {
            if (chatData?.lastMessageTime && chatData.lastMessageTime instanceof Date) {
                chatData.lastMessageTime = chatData.lastMessageTime.toISOString();
            }
            else if (chatData?.lastMessageTime && typeof chatData.lastMessageTime === 'number') {
                chatData.lastMessageTime = new Date(chatData.lastMessageTime).toISOString();
            }
        }
        catch (e) { }
        globalIO.emit('chat_updated', {
            id: chatData.id,
            name: chatData.name,
            lastMessage: chatData.lastMessage,
            lastMessageTime: chatData.lastMessageTime,
            unreadCount: chatData.unreadCount !== undefined ? chatData.unreadCount : (chatData.unReadCount !== undefined ? chatData.unReadCount : 0),
            phone: chatData.phone,
            contactId: chatData.contactId,
            tagsname: chatData.tagsname
        });
    }
}
function emitChatPresence(presenceData) {
    if (globalIO) {
        // Send presence only to the specific conversation room
        globalIO.to(`conversation_${presenceData.chatId}`).emit('chat_presence', {
            chatId: presenceData.chatId,
            userId: presenceData.userId,
            isOnline: presenceData.isOnline,
            isTyping: presenceData.isTyping
        });
    }
}
// Export function to emit message update events (for replacing temp messages)
function emitMessageUpdate(messageData) {
    if (globalIO) {
        try {
            if (messageData?.timestamp && messageData.timestamp instanceof Date) {
                messageData.timestamp = messageData.timestamp.toISOString();
            }
            else if (messageData?.timestamp && typeof messageData.timestamp === 'number') {
                messageData.timestamp = new Date(messageData.timestamp).toISOString();
            }
        }
        catch (e) { }
        globalIO.to(`conversation_${messageData.chatId}`).emit('message_updated', messageData);
    }
}
function emitReactionUpdate(chatId, messageId, reactions) {
    if (globalIO) {
        globalIO.to(`conversation_${chatId}`).emit('reaction_updated', {
            messageId,
            reactions
        });
    }
}
