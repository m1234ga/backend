"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignTagSchema = exports.tagSchema = exports.paginationSchema = exports.forwardMessageSchema = exports.typingDataSchema = exports.pollMessageSchema = exports.contactMessageSchema = exports.locationMessageSchema = exports.stickerUploadSchema = exports.documentUploadSchema = exports.audioUploadSchema = exports.videoUploadSchema = exports.imageUploadSchema = exports.chatMessageSchema = void 0;
exports.validateInput = validateInput;
exports.sanitizeFilename = sanitizeFilename;
exports.sanitizeChatId = sanitizeChatId;
exports.sanitizePhone = sanitizePhone;
const zod_1 = require("zod");
// Phone number validation (WhatsApp format)
const phoneSchema = zod_1.z.string()
    .min(1)
    .max(100);
const directPhoneRegex = /^\+?\d{10,20}(?:@s\.whatsapp\.net)?$/;
const isGroupIdentifier = (value) => {
    const normalized = (value || '').trim().toLowerCase();
    return normalized.endsWith('@g.us') || normalized.includes('-');
};
// Chat ID validation
const chatIdSchema = zod_1.z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9@._-]+$/, 'Invalid chat ID format');
// Message ID validation
const messageIdSchema = zod_1.z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid message ID format');
// Sanitize filename to prevent path traversal
const filenameSchema = zod_1.z.string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid filename')
    .refine((name) => !name.includes('..') && !name.includes('/') && !name.includes('\\'), 'Filename contains invalid characters');
// Message content validation
const messageContentSchema = zod_1.z.string()
    .max(10000, 'Message too long');
// Chat message schema for socket events
exports.chatMessageSchema = zod_1.z.object({
    id: messageIdSchema.optional(),
    chatId: chatIdSchema,
    phone: phoneSchema,
    message: messageContentSchema.optional(),
    messageType: zod_1.z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'poll']).default('text'),
    timestamp: zod_1.z.union([zod_1.z.date(), zod_1.z.string().datetime()]).optional(),
    timeStamp: zod_1.z.union([zod_1.z.date(), zod_1.z.string().datetime()]).optional(),
    ContactId: zod_1.z.string().optional(),
    pushName: zod_1.z.string().max(100).optional(),
    isFromMe: zod_1.z.boolean().default(false),
    isEdit: zod_1.z.boolean().default(false),
    isRead: zod_1.z.boolean().default(false),
    isDelivered: zod_1.z.boolean().default(false),
    replyToMessageId: messageIdSchema.optional(),
    seconds: zod_1.z.number().int().min(0).max(3600).optional(), // For audio
    waveform: zod_1.z.array(zod_1.z.number().int().min(0).max(255)).max(64).optional(), // For audio
    mediaPath: zod_1.z.string().optional(),
}).superRefine((data, ctx) => {
    // Group chats use JIDs like 1203630...-...@g.us and should bypass direct-number checks.
    if (isGroupIdentifier(data.chatId) || isGroupIdentifier(data.phone))
        return;
    const normalizedPhone = (data.phone || '').trim();
    if (!directPhoneRegex.test(normalizedPhone)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['phone'],
            message: 'Invalid phone number format',
        });
    }
});
// Image upload schema
exports.imageUploadSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    imageData: zod_1.z.string().min(1), // Base64
    filename: filenameSchema,
});
// Video upload schema
exports.videoUploadSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    videoData: zod_1.z.string().min(1), // Base64
    filename: filenameSchema,
});
// Audio upload schema
exports.audioUploadSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    audioData: zod_1.z.string().min(1), // Base64
    filename: filenameSchema,
});
// Document upload schema
exports.documentUploadSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    documentData: zod_1.z.string().min(1), // Base64
    filename: filenameSchema,
    mimetype: zod_1.z.string().max(100),
});
// Sticker upload schema
exports.stickerUploadSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    stickerData: zod_1.z.string().min(1),
    filename: filenameSchema.optional(),
});
// Location message schema
exports.locationMessageSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
    name: zod_1.z.string().max(200).optional(),
    address: zod_1.z.string().max(500).optional(),
});
// Contact message schema
exports.contactMessageSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    contactName: zod_1.z.string().min(1).max(100),
    vcard: zod_1.z.string().min(1).max(20000),
});
// Poll message schema
exports.pollMessageSchema = zod_1.z.object({
    message: exports.chatMessageSchema,
    pollName: zod_1.z.string().min(1).max(200),
    options: zod_1.z.array(zod_1.z.string().min(1).max(200)).min(2).max(12),
    selectableCount: zod_1.z.number().int().min(1).max(12).optional(),
});
// Typing indicator schema
exports.typingDataSchema = zod_1.z.object({
    conversationId: chatIdSchema,
    userId: zod_1.z.string().min(1).max(100),
    isTyping: zod_1.z.boolean(),
});
// Forward message schema
exports.forwardMessageSchema = zod_1.z.object({
    originalMessage: exports.chatMessageSchema,
    targetChatId: chatIdSchema,
    targetPhone: phoneSchema,
    senderId: zod_1.z.string().min(1).max(100),
});
// Pagination schema
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.number().int().min(1).default(1),
    limit: zod_1.z.number().int().min(1).max(100).default(25),
    before: zod_1.z.string().datetime().optional(),
});
// Tag schema
exports.tagSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50).trim(),
});
// Assign tag schema
exports.assignTagSchema = zod_1.z.object({
    chatId: chatIdSchema,
    tagId: zod_1.z.string().regex(/^\d+$/, 'Invalid tag ID'),
    createdBy: zod_1.z.string().min(1).max(100),
});
// Validation helper function
function validateInput(schema, data) {
    try {
        return schema.parse(data);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            throw new Error(`Validation failed: ${messages}`);
        }
        throw error;
    }
}
// Sanitize filename to prevent path traversal attacks
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9_.-]/g, '_') // Replace invalid chars
        .replace(/\.{2,}/g, '_') // Remove consecutive dots
        .replace(/^\.+/, '') // Remove leading dots
        .substring(0, 255); // Limit length
}
// Sanitize chat ID
function sanitizeChatId(chatId) {
    return chatId.match(/^[^@:]+/)?.[0] || '';
}
// Validate and sanitize phone number
function sanitizePhone(phone) {
    // Remove @s.whatsapp.net suffix if present
    return phone.split('@')[0].replace(/[^0-9+]/g, '');
}
