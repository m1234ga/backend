"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MessageSender;
const uuid_1 = require("uuid");
const SocketEmits_1 = require("../SocketEmits");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const fs_1 = __importDefault(require("fs"));
const DBHelper_1 = __importDefault(require("../DBHelper"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const child_process_1 = require("child_process");
// @ts-ignore - ffmpeg-static may not have proper TS types
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
// @ts-ignore - ffprobe-static may not have proper TS types
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
const timezone_1 = require("../utils/timezone");
// Configure ffmpeg binary if available
try {
    const binaryPath = typeof ffmpeg_static_1.default === 'string' ? ffmpeg_static_1.default : ffmpeg_static_1.default?.path;
    if (binaryPath) {
        fluent_ffmpeg_1.default.setFfmpegPath(binaryPath);
    }
    if (ffprobe_static_1.default && ffprobe_static_1.default.path) {
        fluent_ffmpeg_1.default.setFfprobePath(ffprobe_static_1.default.path);
    }
}
catch (err) {
    console.error('Error setting ffmpeg/ffprobe paths:', err);
}
async function MessageSender() {
    // Helper function to create message object in database format
    function createMessageObject(messageId, message, messageType, content, timestamp) {
        return {
            Info: {
                ID: messageId,
                Chat: message.chatId,
                Timestamp: timestamp.toISOString(),
                IsFromMe: true,
                isEdit: false,
                Sender: 'Me'
            },
            Message: {
                conversation: content,
                extendedTextMessage: messageType === 'text' ? { text: content } : undefined,
                imageMessage: messageType === 'image' ? { caption: content, mimetype: 'image/jpeg' } : undefined,
                audioMessage: messageType === 'audio' ? { mimetype: 'audio/ogg' } : undefined,
                stickerMessage: messageType === 'sticker' ? {} : undefined
            }
        };
    }
    async function sendMessage(message, currentUser) {
        try {
            if (!message || !message.phone) {
                return {
                    success: false,
                    error: 'Missing required fields: phone and message are required',
                };
            }
            const response = await fetch(process.env.WUZAPI + '/chat/send/text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: process.env.WUZAPI_Token || "",
                },
                body: JSON.stringify({
                    Phone: message.phone,
                    Body: message.message ?? "",
                    Id: (0, uuid_1.v4)(),
                    ContextInfo: buildForwardContext(message)
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WhatsApp API error:', response.status, errorText);
                return {
                    success: false,
                    error: 'Failed to send message via WhatsApp API',
                    details: errorText,
                };
            }
            const result = await response.json();
            const messageId = result.data.Id;
            let timestamp = new Date(result.data.Timestamp * 1000 || result.data.TimeStamp * 1000 || Date.now());
            timestamp = (0, timezone_1.adjustToConfiguredTimezone)(timestamp);
            // Store the temp ID from the original message (sent from frontend)
            const tempId = message.id;
            // Save message to database
            const dbMessageObject = createMessageObject(messageId, message ?? "", 'text', message.message, timestamp);
            // Save chat to database
            const chatResult = await (0, DBHelper_1.default)().upsertChat(message.chatId, message.message, timestamp, 0, // unreadCount
            false, // isOnline
            false, // isTyping
            message.pushName ?? "", message.ContactId || message.phone, currentUser?.id || 'current_user', // userId from current user
            undefined, true // isFromMe
            );
            // Save message to database
            const savedMsg = await (0, DBHelper_1.default)().upsertMessage(dbMessageObject, message.chatId, 'text', undefined, currentUser?.id);
            if (savedMsg) {
                (0, SocketEmits_1.emitNewMessage)({ ...savedMsg, tempId });
                // Emit update to confirm the message was sent and replace the optimistically added message
                (0, SocketEmits_1.emitMessageUpdate)({
                    id: savedMsg.id,
                    tempId,
                    timestamp: savedMsg.timestamp || timestamp.toISOString(),
                    timeStamp: savedMsg.timeStamp || timestamp,
                    chatId: savedMsg.chatId,
                    messageType: 'text',
                    isDelivered: true,
                    message: savedMsg.message
                });
            }
            // Emit socket events - only chat update (message already added optimistically on frontend)
            if (chatResult && chatResult.length > 0) {
                (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
            }
            return {
                success: true,
                message: 'Message sent successfully',
                data: result,
                messageId
            };
        }
        catch (error) {
            console.error('Error in sendMessage:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async function sendImage(message, imageFile, currentUser) {
        try {
            if (!message || !message.phone || !imageFile) {
                return {
                    success: false,
                    error: 'Missing required fields: phone, message, and image file are required',
                };
            }
            // Read the image file
            const imageBuffer = fs_1.default.readFileSync(imageFile.path);
            const base64Image = imageBuffer.toString('base64');
            const response = await fetch(process.env.WUZAPI + '/chat/send/image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: process.env.WUZAPI_Token || "",
                },
                body: JSON.stringify({
                    Phone: message.phone,
                    Image: 'data:image/jpeg;base64,' + base64Image,
                    Id: (0, uuid_1.v4)(),
                    Caption: message.message || '',
                    ContextInfo: buildForwardContext(message)
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WhatsApp API error (image):', response.status, errorText);
                // Cleanup uploaded file on failure
                try {
                    if (imageFile?.path && fs_1.default.existsSync(imageFile.path)) {
                        fs_1.default.unlinkSync(imageFile.path);
                    }
                }
                catch { }
                return {
                    success: false,
                    error: 'Failed to send image via WhatsApp API',
                    details: errorText,
                };
            }
            const result = await response.json();
            console.log('WhatsApp API response (image):', JSON.stringify(result));
            const messageId = result.data?.Id || result.data?.id || (0, uuid_1.v4)();
            const timestampSec = result.data?.Timestamp || result.data?.TimeStamp || result.data?.timestamp || Math.floor(Date.now() / 1000);
            const rawTimestamp = new Date(timestampSec * 1000);
            // Adjust timestamp for Cairo timezone (UTC+2)
            const timestamp = (0, timezone_1.adjustToConfiguredTimezone)(rawTimestamp);
            // Store the temp ID from the original message (sent from frontend)
            const tempId = message.id;
            // Save message to database
            const dbMessageObject = createMessageObject(messageId, message, 'image', message.message || '[Image]', timestamp);
            // Save chat to database
            const chatResult = await (0, DBHelper_1.default)().upsertChat(message.chatId, message.message || '[Image]', timestamp, 0, // unreadCount
            false, // isOnline
            false, // isTyping
            message.pushName ?? "", message.ContactId || message.phone, currentUser?.id || 'current_user', // userId from current user
            undefined, true // isFromMe
            );
            // Determine the relative media path using the original filename from Multer
            const mediaPath = `imgs/${imageFile.filename}`;
            // Save message to database with the original filename
            const savedMsg = await (0, DBHelper_1.default)().upsertMessage(dbMessageObject, message.chatId, 'image', mediaPath, currentUser?.id);
            if (savedMsg) {
                (0, SocketEmits_1.emitNewMessage)({ ...savedMsg, tempId });
                // Emit update to confirm the message was sent and provide the correct media path
                (0, SocketEmits_1.emitMessageUpdate)({
                    id: savedMsg.id,
                    tempId,
                    message: savedMsg.message || message.message || '[Image]',
                    timestamp: timestamp.toISOString(),
                    timeStamp: timestamp,
                    chatId: message.chatId,
                    messageType: 'image'
                });
            }
            // Emit socket events - only chat update (message already added optimistically on frontend)
            if (chatResult && chatResult.length > 0) {
                (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
            }
            return {
                success: true,
                message: 'Image sent successfully',
                data: result,
                messageId,
            };
        }
        catch (error) {
            console.error('Error in sendImage:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async function sendVideo(message, videoFile, currentUser) {
        try {
            if (!message || !message.phone || !videoFile) {
                return {
                    success: false,
                    error: 'Missing required fields: phone, message, and video file are required',
                };
            }
            // Read the video file
            const videoBuffer = fs_1.default.readFileSync(videoFile.path);
            const base64Video = videoBuffer.toString('base64');
            const response = await fetch(process.env.WUZAPI + '/chat/send/video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: process.env.WUZAPI_Token || "",
                },
                body: JSON.stringify({
                    Phone: message.phone,
                    Body: base64Video,
                    Id: (0, uuid_1.v4)(),
                    Caption: message.message || '',
                    ContextInfo: buildForwardContext(message)
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WhatsApp API error (video):', response.status, errorText);
                // Cleanup uploaded file on failure
                try {
                    if (videoFile?.path && fs_1.default.existsSync(videoFile.path)) {
                        fs_1.default.unlinkSync(videoFile.path);
                    }
                }
                catch { }
                return {
                    success: false,
                    error: 'Failed to send video via WhatsApp API',
                    details: errorText,
                };
            }
            const result = await response.json();
            console.log('WhatsApp API response (video):', JSON.stringify(result));
            const messageId = result.data?.Id || result.data?.id || (0, uuid_1.v4)();
            const timestampSec = result.data?.Timestamp || result.data?.TimeStamp || result.data?.timestamp || Math.floor(Date.now() / 1000);
            const rawTimestamp = new Date(timestampSec * 1000);
            // Adjust timestamp for Cairo timezone (UTC+2)
            const timestamp = (0, timezone_1.adjustToConfiguredTimezone)(rawTimestamp);
            const isoTimestamp = timestamp.toISOString();
            // Save message to database
            const dbMessageObject = createMessageObject(messageId, message, 'video', message.message || '[Video]', timestamp);
            // Save chat to database
            const chatResult = await (0, DBHelper_1.default)().upsertChat(message.chatId, message.message || '[Video]', timestamp, 0, // unreadCount
            false, // isOnline
            false, // isTyping
            message.pushName ?? "", message.ContactId || message.phone, currentUser?.id || 'current_user', // userId from current user
            undefined, true // isFromMe
            );
            // Determine the relative media path using the original filename from Multer
            const mediaPath = `Video/${videoFile.filename}`;
            // Save message to database
            const savedMsg = await (0, DBHelper_1.default)().upsertMessage(dbMessageObject, message.chatId, 'video', mediaPath, currentUser?.id);
            if (savedMsg) {
                const tempId = message.id;
                (0, SocketEmits_1.emitNewMessage)({ ...savedMsg, tempId });
            }
            // Emit socket events - only chat update (message already added optimistically on frontend)
            if (chatResult && chatResult.length > 0) {
                (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
            }
            return {
                success: true,
                message: 'Video sent successfully',
                data: result,
                messageId,
            };
        }
        catch (error) {
            console.error('Error in sendVideo:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async function getAudioMetadata(filePath) {
        return new Promise((resolve) => {
            try {
                fluent_ffmpeg_1.default.ffprobe(filePath, (err, metadata) => {
                    if (err) {
                        console.error('Error probing audio:', err);
                        // Fallback for duration if ffprobe fails
                        try {
                            const result = (0, child_process_1.spawnSync)(ffmpeg_static_1.default, ['-i', filePath]);
                            const output = result.stderr.toString();
                            const match = output.match(/Duration: (\d+):(\d+):(\d+).(\d+)/);
                            let seconds = 0;
                            if (match) {
                                const hours = parseInt(match[1]);
                                const minutes = parseInt(match[2]);
                                const secs = parseInt(match[3]);
                                seconds = hours * 3600 + minutes * 60 + secs;
                            }
                            resolve({ seconds, waveform: [] });
                        }
                        catch (fallbackErr) {
                            console.error('Fallback duration extraction failed:', fallbackErr);
                            resolve({ seconds: 0, waveform: [] });
                        }
                        return;
                    }
                    const seconds = Math.floor(metadata.format.duration || 0);
                    // Generate waveform using ffmpeg to output raw PCM
                    const child = (0, child_process_1.spawn)(ffmpeg_static_1.default, [
                        '-i', filePath,
                        '-f', 's16le',
                        '-ac', '1',
                        '-ar', '4000',
                        'pipe:1'
                    ]);
                    const samples = [];
                    child.stdout.on('data', (data) => {
                        for (let i = 0; i < data.length; i += 2) {
                            if (i + 1 < data.length) {
                                try {
                                    samples.push(Math.abs(data.readInt16LE(i)));
                                }
                                catch (e) { }
                            }
                        }
                    });
                    child.on('close', () => {
                        const waveform = [];
                        if (samples.length > 0) {
                            const segmentSize = Math.max(1, Math.floor(samples.length / 64));
                            for (let i = 0; i < 64; i++) {
                                let sum = 0;
                                const start = i * segmentSize;
                                const end = Math.min(start + segmentSize, samples.length);
                                for (let j = start; j < end; j++) {
                                    sum += samples[j];
                                }
                                const avg = (end - start) > 0 ? sum / (end - start) : 0;
                                // Normalize to 0-255.
                                waveform.push(Math.min(255, Math.floor((avg / 32768) * 255)));
                            }
                        }
                        resolve({ seconds, waveform });
                    });
                    child.on('error', (err) => {
                        console.error('Waveform generation error:', err);
                        resolve({ seconds, waveform: [] });
                    });
                });
            }
            catch (e) {
                console.error('Metadata extraction failed:', e);
                resolve({ seconds: 0, waveform: [] });
            }
        });
    }
    async function sendAudio(message, audioFile, currentUser) {
        try {
            // More detailed validation
            if (!message) {
                return { success: false, error: 'Missing required fields: message object is required' };
            }
            // Fallback for phone number
            if (!message.phone && message.chatId) {
                console.log('📢 sendAudio: phone missing, using chatId as fallback:', message.chatId);
                message.phone = message.chatId;
            }
            if (!message.phone || !audioFile) {
                const details = `phone: ${!!message.phone}, audioFile: ${!!audioFile}`;
                console.error('❌ sendAudio missing fields:', details, 'message structure:', JSON.stringify(message));
                return {
                    success: false,
                    error: `Missing required fields: ${!message.phone ? 'phone ' : ''}${!audioFile ? 'audio file ' : ''}are required`,
                    details: details
                };
            }
            // Validate audio file exists and has content
            if (!audioFile.path) {
                return {
                    success: false,
                    error: 'Audio file path is missing',
                    details: 'The audio file path is not provided',
                };
            }
            // Check if file exists
            if (!fs_1.default.existsSync(audioFile.path)) {
                return {
                    success: false,
                    error: 'Audio file does not exist',
                    details: `File path: ${audioFile.path}`,
                };
            }
            // Get file stats
            const fileStats = fs_1.default.statSync(audioFile.path);
            console.log(`Audio file stats: ${fileStats.size} bytes, path: ${audioFile.path}`);
            if (fileStats.size === 0) {
                return {
                    success: false,
                    error: 'Audio file is empty',
                    details: `File size: ${fileStats.size} bytes`,
                };
            }
            // Read the audio file
            const audioBuffer = fs_1.default.readFileSync(audioFile.path);
            console.log(`Audio buffer size: ${audioBuffer.length} bytes`);
            if (audioBuffer.length === 0) {
                return {
                    success: false,
                    error: 'Failed to read audio file content',
                    details: 'Audio buffer is empty after reading file',
                };
            }
            // Convert to base64
            const base64Audio = audioBuffer.toString('base64');
            const mimeType = 'audio/ogg';
            console.log(`Base64 audio length: ${base64Audio.length} characters`);
            if (base64Audio.length === 0) {
                return {
                    success: false,
                    error: 'Failed to convert audio to base64',
                    details: 'Base64 conversion resulted in empty string',
                };
            }
            // Get audio metadata automatically
            const { seconds, waveform } = await getAudioMetadata(audioFile.path);
            console.log(`✅ Automatic audio metadata: duration=${seconds}s, waveform length=${waveform.length}`);
            // Prepare the request payload
            const payload = {
                Phone: message.phone,
                Audio: 'data:audio/ogg;base64,' + base64Audio,
                Id: message.id || (0, uuid_1.v4)(),
                PTT: true,
                MimeType: 'audio/ogg; codecs=opus',
                Seconds: seconds || message.seconds || 0,
                Waveform: waveform.length > 0 ? waveform : (message.waveform || []),
                ContextInfo: buildForwardContext(message),
            };
            console.log(`Sending audio to WhatsApp API: ${process.env.WUZAPI}/chat/send/audio`);
            console.log(`Phone: ${message.phone}`);
            console.log(`Audio size: ${base64Audio.length} characters`);
            console.log(`MIME type: ${mimeType}`);
            console.log(`WUZAPI URL: ${process.env.WUZAPI}`);
            console.log(`WUZAPI Token exists: ${!!process.env.WUZAPI_Token}`);
            // Validate environment variables
            if (!process.env.WUZAPI) {
                return {
                    success: false,
                    error: 'WUZAPI environment variable is not set',
                    details: 'Please check your environment configuration',
                };
            }
            if (!process.env.WUZAPI_Token) {
                return {
                    success: false,
                    error: 'WUZAPI_Token environment variable is not set',
                    details: 'Please check your environment configuration',
                };
            }
            let response;
            try {
                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                response = await fetch(process.env.WUZAPI + '/chat/send/audio', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        token: process.env.WUZAPI_Token || "",
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
            }
            catch (fetchError) {
                console.error('Fetch error (audio):', fetchError);
                return {
                    success: false,
                    error: 'Network error: Failed to connect to WhatsApp API',
                    details: fetchError instanceof Error ? fetchError.message : 'Unknown fetch error',
                };
            }
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WhatsApp API error (audio):', response.status, errorText);
                // Cleanup uploaded file on failure
                try {
                    if (audioFile?.path && fs_1.default.existsSync(audioFile.path)) {
                        fs_1.default.unlinkSync(audioFile.path);
                    }
                }
                catch { }
                return {
                    success: false,
                    error: 'Failed to send audio via WhatsApp API',
                    details: errorText,
                };
            }
            const result = await response.json();
            console.log('WhatsApp API response (audio):', JSON.stringify(result));
            const messageId = result.data?.Id || result.data?.id || (0, uuid_1.v4)();
            const timestampSec = result.data?.TimeStamp || result.data?.Timestamp || result.data?.timestamp || Math.floor(Date.now() / 1000);
            const rawTimestamp = new Date(timestampSec * 1000);
            // Adjust timestamp for Cairo timezone (UTC+2)
            const timestamp = (0, timezone_1.adjustToConfiguredTimezone)(rawTimestamp);
            const isoTimestamp = timestamp.toISOString();
            // Store the temp ID from the original message (sent from frontend)
            const tempId = message.id;
            // Save message to database - keep readable label in message, not filename
            const dbMessageObject = createMessageObject(messageId, message, 'audio', '[Audio]', timestamp);
            // Save chat to database
            const chatResult = await (0, DBHelper_1.default)().upsertChat(message.chatId, '[Audio]', timestamp, 0, // unreadCount
            false, // isOnline
            false, // isTyping
            message.pushName ?? "", message.ContactId || message.phone, currentUser?.id || 'current_user', // userId from current user
            undefined, true // isFromMe
            );
            // Determine the relative media path using the original filename from Multer
            const mediaPath = `Audio/${audioFile.filename}`;
            // Save message to database
            const savedMsg = await (0, DBHelper_1.default)().upsertMessage(dbMessageObject, message.chatId, 'audio', mediaPath, currentUser?.id);
            if (savedMsg) {
                (0, SocketEmits_1.emitNewMessage)({ ...savedMsg, tempId });
                // Emit update to confirm the message was sent and provide the correct media path
                (0, SocketEmits_1.emitMessageUpdate)({
                    id: savedMsg.id,
                    tempId,
                    message: savedMsg.message || '[Audio]',
                    timestamp: timestamp.toISOString(),
                    timeStamp: timestamp,
                    chatId: message.chatId,
                    messageType: 'audio'
                });
            }
            // Emit socket events - only chat update (message already added optimistically on frontend)
            if (chatResult && chatResult.length > 0) {
                (0, SocketEmits_1.emitChatUpdate)(chatResult[0]);
            }
            return {
                success: true,
                message: 'Audio sent successfully',
                data: result,
                messageId,
            };
        }
        catch (error) {
            console.error('Error in sendAudio:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async function createMessageTemplate(name, content, createdBy, imagePath, mediaPath) {
        try {
            if (!name || !content || !createdBy) {
                return {
                    success: false,
                    error: 'Missing required fields: name, content, and createdBy are required',
                };
            }
            // Ensure table exists first
            await DBConnection_1.default.query(`
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
            await DBConnection_1.default.query(`ALTER TABLE "messageTemplates" ADD COLUMN IF NOT EXISTS "imagePath" TEXT`);
            await DBConnection_1.default.query(`ALTER TABLE "messageTemplates" ADD COLUMN IF NOT EXISTS "mediaPath" TEXT`);
            const result = await DBConnection_1.default.query(`
        INSERT INTO "messageTemplates" (name, content, "createdBy", "imagePath", "mediaPath") 
        VALUES ($1, $2, $3, $4, $5) 
        RETURNING *
      `, [name, content, createdBy, imagePath || null, mediaPath || null]);
            if (result.rows.length === 0) {
                return {
                    success: false,
                    error: 'Failed to create message template',
                };
            }
            return {
                success: true,
                message: 'Message template created successfully',
                data: result.rows[0],
            };
        }
        catch (error) {
            console.error('Error creating message template:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async function sendReaction(chatId, messageId, emoji) {
        try {
            if (!chatId || !messageId) {
                return {
                    success: false,
                    error: 'Missing required fields: chatId and messageId are required',
                };
            }
            // If emoji is empty string, it means remove reaction
            const reactionBody = emoji || "";
            const response = await fetch(process.env.WUZAPI + '/chat/send/reaction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    token: process.env.WUZAPI_Token || "",
                },
                body: JSON.stringify({
                    Phone: chatId,
                    Body: reactionBody,
                    Id: messageId
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('WhatsApp API error (reaction):', response.status, errorText);
                return {
                    success: false,
                    error: 'Failed to send reaction via WhatsApp API',
                    details: errorText,
                };
            }
            const result = await response.json();
            return {
                success: true,
                message: 'Reaction sent successfully',
                data: result
            };
        }
        catch (error) {
            console.error('Error in sendReaction:', error);
            return {
                success: false,
                error: 'Internal server error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    return {
        sendMessage,
        sendVideo,
        sendImage,
        sendAudio,
        createMessageTemplate,
        sendReaction
    };
}
// Build WhatsApp-like forward context when requested by caller
function buildForwardContext(message) {
    const ctx = (message && message.forwardContext) || message?.contextInfo;
    if (!ctx) {
        // If no context provided but replyToMessage exists, try to build it for reply functionality
        if (message?.replyToMessage) {
            const reply = message.replyToMessage;
            let participant = reply.ContactId || reply.participant;
            // Ensure participant has domain
            if (participant && !participant.includes('@')) {
                participant = `${participant}@s.whatsapp.net`;
            }
            else if (!participant && reply.phone) {
                participant = `${reply.phone}@s.whatsapp.net`;
            }
            // Construct basic QuotedMessage
            // Note: Ideally this should match the type of the replied message (imageMessage, etc.)
            // For now default to conversation (text)
            const quotedMessage = { conversation: reply.message || '' };
            return {
                StanzaId: reply.id,
                Participant: participant || '',
                QuotedMessage: quotedMessage,
                IsForwarded: false,
                MentionedJID: []
            };
        }
        return {};
    }
    const phone = message?.phone || '';
    const stanzaId = ctx.StanzaId || ctx.stanzaId || '';
    const participant = ctx.Participant || ctx.participant || `${phone}@s.whatsapp.net`;
    const mentioned = ctx.MentionedJID || ctx.mentionedJID || ctx.mentions || [];
    const isForwarded = typeof ctx.IsForwarded === 'boolean'
        ? ctx.IsForwarded
        : (ctx.isForwarded === true);
    // Extract QuotedMessage if present (for replies)
    const quotedMessage = ctx.QuotedMessage || ctx.quotedMessage;
    return {
        StanzaId: stanzaId,
        Participant: participant,
        IsForwarded: !!isForwarded,
        MentionedJID: Array.isArray(mentioned) ? mentioned : [],
        ...(quotedMessage ? { QuotedMessage: quotedMessage } : {})
    };
}
