import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../src/utils/auth';

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2) {
            const [scheme, bearerToken] = parts;
            if (/^Bearer$/i.test(scheme) && bearerToken && bearerToken.trim().length > 0) {
                token = bearerToken.trim();
            }
        }
    }

    if (!token) {
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
            const cookies = cookieHeader.split(';').map((c) => c.trim());
            const authCookie = cookies.find((cookie) => cookie.startsWith('auth_token='));
            if (authCookie) {
                const cookieToken = authCookie.substring('auth_token='.length);
                if (cookieToken) {
                    token = decodeURIComponent(cookieToken);
                }
            }
        }
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

export const adminMiddleware = (req: Request, res: Response, next: NextFunction) => {
    authMiddleware(req, res, () => {
        if (req.user?.role === 'admin' || req.user?.role === 'user-manager') {
            next();
        } else {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
        }
    });
};
