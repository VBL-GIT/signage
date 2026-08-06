import { pool } from '../src/config/db';

async function main() {
  const users = await pool.query(
    `SELECT u.email, u.role, u.first_name, u.last_name, v.uid as vendor_uid
     FROM users u LEFT JOIN vendors v ON v.id = u.vendor_id ORDER BY u.role`
  );
  console.log('USERS:'); console.table(users.rows);

  const vendors = await pool.query('SELECT uid, name FROM vendors');
  console.log('VENDORS:'); console.table(vendors.rows);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='tasks' AND column_name IN ('vendor_id') `
  );
  console.log('tasks.vendor_id present:', cols.rows.length === 1);

  const nullable = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name='tasks' AND column_name='employee_id'`
  );
  console.log('tasks.employee_id nullable:', nullable.rows[0]?.is_nullable);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
