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

    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2) {
        return res.status(401).json({ error: 'Token error' });
    }

    const [scheme, token] = parts;

    if (!/^Bearer$/i.test(scheme)) {
        return res.status(401).json({ error: 'Token malformatted' });
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
