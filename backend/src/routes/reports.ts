import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { requirePrivilege } from '../auth/privileges';
import {
  exportTasksReport, exportApprovalsReport, exportStoresReport,
  exportVendorsReport, exportEmployeesReport, exportBrandsReport, exportArtworksReport,
} from '../controllers/reports.controller';

const router = Router();
router.use(authenticate);
// Web-only feature — employees don't have web access, so gate to the roles that do.
router.use(requireRole('rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user'));

router.get('/tasks', exportTasksReport as any);
router.get('/approvals', exportApprovalsReport as any);
router.get('/stores', exportStoresReport as any);
// Gated per the same privilege each Manage tab already requires to view the list.
router.get('/vendors', requirePrivilege('vendor.status'), exportVendorsReport as any);
router.get('/employees', requirePrivilege('user.status'), exportEmployeesReport as any);
router.get('/brands', requirePrivilege('artwork.manage'), exportBrandsReport as any);
router.get('/artworks', requirePrivilege('artwork.manage'), exportArtworksReport as any);

export default router;
