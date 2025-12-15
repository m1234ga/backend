"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const DBConnection_1 = __importDefault(require("../DBConnection"));
const auth_1 = require("../src/utils/auth");
const router = (0, express_1.Router)();
// Middleware is applied in server.ts (adminMiddleware)
// Helper to check admin role internally if needed, but adminMiddleware handles it.
/**
 * GET /api/users - Get all users
 */
router.get('/', async (req, res) => {
    try {
        const { search, first, max } = req.query;
        let query = 'SELECT id, username, email, first_name as "firstName", last_name as "lastName", role, is_active as enabled FROM app_users';
        const params = [];
        if (search) {
            query += ' WHERE username ILIKE $1 OR email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1';
            params.push(`%${search}%`);
        }
        // Pagination
        const limit = max ? parseInt(max) : 100;
        const offset = first ? parseInt(first) : 0;
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await DBConnection_1.default.query(query, params);
        // Adapt to Keycloak-like response structure if frontend expects it
        res.json({ users: result.rows });
    }
    catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
/**
 * GET /api/users/count - Get user count
 */
router.get('/count', async (req, res) => {
    try {
        const result = await DBConnection_1.default.query('SELECT COUNT(*) FROM app_users');
        res.json({ count: parseInt(result.rows[0].count) });
    }
    catch (error) {
        console.error('Error getting user count:', error);
        res.status(500).json({ error: 'Failed to get user count' });
    }
});
/**
 * GET /api/users/:userId - Get user by ID
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await DBConnection_1.default.query('SELECT id, username, email, first_name as "firstName", last_name as "lastName", role, is_active as enabled FROM app_users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: result.rows[0] });
    }
    catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});
/**
 * POST /api/users - Create a new user
 */
router.post('/', async (req, res) => {
    try {
        const { username, email, firstName, lastName, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email and password are required' });
        }
        const id = (0, uuid_1.v4)();
        const hashedPassword = await (0, auth_1.hashPassword)(password);
        await DBConnection_1.default.query(`INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'user')`, [id, username, email, hashedPassword, firstName || '', lastName || '']);
        res.status(201).json({
            message: 'User created successfully',
            userId: id
        });
    }
    catch (error) {
        console.error('Error creating user:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
});
/**
 * PUT /api/users/:userId - Update a user
 */
router.put('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { email, firstName, lastName, enabled, role } = req.body; // Added role to update
        // Build dynamic update query
        let updates = [];
        let params = [userId];
        let idx = 2;
        if (email !== undefined) {
            updates.push(`email = $${idx++}`);
            params.push(email);
        }
        if (firstName !== undefined) {
            updates.push(`first_name = $${idx++}`);
            params.push(firstName);
        }
        if (lastName !== undefined) {
            updates.push(`last_name = $${idx++}`);
            params.push(lastName);
        }
        if (enabled !== undefined) {
            updates.push(`is_active = $${idx++}`);
            params.push(enabled);
        }
        if (role !== undefined) {
            updates.push(`role = $${idx++}`);
            params.push(role);
        }
        if (updates.length > 0) {
            await DBConnection_1.default.query(`UPDATE app_users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, params);
        }
        res.json({ message: 'User updated successfully' });
    }
    catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});
/**
 * DELETE /api/users/:userId - Delete a user
 */
router.delete('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        await DBConnection_1.default.query('DELETE FROM app_users WHERE id = $1', [userId]);
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
/**
 * POST /api/users/:userId/reset-password - Reset user password
 */
router.post('/:userId/reset-password', async (req, res) => {
    try {
        const { userId } = req.params;
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        const hashedPassword = await (0, auth_1.hashPassword)(password);
        await DBConnection_1.default.query('UPDATE app_users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);
        res.json({ message: 'Password reset successfully' });
    }
    catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});
/**
 * GET /api/users/:userId/roles - Get user's roles
 */
router.get('/:userId/roles', async (req, res) => {
    try {
        // We only have one role per user in app_users, but frontend expects Keycloak structure
        const { userId } = req.params;
        const result = await DBConnection_1.default.query('SELECT role FROM app_users WHERE id = $1', [userId]);
        if (result.rows.length === 0)
            return res.status(404).json({ error: 'User not found' });
        const role = result.rows[0].role;
        // Return as array of objects
        res.json({ roles: [{ name: role }] });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch user roles' });
    }
});
/**
 * GET /api/users/:userId/available-roles - Get available roles for user
 */
router.get('/:userId/available-roles', async (req, res) => {
    // Return hardcoded roles
    res.json({ roles: [{ name: 'user' }, { name: 'admin' }, { name: 'user-manager' }] });
});
/**
 * POST /api/users/:userId/roles - Add roles to user
 */
router.post('/:userId/roles', async (req, res) => {
    // In this simple model, we just update the single role.
    // If multiple roles are sent, we might take the first relevant one or ignore.
    // Let's assume we take the last one in the list or 'admin' if present.
    try {
        const { userId } = req.params;
        const { roles } = req.body; // Expects [{name: 'admin'}]
        if (!roles || !Array.isArray(roles))
            return res.status(400).json({ error: 'Invalid roles' });
        const newRole = roles.find((r) => r.name === 'admin' || r.name === 'user-manager') ? roles[0].name : 'user';
        await DBConnection_1.default.query('UPDATE app_users SET role = $1 WHERE id = $2', [newRole, userId]);
        res.json({ message: 'Roles updated (single role model)' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to add roles' });
    }
});
/**
 * DELETE /api/users/:userId/roles - Remove roles from user
 */
router.delete('/:userId/roles', async (req, res) => {
    // Demote to user if admin role is removed
    try {
        const { userId } = req.params;
        const { roles } = req.body;
        // If they are removing admin role, set to user.
        const removingAdmin = roles.some((r) => r.name === 'admin');
        if (removingAdmin) {
            await DBConnection_1.default.query("UPDATE app_users SET role = 'user' WHERE id = $1", [userId]);
        }
        res.json({ message: 'Roles removed' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to remove roles' });
    }
});
/**
 * GET /api/roles/all - Get all realm roles
 */
router.get('/roles/all', async (req, res) => {
    res.json({ roles: [{ name: 'user' }, { name: 'admin' }, { name: 'user-manager' }] });
});
// Create role endpoint - ignored as roles are static
router.post('/roles', async (req, res) => {
    res.status(201).json({ message: 'Role creation not supported in simple auth mode' });
});
exports.default = router;
