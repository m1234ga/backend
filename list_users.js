"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DBConnection_1 = __importDefault(require("./DBConnection"));
async function listUsers() {
    try {
        const res = await DBConnection_1.default.query('SELECT username, email, role FROM app_users');
        console.log('Users in database:');
        console.table(res.rows);
    }
    catch (error) {
        console.error('Error listing users:', error);
    }
    finally {
        process.exit();
    }
}
listUsers();
