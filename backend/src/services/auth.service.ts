import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../config/db';
import { env, allowedOrigins } from '../config/env';
import { UserRole } from '../types/domain';

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(payload: { id: string; role: UserRole; email: string; vendor_id: string | null }) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' });
}

export function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

export async function storeRefreshToken(userId: string, token: string) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt]
  );
}

export async function validateRefreshToken(token: string) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query(
    `SELECT rt.*, u.role, u.email, u.vendor_id FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
    [hash]
  );
  return rows[0] || null;
}

export async function revokeRefreshToken(token: string) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [hash]
  );
}

/** Revoke every refresh token for a user — used on password reset so old sessions don't survive. */
export async function revokeAllRefreshTokens(userId: string) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Build the web-console URL a password reset token is redeemed at. */
export function buildResetUrl(token: string): string {
  const base = env.APP_WEB_URL || allowedOrigins[0] || '';
  return `${base.replace(/\/$/, '')}/reset-password?token=${token}`;
}

/** Issue a single-use password reset token (raw value returned once, only the hash is stored). */
export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt]
  );
  return token;
}

/** Validate an unexpired, unused reset token. Returns the owning user_id, or null. */
export async function validatePasswordResetToken(token: string): Promise<{ id: string; user_id: string } | null> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [hash]
  );
  return rows[0] || null;
}

export async function consumePasswordResetToken(id: string) {
  await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [id]);
}
