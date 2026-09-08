import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Reversible storage of a user's current password, so an admin can read it back
 * from the user's detail page.
 *
 * This exists because the team asked for it explicitly. It is a real trade:
 * anything reversible can be reversed by whoever holds the key, and people
 * reuse passwords, so a leak here reaches beyond this application. Two things
 * limit the blast radius:
 *
 *   * the key lives in CREDENTIAL_ENC_KEY in the environment, never in the
 *     database, so a table dump on its own reveals nothing;
 *   * authentication never consults this — password_hash (bcrypt) remains the
 *     only thing login checks, so a corrupted or cleared value cannot let
 *     anyone in.
 *
 * With no key configured the vault is inert: nothing is stored and nothing can
 * be read, and the rest of the app carries on unchanged.
 *
 * AES-256-GCM is used rather than CBC so the ciphertext is authenticated —
 * tampering is detected on decrypt instead of yielding a garbage "password".
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit nonce, the size GCM is defined for
const VERSION = 'v1';  // lets the format change later without breaking old rows

/** The 32-byte key, or null when the feature is not configured. */
function getKey(): Buffer | null {
  const raw = env.CREDENTIAL_ENC_KEY;
  if (!raw) return null;
  // Accept hex or base64; anything that isn't exactly 32 bytes is a
  // misconfiguration and must fail loudly rather than silently weaken.
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('CREDENTIAL_ENC_KEY must decode to exactly 32 bytes (64 hex chars, or base64)');
  }
  return buf;
}

/** True when passwords can be stored and read back. */
export function isVaultEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypt a password for storage. Returns null when the vault is off, which
 * callers store as NULL — an account created while the feature was disabled
 * simply has nothing to show.
 */
export function sealPassword(plaintext: string): string | null {
  const key = getKey();
  if (!key || !plaintext) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * Decrypt a stored password. Returns null for anything unreadable — no key, an
 * empty column, an unknown format, or a failed authentication tag — so a caller
 * can only ever show a genuine value or nothing at all.
 */
export function openPassword(sealed: string | null | undefined): string | null {
  const key = getKey();
  if (!key || !sealed) return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key or tampered ciphertext. Never surface the reason.
    return null;
  }
}

