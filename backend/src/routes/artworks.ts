import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePrivilege } from '../auth/privileges';
import { listArtworks, createArtwork, updateArtwork } from '../controllers/artworks.controller';

const router = Router();
router.use(authenticate);

router.get('/', listArtworks as any);

router.post('/',
  requirePrivilege('artwork.manage'),
  validate(z.object({ brand_id: z.string().uuid(), name: z.string().min(1).max(120), image_url: z.string().url().optional() })),
  createArtwork as any);

router.patch('/:id',
  requirePrivilege('artwork.manage'),
  validate(z.object({
    name: z.string().min(1).max(120).optional(),
    is_active: z.boolean().optional(),
    image_url: z.string().url().nullable().optional(),
  })),
  updateArtwork as any);

export default router;
