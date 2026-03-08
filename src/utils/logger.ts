import { CONFIG } from '../config';
import { adjustToConfiguredTimezone } from './timezone';

export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    error: LogLevel.ERROR,
    warn: LogLevel.WARN,
    info: LogLevel.INFO,
    debug: LogLevel.DEBUG,
};

class Logger {
    private level: LogLevel;
    private context: string;

    constructor(context: string = 'App') {
        this.context = context;
        this.level = LOG_LEVEL_MAP[CONFIG.LOG_LEVEL] || LogLevel.INFO;
    }

    private shouldLog(level: LogLevel): boolean {
        return level <= this.level;
    }

    private formatMessage(level: string, message: string, meta?: Record<string, any>): string {
        const timestamp = adjustToConfiguredTimezone(new Date()).toString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level}] [${this.context}] ${message}${metaStr}`;
    }

    error(message: string, error?: Error | unknown, meta?: Record<string, any>): void {
        if (!this.shouldLog(LogLevel.ERROR)) return;

        const errorMeta = error instanceof Error
            ? { ...meta, error: error.message, stack: error.stack }
            : { ...meta, error };

        console.error(this.formatMessage('ERROR', message, errorMeta));
    }

    warn(message: string, meta?: Record<string, any>): void {
        if (!this.shouldLog(LogLevel.WARN)) return;
        console.warn(this.formatMessage('WARN', message, meta));
    }

    info(message: string, meta?: Record<string, any>): void {
        if (!this.shouldLog(LogLevel.INFO)) return;
        console.log(this.formatMessage('INFO', message, meta));
    }

    debug(message: string, meta?: Record<string, any>): void {
        if (!this.shouldLog(LogLevel.DEBUG)) return;
        console.log(this.formatMessage('DEBUG', message, meta));
    }

    // Specialized logging methods
    apiRequest(method: string, url: string, meta?: Record<string, any>): void {
        this.info(`API Request: ${method} ${url}`, meta);
    }

    apiResponse(method: string, url: string, status: number, duration?: number): void {
        const meta = duration ? { status, durationMs: duration } : { status };
        this.info(`API Response: ${method} ${url}`, meta);
    }

    socketEvent(event: string, socketId: string, meta?: Record<string, any>): void {
        this.debug(`Socket Event: ${event}`, { socketId, ...meta });
    }

    dbQuery(query: string, duration?: number): void {
        const meta = duration ? { durationMs: duration } : undefined;
        this.debug(`DB Query: ${query.substring(0, 100)}...`, meta);
    }

    security(message: string, meta?: Record<string, any>): void {
        this.warn(`SECURITY: ${message}`, meta);
    }
}

// Create logger instances for different modules
export const createLogger = (context: string): Logger => new Logger(context);

// Default logger
export const logger = new Logger('App');
