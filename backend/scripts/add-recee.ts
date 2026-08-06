import { pool } from '../src/config/db';

async function main() {
  const alice = (await pool.query("SELECT id, vendor_id FROM users WHERE email = 'alice@test.com'")).rows[0];
  if (!alice) throw new Error('alice@test.com not found');
  const store = (await pool.query('SELECT id, name FROM stores ORDER BY name LIMIT 1')).rows[0];

  const { rows } = await pool.query(
    `INSERT INTO tasks (task_type, vendor_id, store_id, employee_id, status)
     VALUES ('recee', $1, $2, $3, 'pending') RETURNING id`,
    [alice.vendor_id, store.id, alice.id]
  );
  console.log(`Created pending recee task ${rows[0].id} at "${store.name}", assigned to alice@test.com`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
