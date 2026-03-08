"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = exports.authMiddleware = void 0;
const auth_1 = require("../src/utils/auth");
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;
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
        const decoded = (0, auth_1.verifyToken)(token);
        req.user = decoded;
        return next();
    }
    catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};
exports.authMiddleware = authMiddleware;
const adminMiddleware = (req, res, next) => {
    (0, exports.authMiddleware)(req, res, () => {
        if (req.user?.role === 'admin' || req.user?.role === 'user-manager') {
            next();
        }
        else {
            res.status(403).json({ error: 'Forbidden: Admin access required' });
        }
    });
};
exports.adminMiddleware = adminMiddleware;
