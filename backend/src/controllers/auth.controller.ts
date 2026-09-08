import { Request, Response } from 'express';
import { pool } from '../config/db';
import {
  verifyPassword,
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  createPasswordResetToken,
  validatePasswordResetToken,
  consumePasswordResetToken,
  buildResetUrl,
} from '../services/auth.service';
import { sendPasswordResetEmail, isEmailConfigured } from '../services/email.service';

import { getEffectivePrivileges } from '../auth/privileges';
import { AuthRequest } from '../middleware/auth';
import { sealPassword } from '../services/credential-vault';

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
 * Request a password reset link by email. Always responds with the same
 * generic message regardless of whether the account exists or email sending
 * is configured — this prevents leaking which addresses have accounts.
 */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as { email: string };
  const GENERIC_MSG = 'If an account exists for that email, a reset link has been sent.';

  const { rows } = await pool.query(
    'SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND is_active = true',
    [String(email).trim()]
  );
  const user = rows[0];
  if (user) {
    const token = await createPasswordResetToken(user.id);
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl: buildResetUrl(token) });
  }
  res.json({ message: GENERIC_MSG, email_configured: isEmailConfigured() });
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as { token: string; password: string };

  const record = await validatePasswordResetToken(token);
  if (!record) {
    res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    return;
  }

  const hash = await hashPassword(password);
  // Keep the admin-viewable copy in step with the new password. Without this a
  // reset would leave the previous one on display, which is worse than showing
  // nothing at all.
  await pool.query(
    'UPDATE users SET password_hash = $1, password_encrypted = $2 WHERE id = $3',
    [hash, sealPassword(password), record.user_id]
  );
  await consumePasswordResetToken(record.id);
  // Force re-login everywhere — a leaked old session shouldn't survive a reset.
  await revokeAllRefreshTokens(record.user_id);

  res.json({ message: 'Password updated. You can now log in with your new password.' });
}
