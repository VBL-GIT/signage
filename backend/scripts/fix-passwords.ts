import { pool } from '../src/config/db';
import bcrypt from 'bcryptjs';

async function main() {
  const hash = await bcrypt.hash('password123', 10);
  console.log('Generated hash:', hash);
  await pool.query(
    "UPDATE users SET password_hash = $1 WHERE email IN ('alice@test.com', 'bob@test.com', 'rjadmin@test.com')",
    [hash]
  );
  console.log('Passwords updated successfully');
  await pool.end();
}
main().catch(console.error);
