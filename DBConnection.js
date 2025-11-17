"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = getConnection;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'wuzapi',
    password: 'q',
    port: 5432,
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
