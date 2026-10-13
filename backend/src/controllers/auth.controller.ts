import { Request, Response } from 'express';
import { pool } from '../config/db';
import {
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
} from '../services/auth.service';

import { getEffectivePrivileges } from '../auth/privileges';
import { AuthRequest } from '../middleware/auth';

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  // Case-insensitive email match — phones/clients normalize casing inconsistently,
  // and emails are case-insensitive by convention.
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE lower(email) = lower($1) AND is_active = true',
    [String(email).trim()]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const payload = { id: user.id, role: user.role, email: user.email, vendor_id: user.vendor_id ?? null };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(user.id, refreshToken);
  const privileges = await getEffectivePrivileges({ id: user.id, role: user.role });
  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      name: user.name,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      email: user.email,
      role: user.role,
      vendor_id: user.vendor_id ?? null,
      privileges,
    },
  });
}

// Current user + freshly-resolved privileges (used by the web console on load).
export async function me(req: AuthRequest, res: Response) {
  const u = req.user!;
  const privileges = await getEffectivePrivileges({ id: u.id, role: u.role });
  res.json({ id: u.id, email: u.email, role: u.role, vendor_id: u.vendor_id, privileges });
}

export async function refresh(req: Request, res: Response) {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    res.status(400).json({ error: 'refresh_token required' });
    return;
  }
  const record = await validateRefreshToken(refresh_token);
  if (!record) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }
  const payload = { id: record.user_id, role: record.role, email: record.email, vendor_id: record.vendor_id ?? null };
  const accessToken = generateAccessToken(payload);
  res.json({ access_token: accessToken });
}

export async function logout(req: Request, res: Response) {
  const { refresh_token } = req.body;
  if (refresh_token) {
    await revokeRefreshToken(refresh_token);
  }
  res.json({ message: 'Logged out' });
}

/**
 * Forgot password: files a request for an administrator, who sets a new password
 * on the web console and passes it on. Nobody can change a password themselves.
 *
 * Always answers the same generic message whether or not the account exists, so
 * the endpoint cannot be used to discover which emails have accounts. One open
 * request per account: asking again refreshes it.
 */
export async function forgotPassword(req: Request, res: Response) {
  const { email, name, mobile } = req.body as { email: string; name?: string; mobile?: string };
  const GENERIC_MSG = 'Your request has been sent to the administrator. They will contact you with a new password.';

  const { rows } = await pool.query(
    'SELECT id FROM users WHERE lower(email) = lower($1) AND is_active = true',
    [String(email).trim()]
  );
  if (rows[0]) {
    await pool.query(
      `INSERT INTO password_requests (user_id, entered_name, entered_mobile)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) WHERE status = 'pending'
       DO UPDATE SET entered_name = EXCLUDED.entered_name, entered_mobile = EXCLUDED.entered_mobile, created_at = NOW()`,
      [rows[0].id, name?.trim() || null, mobile?.trim() || null]
    );
  }
  res.json({ message: GENERIC_MSG });
}

/** The emailed reset link is retired — passwords are set by an administrator only. */
export async function resetPassword(_req: Request, res: Response) {
  res.status(410).json({ error: 'Password reset links are no longer used. Ask your administrator to set a new password.' });
}
