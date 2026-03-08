"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.createLogger = exports.LogLevel = void 0;
const config_1 = require("../config");
const timezone_1 = require("./timezone");
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["ERROR"] = 0] = "ERROR";
    LogLevel[LogLevel["WARN"] = 1] = "WARN";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["DEBUG"] = 3] = "DEBUG";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
const LOG_LEVEL_MAP = {
    error: LogLevel.ERROR,
    warn: LogLevel.WARN,
    info: LogLevel.INFO,
    debug: LogLevel.DEBUG,
};
class Logger {
    level;
    context;
    constructor(context = 'App') {
        this.context = context;
        this.level = LOG_LEVEL_MAP[config_1.CONFIG.LOG_LEVEL] || LogLevel.INFO;
    }
    shouldLog(level) {
        return level <= this.level;
    }
    formatMessage(level, message, meta) {
        const timestamp = (0, timezone_1.adjustToConfiguredTimezone)(new Date()).toString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] [${level}] [${this.context}] ${message}${metaStr}`;
    }
    error(message, error, meta) {
        if (!this.shouldLog(LogLevel.ERROR))
            return;
        const errorMeta = error instanceof Error
            ? { ...meta, error: error.message, stack: error.stack }
            : { ...meta, error };
        console.error(this.formatMessage('ERROR', message, errorMeta));
    }
    warn(message, meta) {
        if (!this.shouldLog(LogLevel.WARN))
            return;
        console.warn(this.formatMessage('WARN', message, meta));
    }
    info(message, meta) {
        if (!this.shouldLog(LogLevel.INFO))
            return;
        console.log(this.formatMessage('INFO', message, meta));
    }
    debug(message, meta) {
        if (!this.shouldLog(LogLevel.DEBUG))
            return;
        console.log(this.formatMessage('DEBUG', message, meta));
    }
    // Specialized logging methods
    apiRequest(method, url, meta) {
        this.info(`API Request: ${method} ${url}`, meta);
    }
    apiResponse(method, url, status, duration) {
        const meta = duration ? { status, durationMs: duration } : { status };
        this.info(`API Response: ${method} ${url}`, meta);
    }
    socketEvent(event, socketId, meta) {
        this.debug(`Socket Event: ${event}`, { socketId, ...meta });
    }
    dbQuery(query, duration) {
        const meta = duration ? { durationMs: duration } : undefined;
        this.debug(`DB Query: ${query.substring(0, 100)}...`, meta);
    }
    security(message, meta) {
        this.warn(`SECURITY: ${message}`, meta);
    }
}
// Create logger instances for different modules
const createLogger = (context) => new Logger(context);
exports.createLogger = createLogger;
// Default logger
exports.logger = new Logger('App');
