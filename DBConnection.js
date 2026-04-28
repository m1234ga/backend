"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = getConnection;
const pg_1 = require("pg");
const dotenv_1 = require("dotenv");
const path_1 = __importDefault(require("path"));
const envPaths = [
    path_1.default.join(__dirname, '.env'),
    path_1.default.join(process.cwd(), 'backend', '.env'),
    path_1.default.join(process.cwd(), '.env'),
];
for (const envPath of envPaths) {
    const result = (0, dotenv_1.config)({ path: envPath });
    if (!result.error) {
        break;
    }
}
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Increased from default 10 for better concurrency
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000, // 30s timeout per query
});
// Helper to provide compatibility with existing code that expects getConnection().execute()
async function getConnection() {
    return {
        // execute(sql, params?) returns [rows, fields] similar to mysql2/promise
        execute: async (sql, params) => {
            const res = await pool.query(sql, params || []);
            return [res.rows, res.fields];
        },
        query: async (sql, params) => {
            return pool.query(sql, params || []);
        }
    };
}
exports.default = pool;
