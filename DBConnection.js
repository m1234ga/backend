"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = getConnection;
const pg_1 = require("pg");
const dotenv_1 = require("dotenv");
const path_1 = require("path");
const envPaths = [
    (0, path_1.join)(__dirname, '.env'),
    (0, path_1.join)(process.cwd(), 'backend', '.env'),
    (0, path_1.join)(process.cwd(), '.env'),
];
for (const envPath of envPaths) {
    const result = (0, dotenv_1.config)({ path: envPath });
    if (!result.error) {
        break;
    }
}
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
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
