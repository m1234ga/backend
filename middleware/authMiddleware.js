"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = exports.authMiddleware = void 0;
const auth_1 = require("../src/utils/auth");
const authMiddleware = (req, res, next) => {
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
