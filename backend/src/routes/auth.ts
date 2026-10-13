import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { forgotPasswordLimiter } from '../middleware/rateLimit';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller';

const router = Router();

router.post('/login', validate(z.object({ email: z.string().email(), password: z.string().min(6) })), login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me as any);
router.post('/forgot-password', forgotPasswordLimiter, validate(z.object({
  email: z.string().email(),
  name: z.string().max(255).optional(),
  mobile: z.string().max(30).optional(),
})), forgotPassword);
// Retired: answers 410. Kept so old emailed links fail with a clear message.
router.post('/reset-password', resetPassword);

export default router;
