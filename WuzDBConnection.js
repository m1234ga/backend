"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const connectionString = process.env.WUZ_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Missing database URL: set WUZ_DATABASE_URL (or DATABASE_URL fallback)');
}
const wuzPool = new pg_1.Pool({
    connectionString,
});
exports.default = wuzPool;
