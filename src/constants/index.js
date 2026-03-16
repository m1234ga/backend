"use strict";
/**
 * Application-wide constants
 * Eliminates magic values and provides single source of truth
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESENCE_STATES = exports.WEBHOOK_TYPES = exports.USER_ROLES = exports.REGEX_PATTERNS = exports.LIMITS = exports.TIMEOUTS = exports.ERROR_MESSAGES = exports.HTTP_STATUS = exports.SOCKET_EVENTS = exports.WHATSAPP = exports.MIME_TYPES = exports.FILE_EXTENSIONS = exports.MESSAGE_STATUS = exports.CHAT_STATUS = exports.MESSAGE_TYPES = void 0;
// Message Types
exports.MESSAGE_TYPES = {
    TEXT: 'text',
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    MEDIA: 'media',
    STICKER: 'sticker',
    LOCATION: 'location',
    CONTACT: 'contact',
    POLL: 'poll',
};
// Chat Status
exports.CHAT_STATUS = {
    OPEN: 'open',
    CLOSED: 'closed',
    ARCHIVED: 'archived',
};
// Message Status
exports.MESSAGE_STATUS = {
    READ: 'read',
    DELIVERED: 'delivered',
    SENT: 'sent',
    PENDING: 'pending',
    FAILED: 'failed',
};
// File Extensions
exports.FILE_EXTENSIONS = {
    IMAGE: {
        JPEG: '.jpeg',
        JPG: '.jpg',
        PNG: '.png',
        GIF: '.gif',
        WEBP: '.webp',
    },
    VIDEO: {
        MP4: '.mp4',
        WEBM: '.webm',
        OGG: '.ogg',
    },
    AUDIO: {
        OGG: '.ogg',
        MP3: '.mp3',
        WEBM: '.webm',
        WAV: '.wav',
    },
    DOCUMENT: {
        PDF: '.pdf',
        DOC: '.doc',
        DOCX: '.docx',
        TXT: '.txt',
    },
};
// MIME Types
exports.MIME_TYPES = {
    IMAGE_JPEG: 'image/jpeg',
    IMAGE_PNG: 'image/png',
    IMAGE_GIF: 'image/gif',
    IMAGE_WEBP: 'image/webp',
    VIDEO_MP4: 'video/mp4',
    VIDEO_WEBM: 'video/webm',
    AUDIO_OGG: 'audio/ogg',
    AUDIO_MPEG: 'audio/mpeg',
    AUDIO_WEBM: 'audio/webm',
    APPLICATION_PDF: 'application/pdf',
    APPLICATION_OCTET_STREAM: 'application/octet-stream',
};
// WhatsApp Specific
exports.WHATSAPP = {
    DOMAIN: '@s.whatsapp.net',
    GROUP_DOMAIN: '@g.us',
    BROADCAST: 'status@broadcast',
    MAX_MESSAGE_LENGTH: 10000,
    MAX_CAPTION_LENGTH: 1024,
};
// Socket Events
exports.SOCKET_EVENTS = {
    // Client -> Server
    JOIN: 'join',
    JOIN_CONVERSATION: 'join_conversation',
    LEAVE_CONVERSATION: 'leave_conversation',
    SEND_MESSAGE: 'send_message',
    SEND_IMAGE: 'send_image',
    SEND_VIDEO: 'send_video',
    SEND_AUDIO: 'send_audio',
    SEND_DOCUMENT: 'send_document',
    SEND_STICKER: 'send_sticker',
    SEND_LOCATION: 'send_location',
    SEND_CONTACT: 'send_contact',
    SEND_POLL: 'send_poll',
    TYPING: 'typing',
    MESSAGE_FORWARDED: 'message_forwarded',
    CANCEL_RECORDING: 'cancel_recording',
    // Server -> Client
    NEW_MESSAGE: 'new_message',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_ERROR: 'message_error',
    MESSAGE_UPDATED: 'message_updated',
    CHAT_UPDATED: 'chat_updated',
    CHAT_PRESENCE: 'chat_presence',
    USER_TYPING: 'user_typing',
    REACTION_UPDATED: 'reaction_updated',
    HISTORY_SYNC_STATUS: 'history_sync_status',
    RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
    ERROR: 'error',
};
// HTTP Status Codes
exports.HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
};
// Error Messages
exports.ERROR_MESSAGES = {
    VALIDATION_FAILED: 'Validation failed',
    UNAUTHORIZED: 'Unauthorized',
    FORBIDDEN: 'Forbidden',
    NOT_FOUND: 'Resource not found',
    INTERNAL_ERROR: 'Internal server error',
    RATE_LIMIT_EXCEEDED: 'Too many requests, please slow down',
    INVALID_TOKEN: 'Invalid or expired token',
    MISSING_REQUIRED_FIELDS: 'Missing required fields',
    FILE_TOO_LARGE: 'File size exceeds maximum allowed',
    INVALID_FILE_TYPE: 'Invalid file type',
    DATABASE_ERROR: 'Database operation failed',
    EXTERNAL_API_ERROR: 'External API request failed',
};
// Timeouts (in milliseconds)
exports.TIMEOUTS = {
    API_REQUEST: 30000, // 30 seconds
    DATABASE_QUERY: 10000, // 10 seconds
    FILE_UPLOAD: 60000, // 60 seconds
    SOCKET_PING: 25000, // 25 seconds
    SOCKET_TIMEOUT: 60000, // 60 seconds
};
// Limits
exports.LIMITS = {
    MAX_MESSAGE_LENGTH: 10000,
    MAX_FILENAME_LENGTH: 255,
    MAX_CHAT_ID_LENGTH: 100,
    MAX_PHONE_LENGTH: 20,
    MAX_TAG_NAME_LENGTH: 50,
    MAX_PUSHNAME_LENGTH: 100,
    AUDIO_WAVEFORM_POINTS: 64,
    MAX_AUDIO_DURATION_SECONDS: 3600,
};
// Regex Patterns
exports.REGEX_PATTERNS = {
    PHONE: /^[0-9+@.]+$/,
    CHAT_ID: /^[a-zA-Z0-9@._-]+$/,
    MESSAGE_ID: /^[a-zA-Z0-9_-]+$/,
    FILENAME: /^[a-zA-Z0-9_.-]+$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};
// User Roles
exports.USER_ROLES = {
    ADMIN: 'admin',
    USER_MANAGER: 'user-manager',
    USER: 'user',
    GUEST: 'guest',
};
// Webhook Types
exports.WEBHOOK_TYPES = {
    MESSAGE: 'Message',
    HISTORY_SYNC: 'HistorySync',
    CHAT_PRESENCE: 'ChatPresence',
    READ_RECEIPT: 'ReadReceipt',
    PRESENCE: 'Presence',
};
// Presence States
exports.PRESENCE_STATES = {
    AVAILABLE: 'available',
    ONLINE: 'online',
    COMPOSING: 'composing',
    RECORDING: 'recording',
    UNAVAILABLE: 'unavailable',
};
