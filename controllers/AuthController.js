"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const uuid_1 = require("uuid");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const auth_1 = require("../src/utils/auth");
class AuthController {
    static async register(req, res) {
        const { username, email, password, firstName, lastName } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        try {
            // Check if user exists
            const userCheck = await DBConnection_1.default.query('SELECT id FROM app_users WHERE username = $1 OR email = $2', [username, email]);
            if (userCheck.rows.length > 0) {
                return res.status(409).json({ error: 'User already exists' });
            }
            const id = (0, uuid_1.v4)();
            const hashedPassword = await (0, auth_1.hashPassword)(password);
            await DBConnection_1.default.query(`INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'user')`, [id, username, email, hashedPassword, firstName || '', lastName || '']);
            // Login immediately
            const token = (0, auth_1.generateToken)({ userId: id, username, role: 'user' });
            res.status(201).json({
                message: 'User created successfully',
                token,
                user: { id, username, email, firstName, lastName, role: 'user' }
            });
        }
        catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    static async login(req, res) {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        try {
            const result = await DBConnection_1.default.query('SELECT * FROM app_users WHERE username = $1', [username]);
            const user = result.rows[0];
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const isMatch = await (0, auth_1.comparePassword)(password, user.password_hash);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const token = (0, auth_1.generateToken)({
                userId: user.id,
                username: user.username,
                role: user.role
            });
            res.json({
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    role: user.role
                }
            });
        }
        catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    static async me(req, res) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            const result = await DBConnection_1.default.query('SELECT id, username, email, first_name, last_name, role FROM app_users WHERE id = $1', [req.user.userId]);
            const user = result.rows[0];
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json({
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role
            });
        }
        catch (error) {
            console.error('Me error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
exports.AuthController = AuthController;
