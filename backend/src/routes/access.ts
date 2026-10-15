import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { accessOverview } from '../controllers/access.controller';
import { listAudit, listAuditActors } from '../controllers/audit.controller';

const router = Router();
// RJ admin only — deliberately not a grantable privilege, so no custom role can ever
// receive it.
router.use(authenticate, requireRole('rjcorp_admin'));

router.get('/overview', accessOverview as any);
router.get('/audit', listAudit as any);
router.get('/audit/actors', listAuditActors as any);

export default router;
