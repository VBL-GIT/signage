import { pool } from '../src/config/db';

async function main() {
  // Get alice and bob IDs
  const { rows: users } = await pool.query("SELECT id, email, role FROM users");
  const alice = users.find((u: any) => u.email === 'alice@test.com');
  const bob = users.find((u: any) => u.email === 'bob@test.com');

  // Get store IDs
  const { rows: stores } = await pool.query("SELECT id, name FROM stores");
  const { rows: brands } = await pool.query("SELECT id, name FROM brands");

  console.log('Alice:', alice?.id);
  console.log('Bob:', bob?.id);
  console.log('Stores:', stores.map((s: any) => s.name));

  if (!alice || !bob || stores.length === 0) {
    console.error('Missing seed data — run migrations first');
    process.exit(1);
  }

  // Create one of each task type
  await pool.query(`
    INSERT INTO tasks (task_type, store_id, employee_id, supervisor_id, brand_id, status)
    VALUES
      ('recee_approval_installation', $1, $2, $3, $4, 'pending'),
      ('installation_only', $5, $2, $3, $4, 'pending'),
      ('pamphlet_distribution', NULL, $2, $3, NULL, 'pending')
  `, [
    stores[0].id, alice.id, bob.id, brands[0]?.id,
    stores[1].id,
  ]);

  console.log('✓ Created 3 test tasks for Alice');
  await pool.end();
}

main().catch(console.error);
