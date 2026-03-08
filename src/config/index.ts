import { config } from 'dotenv';
import path from 'path';

// Configure dotenv with multiple fallback paths to ensure it works in different environments
const envPaths = [
    path.join(__dirname, '..', '..', '.env'), // backend/.env (from src/config)
    path.join(process.cwd(), 'backend', '.env'), // ./backend/.env (from root)
    path.join(process.cwd(), '.env'), // ./.env (from backend folder)
];

let envFound = false;
for (const envPath of envPaths) {
    const result = config({ path: envPath });
    if (!result.error) {
        envFound = true;
        // console.log(`Loaded environment from ${envPath}`);
        break;
    }
}

if (!envFound) {
    config(); // Fallback to default behavior
}

// Validation helper
function getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Invalid number for environment variable ${key}: ${value}`);
    }
    return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true';
}

// Centralized configuration
export const CONFIG = {
    // Server
    PORT: getEnvNumber('PORT', 5000),
    NODE_ENV: getEnvVar('NODE_ENV', 'development'),
    USE_HTTPS: getEnvBoolean('USE_HTTPS', false),

    // SSL
    SSL: {
        CERT_PATH: process.env.SSL_CERT_PATH,
        KEY_PATH: process.env.SSL_KEY_PATH,
        CERT_FILENAME: process.env.SSL_CERT_FILENAME,
        KEY_FILENAME: process.env.SSL_KEY_FILENAME,
        BASE_PATH: process.env.SSL_BASE_PATH || path.join(__dirname, '..', '..', 'ssl'),
    },

    // CORS
    FRONTEND_URL: getEnvVar('FRONTEND_URL', 'http://localhost:3000'),
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [],

    // WhatsApp API
    WUZAPI: {
        BASE_URL: getEnvVar('WUZAPI'),
        TOKEN: getEnvVar('WUZAPI_Token'),
        TIMEOUT_MS: getEnvNumber('WUZAPI_TIMEOUT_MS', 30000),
    },

    // File Upload Limits
    UPLOAD: {
        MAX_FILE_SIZE_MB: getEnvNumber('MAX_FILE_SIZE_MB', 50),
        MAX_FILE_SIZE_BYTES: getEnvNumber('MAX_FILE_SIZE_MB', 50) * 1024 * 1024,
        ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/ogg'],
        ALLOWED_AUDIO_TYPES: ['audio/ogg', 'audio/mpeg', 'audio/webm', 'audio/wav'],
    },

    // Rate Limiting
    RATE_LIMIT: {
        WINDOW_MS: getEnvNumber('RATE_LIMIT_WINDOW_MS', 60000), // 1 minute
        MAX_REQUESTS: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
        SOCKET_MAX_EVENTS_PER_MINUTE: getEnvNumber('SOCKET_RATE_LIMIT', 60),
    },

    // Pagination
    PAGINATION: {
        DEFAULT_LIMIT: 25,
        MAX_LIMIT: 100,
        MIN_LIMIT: 1,
    },

    // Paths
    PATHS: {
        IMAGES: path.join(__dirname, '..', '..', 'imgs'),
        VIDEOS: path.join(__dirname, '..', '..', 'video'),
        AUDIO: path.join(__dirname, '..', '..', 'audio'),
        DOCUMENTS: path.join(__dirname, '..', '..', 'docs'),
    },

    // Timezone
    TIMEZONE_OFFSET_HOURS: getEnvNumber('TIMEZONE_OFFSET_HOURS', 0),

    // Debug
    DEBUG_API_PUBLIC: getEnvBoolean('DEBUG_API_PUBLIC', false),
    LOG_LEVEL: getEnvVar('LOG_LEVEL', 'info'),
} as const;

// Validate critical configuration on startup
export function validateConfig(): void {
    const errors: string[] = [];

    if (!CONFIG.WUZAPI.BASE_URL.startsWith('http')) {
        errors.push('WUZAPI must be a valid HTTP(S) URL');
    }

    if (CONFIG.UPLOAD.MAX_FILE_SIZE_MB > 200) {
        errors.push('MAX_FILE_SIZE_MB should not exceed 200MB');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}
