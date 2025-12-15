import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/login', AuthController.login as any);
router.post('/register', AuthController.register as any);
router.get('/me', authMiddleware, AuthController.me as any);

export default router;
