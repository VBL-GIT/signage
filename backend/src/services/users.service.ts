import bcrypt from 'bcryptjs';
import { sealPassword } from './credential-vault';
import { pool } from '../config/db';
import { UserRole } from '../types/domain';

export interface CreateUserInput {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role: UserRole;
  mobile?: string | null;
  vendor_id?: string | null;
}

const VENDOR_SCOPED_ROLES: UserRole[] = ['vendor_admin', 'vendor_user', 'employee'];

/**
 * User-facing message for a duplicate email.
 *
 * users.email is globally unique and stays that way — login resolves an account
 * by email alone, with no vendor context, so per-vendor uniqueness would make
 * "which account is this?" ambiguous at sign-in. Both cases are still rejected;
 * only the wording differs, so an admin can tell "already on my own vendor"
 * apart from "taken by someone else's".
 */
export function duplicateEmailMessage(
  existingVendorId: string | null,
  attemptedVendorId: string | null
): string {
  const sameVendor =
    existingVendorId !== null && attemptedVendorId !== null && existingVendorId === attemptedVendorId;
  return sameVendor
    ? 'Mail/user already exists in the same vendor.'
    : 'This email is already registered with another vendor/account.';
}

/** Look up an account by email (case-insensitive) for duplicate reporting. */
export async function findUserByEmail(email: string): Promise<{ id: string; vendor_id: string | null } | null> {
  const { rows } = await pool.query(
    'SELECT id, vendor_id FROM users WHERE lower(email) = lower($1)',
    [email.trim()]
  );
  return rows[0] ?? null;
}

/**
 * Resolve & validate the effective role + vendor_id a creator is allowed to set.
 * Throws Error with a human-readable message on a policy violation.
 */
export function resolveUserScope(
  creator: { role: UserRole; vendor_id: string | null },
  desiredRole: UserRole,
  bodyVendorId: string | null | undefined
): { role: UserRole; vendor_id: string | null } {
  // Head office (rjcorp_admin / rjcorp_user with user.manage) can create any account.
  // Only rjcorp_admin may mint another rjcorp_admin (no privilege escalation).
  if (creator.role === 'rjcorp_admin' || creator.role === 'rjcorp_user') {
    if (desiredRole === 'rjcorp_admin' && creator.role !== 'rjcorp_admin') {
      throw new Error('Only an RJCorp admin can create an RJCorp admin account');
    }
    if (VENDOR_SCOPED_ROLES.includes(desiredRole)) {
      if (!bodyVendorId) throw new Error('vendor_id is required for vendor/employee accounts');
      return { role: desiredRole, vendor_id: bodyVendorId };
    }
    return { role: desiredRole, vendor_id: null }; // rjcorp_admin / rjcorp_user
  }

  if (creator.role === 'vendor_admin') {
    if (!VENDOR_SCOPED_ROLES.includes(desiredRole)) {
      throw new Error('Vendor admins may only create vendor or employee accounts');
    }
    if (!creator.vendor_id) throw new Error('Your account is not linked to a vendor');
    // vendor_id is always forced to the creator's own vendor
    return { role: desiredRole, vendor_id: creator.vendor_id };
  }

  throw new Error('You do not have permission to create users');
}

const ROLE_LETTER: Partial<Record<UserRole, string>> = {
  employee: 'E',
  vendor_admin: 'A',
  vendor_user: 'U',
};

/**
 * Auto-generate a vendor-scoped UID like "V1-E001" (vendor #1, employee #001).
 * Returns null for rjcorp accounts (no vendor). The uid is a plain, mutable column,
 * so it can later be replaced with UIDs from VBL's master record.
 */
async function generateUserUid(vendorId: string | null, role: UserRole): Promise<string | null> {
  if (!vendorId) return null;
  const letter = ROLE_LETTER[role];
  if (!letter) return null;
  const { rows: vrows } = await pool.query('SELECT code FROM vendors WHERE id = $1', [vendorId]);
  const code = vrows[0]?.code;
  if (code == null) return null;
  const { rows: crows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM users WHERE vendor_id = $1 AND role = $2',
    [vendorId, role]
  );
  const seq = (crows[0].n as number) + 1;
  return `V${code}-${letter}${String(seq).padStart(3, '0')}`;
}

/**
 * Insert a single user. Throws on duplicate email (Postgres code 23505).
 */
export async function insertUser(input: CreateUserInput) {
  const name = `${input.first_name} ${input.last_name}`.trim();
  const email = input.email.trim().toLowerCase();
  const hash = await bcrypt.hash(input.password, 10);
  const uid = await generateUserUid(input.vendor_id || null, input.role);
  // A separate encrypted copy so an admin can read the password back later.
  // Null when the vault is not configured. Never used to authenticate — that is
  // password_hash's job — and deliberately absent from the RETURNING list.
  const sealed = sealPassword(input.password);
  const { rows } = await pool.query(
    `INSERT INTO users (name, first_name, last_name, email, password_hash, password_encrypted, role, phone, vendor_id, uid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, name, first_name, last_name, email, role, vendor_id, uid, is_active, created_at`,
    [name, input.first_name, input.last_name, email, hash, sealed, input.role, input.mobile || null, input.vendor_id || null, uid]
  );
  return rows[0];
}
