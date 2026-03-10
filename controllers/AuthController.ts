import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../DBConnection';
import { hashPassword, comparePassword, generateToken } from '../src/utils/auth';

const setAuthCookie = (res: Response, token: string) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSite = isProduction ? 'none' : 'lax';
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite,
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
    });
};

const clearAuthCookie = (res: Response) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSite = isProduction ? 'none' : 'lax';
    res.clearCookie('auth_token', {
        httpOnly: true,
        secure: isProduction,
        sameSite,
        path: '/',
    });
};

export class AuthController {
    static async register(req: Request, res: Response) {
        const { username, email, password, firstName, lastName } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            // Check if user exists
            const userCheck = await pool.query(
                'SELECT id FROM app_users WHERE username = $1 OR email = $2',
                [username, email]
            );

            if (userCheck.rows.length > 0) {
                return res.status(409).json({ error: 'User already exists' });
            }

            const id = uuidv4();
            const hashedPassword = await hashPassword(password);

            await pool.query(
                `INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'user')`,
                [id, username, email, hashedPassword, firstName || '', lastName || '']
            );

            // Login immediately
            const token = generateToken({ userId: id, username, role: 'user' });
            await pool.query(
                'UPDATE app_users SET is_active = true, updated_at = NOW() WHERE id = $1',
                [id]
            );
            setAuthCookie(res, token);

            res.status(201).json({
                message: 'User created successfully',
                token,
                user: { id, username, email, firstName, lastName, role: 'user' }
            });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async login(req: Request, res: Response) {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        try {
            const result = await pool.query(
                'SELECT * FROM app_users WHERE username = $1',
                [username]
            );

            console.log('Login attempt for user:', username);
            const user = result.rows[0];

            if (!user) {
                console.log('User not found:', username);
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            console.log('User found, comparing password...');
            const isMatch = await comparePassword(password, user.password_hash);

            if (!isMatch) {
                console.log('Password mismatch for user:', username);
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            console.log('Login successful for user:', username);

            const token = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role
            });

            await pool.query(
                'UPDATE app_users SET is_active = true, updated_at = NOW() WHERE id = $1',
                [user.id]
            );

            setAuthCookie(res, token);

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
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async me(req: Request, res: Response) {
        try {
            if (!req.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const result = await pool.query(
                'SELECT id, username, email, first_name, last_name, role FROM app_users WHERE id = $1',
                [req.user.userId]
            );

            const user = result.rows[0];

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const token = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role,
            });

            res.json({
                token,
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role
            });
        } catch (error) {
            console.error('Me error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    static async logout(req: Request, res: Response) {
        try {
            if (req.user?.userId) {
                await pool.query(
                    'UPDATE app_users SET is_active = false, updated_at = NOW() WHERE id = $1',
                    [req.user.userId]
                );
            }
        } catch (error) {
            console.error('Logout state update error:', error);
        }
        clearAuthCookie(res);
        res.status(200).json({ message: 'Logged out' });
    }
}
