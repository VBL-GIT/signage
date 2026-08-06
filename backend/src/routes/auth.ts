import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller';

const router = Router();

router.post('/login', validate(z.object({ email: z.string().email(), password: z.string().min(6) })), login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me as any);
router.post('/forgot-password', validate(z.object({ email: z.string().email() })), forgotPassword);
router.post('/reset-password', validate(z.object({
  token: z.string().min(1),
  password: z.string().min(6),
})), resetPassword);

export default router;
