import { pool } from '../src/config/db';

async function main() {
  const { rowCount } = await pool.query('DELETE FROM refresh_tokens');
  console.log(`Cleared ${rowCount} refresh token(s). All users must log in again.`);
  await pool.end();
}

main().catch(console.error);
