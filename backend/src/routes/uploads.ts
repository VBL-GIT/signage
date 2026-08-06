import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { presign } from '../controllers/uploads.controller';

const router = Router();
router.use(authenticate);
router.post('/presign', validate(z.object({ filename: z.string().min(1), content_type: z.string().min(1) })), presign as any);

export default router;
