"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const KeycloakAdminHelper_1 = require("../KeycloakAdminHelper");
const router = (0, express_1.Router)();
/**
 * Middleware to check if user has admin role
 */
const requireAdmin = (req, res, next) => {
    const kauth = req.kauth;
    if (!kauth || !kauth.grant) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = kauth.grant.access_token;
    const roles = token?.content?.realm_access?.roles || [];
    if (!roles.includes('admin') && !roles.includes('user-manager')) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
};
/**
 * GET /api/users - Get all users
 */
router.get('/', requireAdmin, async (req, res) => {
    try {
        const { search, first, max } = req.query;
        const users = await KeycloakAdminHelper_1.keycloakAdmin.getUsers({
            search: search,
            first: first ? parseInt(first) : 0,
            max: max ? parseInt(max) : 100,
        });
        res.json({ users });
    }
    catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch users' });
    }
});
/**
 * GET /api/users/count - Get user count
 */
router.get('/count', requireAdmin, async (req, res) => {
    try {
        const count = await KeycloakAdminHelper_1.keycloakAdmin.getUserCount();
        res.json({ count });
    }
    catch (error) {
        console.error('Error getting user count:', error);
        res.status(500).json({ error: error.message || 'Failed to get user count' });
    }
});
/**
 * GET /api/users/:userId - Get user by ID
 */
router.get('/:userId', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await KeycloakAdminHelper_1.keycloakAdmin.getUserById(userId);
        res.json({ user });
    }
    catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user' });
    }
});
/**
 * POST /api/users - Create a new user
 */
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { username, email, firstName, lastName, password, temporary } = req.body;
        if (!username || !email) {
            return res.status(400).json({ error: 'Username and email are required' });
        }
        const userData = {
            username,
            email,
            firstName: firstName || '',
            lastName: lastName || '',
            enabled: true,
            emailVerified: false,
        };
        // Add password if provided
        if (password) {
            userData.credentials = [
                {
                    type: 'password',
                    value: password,
                    temporary: temporary || false,
                },
            ];
        }
        const userId = await KeycloakAdminHelper_1.keycloakAdmin.createUser(userData);
        res.status(201).json({
            message: 'User created successfully',
            userId
        });
    }
    catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: error.message || 'Failed to create user' });
    }
});
/**
 * PUT /api/users/:userId - Update a user
 */
router.put('/:userId', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { email, firstName, lastName, enabled, emailVerified } = req.body;
        const updateData = {};
        if (email !== undefined)
            updateData.email = email;
        if (firstName !== undefined)
            updateData.firstName = firstName;
        if (lastName !== undefined)
            updateData.lastName = lastName;
        if (enabled !== undefined)
            updateData.enabled = enabled;
        if (emailVerified !== undefined)
            updateData.emailVerified = emailVerified;
        await KeycloakAdminHelper_1.keycloakAdmin.updateUser(userId, updateData);
        res.json({ message: 'User updated successfully' });
    }
    catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: error.message || 'Failed to update user' });
    }
});
/**
 * DELETE /api/users/:userId - Delete a user
 */
router.delete('/:userId', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        await KeycloakAdminHelper_1.keycloakAdmin.deleteUser(userId);
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: error.message || 'Failed to delete user' });
    }
});
/**
 * POST /api/users/:userId/reset-password - Reset user password
 */
router.post('/:userId/reset-password', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { password, temporary } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        await KeycloakAdminHelper_1.keycloakAdmin.resetPassword(userId, password, temporary || false);
        res.json({ message: 'Password reset successfully' });
    }
    catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ error: error.message || 'Failed to reset password' });
    }
});
/**
 * GET /api/users/:userId/roles - Get user's roles
 */
router.get('/:userId/roles', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const roles = await KeycloakAdminHelper_1.keycloakAdmin.getUserRealmRoles(userId);
        res.json({ roles });
    }
    catch (error) {
        console.error('Error fetching user roles:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user roles' });
    }
});
/**
 * GET /api/users/:userId/available-roles - Get available roles for user
 */
router.get('/:userId/available-roles', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const roles = await KeycloakAdminHelper_1.keycloakAdmin.getAvailableRealmRoles(userId);
        res.json({ roles });
    }
    catch (error) {
        console.error('Error fetching available roles:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch available roles' });
    }
});
/**
 * POST /api/users/:userId/roles - Add roles to user
 */
router.post('/:userId/roles', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { roles } = req.body;
        if (!roles || !Array.isArray(roles) || roles.length === 0) {
            return res.status(400).json({ error: 'Roles array is required' });
        }
        await KeycloakAdminHelper_1.keycloakAdmin.addRealmRolesToUser(userId, roles);
        res.json({ message: 'Roles added successfully' });
    }
    catch (error) {
        console.error('Error adding roles to user:', error);
        res.status(500).json({ error: error.message || 'Failed to add roles to user' });
    }
});
/**
 * DELETE /api/users/:userId/roles - Remove roles from user
 */
router.delete('/:userId/roles', requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { roles } = req.body;
        if (!roles || !Array.isArray(roles) || roles.length === 0) {
            return res.status(400).json({ error: 'Roles array is required' });
        }
        await KeycloakAdminHelper_1.keycloakAdmin.removeRealmRolesFromUser(userId, roles);
        res.json({ message: 'Roles removed successfully' });
    }
    catch (error) {
        console.error('Error removing roles from user:', error);
        res.status(500).json({ error: error.message || 'Failed to remove roles from user' });
    }
});
/**
 * GET /api/roles - Get all realm roles
 */
router.get('/roles/all', requireAdmin, async (req, res) => {
    try {
        const roles = await KeycloakAdminHelper_1.keycloakAdmin.getRealmRoles();
        res.json({ roles });
    }
    catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch roles' });
    }
});
/**
 * POST /api/roles - Create a new role
 */
router.post('/roles', requireAdmin, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Role name is required' });
        }
        await KeycloakAdminHelper_1.keycloakAdmin.createRole(name, description);
        res.status(201).json({ message: 'Role created successfully' });
    }
    catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({ error: error.message || 'Failed to create role' });
    }
});
exports.default = router;
