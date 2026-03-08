"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketRateLimiter = exports.httpRateLimiter = void 0;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const logger = (0, logger_1.createLogger)('RateLimiter');
/**
 * Rate limiter for HTTP requests
 */
class HttpRateLimiter {
    requests = new Map();
    windowMs;
    maxRequests;
    constructor(windowMs = config_1.CONFIG.RATE_LIMIT.WINDOW_MS, maxRequests = config_1.CONFIG.RATE_LIMIT.MAX_REQUESTS) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.requests.entries()) {
            if (now > entry.resetTime) {
                this.requests.delete(key);
            }
        }
    }
    getKey(req) {
        // Use IP address as key, fallback to 'unknown'
        return req.ip || req.socket.remoteAddress || 'unknown';
    }
    middleware = (req, res, next) => {
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
    events = new Map();
    windowMs;
    maxEvents;
    constructor(windowMs = 60000, maxEvents = config_1.CONFIG.RATE_LIMIT.SOCKET_MAX_EVENTS_PER_MINUTE) {
        this.windowMs = windowMs;
        this.maxEvents = maxEvents;
        // Cleanup old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.events.entries()) {
            if (now > entry.resetTime) {
                this.events.delete(key);
            }
        }
    }
    getKey(socket, eventName) {
        return `${socket.id}:${eventName}`;
    }
    /**
     * Check if socket event should be allowed
     * Returns true if allowed, false if rate limited
     */
    checkLimit(socket, eventName) {
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
    middleware(eventName, handler) {
        return async (socket, ...args) => {
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
exports.httpRateLimiter = new HttpRateLimiter();
exports.socketRateLimiter = new SocketRateLimiter();
