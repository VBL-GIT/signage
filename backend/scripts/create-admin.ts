import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db';

/**
 * Creates the first RJCorp super-admin for a fresh production database.
 * There is no public signup, so this bootstraps the account VBL logs in with.
 *
 * Usage (PowerShell — quote values containing special chars):
 *   $env:ADMIN_EMAIL="admin@vbl.com"; $env:ADMIN_PASSWORD="<strong>"; $env:ADMIN_NAME="VBL Admin"; npx ts-node scripts/create-admin.ts
 *
 * Re-running with an existing email is a no-op (won't reset the password).
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || 'RJCorp Admin').trim();

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters.');
    process.exit(1);
  }

  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (existing.rows.length) {
    console.log(`User ${email} already exists — leaving it unchanged.`);
    await pool.end();
    return;
  }

  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ') || null;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, first_name, last_name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, 'rjcorp_admin', true)`,
    [name, first, last, email, hash]
  );
  console.log(`Created RJCorp admin: ${email}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
