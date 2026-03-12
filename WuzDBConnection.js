"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const connectionString = process.env.WUZ_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('Missing database URL: set WUZ_DATABASE_URL (or DATABASE_URL fallback)');
}
const wuzPool = new pg_1.Pool({
    connectionString,
});
exports.default = wuzPool;
