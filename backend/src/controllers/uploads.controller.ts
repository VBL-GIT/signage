import { Response } from 'express';
import { generatePresignedUploadUrl } from '../services/storage.service';
import { AuthRequest } from '../middleware/auth';

export async function presign(req: AuthRequest, res: Response) {
  const { filename, content_type } = req.body;
  const result = await generatePresignedUploadUrl(filename, content_type);
  res.json(result);
}
