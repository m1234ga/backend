import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import { CONFIG } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('RateLimiter');

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

/**
 * Rate limiter for HTTP requests
 */
class HttpRateLimiter {
    private requests: Map<string, RateLimitEntry> = new Map();
    private windowMs: number;
    private maxRequests: number;

    constructor(windowMs: number = CONFIG.RATE_LIMIT.WINDOW_MS, maxRequests: number = CONFIG.RATE_LIMIT.MAX_REQUESTS) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;

        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.requests.entries()) {
            if (now > entry.resetTime) {
                this.requests.delete(key);
            }
        }
    }

    private getKey(req: Request): string {
        // Use IP address as key, fallback to 'unknown'
        return req.ip || req.socket.remoteAddress || 'unknown';
    }

    middleware = (req: Request, res: Response, next: NextFunction): void => {
        const key = this.getKey(req);
        const now = Date.now();
        const entry = this.requests.get(key);

        if (!entry || now > entry.resetTime) {
            // New window
            this.requests.set(key, {
                count: 1,
                resetTime: now + this.windowMs,
            });
            return next();
        }

        if (entry.count >= this.maxRequests) {
            logger.security('Rate limit exceeded', { ip: key, count: entry.count });
            res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil((entry.resetTime - now) / 1000),
            });
            return;
        }

        entry.count++;
        next();
    };
}

/**
 * Rate limiter for Socket.IO events
 */
class SocketRateLimiter {
    private events: Map<string, RateLimitEntry> = new Map();
    private windowMs: number;
    private maxEvents: number;

    constructor(windowMs: number = 60000, maxEvents: number = CONFIG.RATE_LIMIT.SOCKET_MAX_EVENTS_PER_MINUTE) {
        this.windowMs = windowMs;
        this.maxEvents = maxEvents;

        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.events.entries()) {
            if (now > entry.resetTime) {
                this.events.delete(key);
            }
        }
    }

    private getKey(socket: Socket, eventName: string): string {
        return `${socket.id}:${eventName}`;
    }

    /**
     * Check if socket event should be allowed
     * Returns true if allowed, false if rate limited
     */
    checkLimit(socket: Socket, eventName: string): boolean {
        const key = this.getKey(socket, eventName);
        const now = Date.now();
        const entry = this.events.get(key);

        if (!entry || now > entry.resetTime) {
            // New window
            this.events.set(key, {
                count: 1,
                resetTime: now + this.windowMs,
            });
            return true;
        }

        if (entry.count >= this.maxEvents) {
            logger.security('Socket rate limit exceeded', {
                socketId: socket.id,
                event: eventName,
                count: entry.count
            });
            return false;
        }

        entry.count++;
        return true;
    }

    /**
     * Middleware wrapper for socket events
     */
    middleware(eventName: string, handler: Function) {
        return async (socket: Socket, ...args: any[]) => {
            if (!this.checkLimit(socket, eventName)) {
                socket.emit('rate_limit_exceeded', {
                    event: eventName,
                    message: 'Too many requests, please slow down',
                });
                return;
            }

            return handler(socket, ...args);
        };
    }
}

// Export instances
export const httpRateLimiter = new HttpRateLimiter();
export const socketRateLimiter = new SocketRateLimiter();
