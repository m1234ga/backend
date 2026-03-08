"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DBConnection_1 = __importDefault(require("./DBConnection"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
async function createAdmin() {
    const username = 'admin';
    const password = 'admin';
    const email = 'admin@example.com';
    try {
        const userCheck = await DBConnection_1.default.query('SELECT id FROM app_users WHERE username = $1', [username]);
        if (userCheck.rows.length > 0) {
            console.log('Admin user already exists.');
            return;
        }
        const id = (0, uuid_1.v4)();
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        await DBConnection_1.default.query(`INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, username, email, hashedPassword, 'Admin', 'User', 'admin']);
        console.log('✅ Admin user created successfully!');
        console.log('Username: admin');
        console.log('Password: admin');
    }
    catch (error) {
        console.error('Error creating admin user:', error);
    }
    finally {
        process.exit();
    }
}
createAdmin();
