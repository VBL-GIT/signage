import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { writeAudit } from '../services/audit.service';

/**
 * Records every successful change (POST/PUT/PATCH/DELETE) made by a non-employee
 * account, against the account's email. Mount AFTER `authenticate`.
 *
 * Employee field submissions are not logged here: they are already attributed to
 * the employee in task_steps (the append-only record of field work).
 */
export function auditTrail(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
  if (!req.user || req.user.role === 'employee') { next(); return; }

  let resBody: unknown = null;
  const json = res.json.bind(res);
  res.json = ((b: unknown) => { resBody = b; return json(b); }) as typeof res.json;

  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.route) return;
    void writeAudit({
      actorId: req.user!.id,
      method: req.method,
      routePattern: `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` || '/',
      entityId: (req.params.id as string | undefined) ?? null,
      body: req.body,
      resBody,
      ip: req.ip ?? null,
    });
  });
  next();
}
