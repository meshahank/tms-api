import { Router } from 'express';
import { login, logout } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/login', login);
router.post('/logout', protect, logout);

export const authRoutes = router;
