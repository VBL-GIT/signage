import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { listImages } from '../controllers/images.controller';

const router = Router();
router.use(authenticate);
// RJCorp head office only, per the Images tab this feeds.
router.use(requireRole('rjcorp_admin', 'rjcorp_user'));

router.get('/', listImages as any);

export default router;
