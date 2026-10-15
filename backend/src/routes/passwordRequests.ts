import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { auditTrail } from '../middleware/audit';
import { validate } from '../middleware/validate';
import {
  listPasswordRequests, pendingPasswordRequestCount, resolvePasswordRequest, dismissPasswordRequest,
} from '../controllers/passwordRequests.controller';

const router = Router();
router.use(authenticate, requireRole('rjcorp_admin', 'vendor_admin'), auditTrail);

router.get('/', listPasswordRequests as any);
router.get('/count', pendingPasswordRequestCount as any);
router.post('/:id/resolve', validate(z.object({ password: z.string().min(8).max(128).optional() })), resolvePasswordRequest as any);
router.post('/:id/dismiss', dismissPasswordRequest as any);

export default router;
