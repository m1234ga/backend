import { z } from 'zod';

// Phone number validation (WhatsApp format)
const phoneSchema = z.string()
    .min(1)
    .max(100);

const directPhoneRegex = /^\+?\d{10,20}(?:@s\.whatsapp\.net)?$/;

const isGroupIdentifier = (value: string): boolean => {
    const normalized = (value || '').trim().toLowerCase();
    return normalized.endsWith('@g.us') || normalized.includes('-');
};

// Chat ID validation
const chatIdSchema = z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9@._-]+$/, 'Invalid chat ID format');

// Message ID validation
const messageIdSchema = z.string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid message ID format');

// Sanitize filename to prevent path traversal
const filenameSchema = z.string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid filename')
    .refine(
        (name) => !name.includes('..') && !name.includes('/') && !name.includes('\\'),
        'Filename contains invalid characters'
    );

// Message content validation
const messageContentSchema = z.string()
    .max(10000, 'Message too long');

// Chat message schema for socket events
export const chatMessageSchema = z.object({
    id: messageIdSchema.optional(),
    chatId: chatIdSchema,
    phone: phoneSchema,
    message: messageContentSchema.optional(),
    messageType: z.enum(['text', 'image', 'video', 'audio', 'document', 'sticker']).default('text'),
    timestamp: z.union([z.date(), z.string().datetime()]).optional(),
    timeStamp: z.union([z.date(), z.string().datetime()]).optional(),
    ContactId: z.string().optional(),
    pushName: z.string().max(100).optional(),
    isFromMe: z.boolean().default(false),
    isEdit: z.boolean().default(false),
    isRead: z.boolean().default(false),
    isDelivered: z.boolean().default(false),
    replyToMessageId: messageIdSchema.optional(),
    seconds: z.number().int().min(0).max(3600).optional(), // For audio
    waveform: z.array(z.number().int().min(0).max(255)).max(64).optional(), // For audio
    mediaPath: z.string().optional(),
}).superRefine((data, ctx) => {
    // Group chats use JIDs like 1203630...-...@g.us and should bypass direct-number checks.
    if (isGroupIdentifier(data.chatId) || isGroupIdentifier(data.phone)) return;

    const normalizedPhone = (data.phone || '').trim();
    if (!directPhoneRegex.test(normalizedPhone)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['phone'],
            message: 'Invalid phone number format',
        });
    }
});

// Image upload schema
export const imageUploadSchema = z.object({
    message: chatMessageSchema,
    imageData: z.string().min(1), // Base64
    filename: filenameSchema,
});

// Video upload schema
export const videoUploadSchema = z.object({
    message: chatMessageSchema,
    videoData: z.string().min(1), // Base64
    filename: filenameSchema,
});

// Audio upload schema
export const audioUploadSchema = z.object({
    message: chatMessageSchema,
    audioData: z.string().min(1), // Base64
    filename: filenameSchema,
});

// Document upload schema
export const documentUploadSchema = z.object({
    message: chatMessageSchema,
    documentData: z.string().min(1), // Base64
    filename: filenameSchema,
    mimetype: z.string().max(100),
});

// Typing indicator schema
export const typingDataSchema = z.object({
    conversationId: chatIdSchema,
    userId: z.string().min(1).max(100),
    isTyping: z.boolean(),
});

// Forward message schema
export const forwardMessageSchema = z.object({
    originalMessage: chatMessageSchema,
    targetChatId: chatIdSchema,
    targetPhone: phoneSchema,
    senderId: z.string().min(1).max(100),
});

// Pagination schema
export const paginationSchema = z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(25),
    before: z.string().datetime().optional(),
});

// Tag schema
export const tagSchema = z.object({
    name: z.string().min(1).max(50).trim(),
});

// Assign tag schema
export const assignTagSchema = z.object({
    chatId: chatIdSchema,
    tagId: z.string().regex(/^\d+$/, 'Invalid tag ID'),
    createdBy: z.string().min(1).max(100),
});

// Validation helper function
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
    try {
        return schema.parse(data);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            throw new Error(`Validation failed: ${messages}`);
        }
        throw error;
    }
}

// Sanitize filename to prevent path traversal attacks
export function sanitizeFilename(filename: string): string {
    return filename
        .replace(/[^a-zA-Z0-9_.-]/g, '_') // Replace invalid chars
        .replace(/\.{2,}/g, '_') // Remove consecutive dots
        .replace(/^\.+/, '') // Remove leading dots
        .substring(0, 255); // Limit length
}

// Sanitize chat ID
export function sanitizeChatId(chatId: string): string {
    return chatId.match(/^[^@:]+/)?.[0] || '';
}

// Validate and sanitize phone number
export function sanitizePhone(phone: string): string {
    // Remove @s.whatsapp.net suffix if present
    return phone.split('@')[0].replace(/[^0-9+]/g, '');
}
