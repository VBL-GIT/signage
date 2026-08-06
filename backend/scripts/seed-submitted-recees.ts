import { pool } from '../src/config/db';

// Creates a few recee tasks already in `recee_submitted` (with signage photos),
// so the Approvals queue has entries to test bulk approve/reject against.
// Idempotent-ish: safe to re-run (it just adds more).
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

async function main() {
  const alice = (await pool.query("SELECT id, vendor_id FROM users WHERE email='alice@test.com'")).rows[0];
  if (!alice) throw new Error('alice@test.com not found');
  const stores = (await pool.query('SELECT id, name, lat, long FROM stores ORDER BY name LIMIT 3')).rows;
  const sizes = (await pool.query('SELECT id FROM standard_boarding_sizes WHERE is_active = true ORDER BY width_cm')).rows;
  const sizeS = sizes[0]?.id ?? null;
  const sizeM = sizes[1]?.id ?? sizeS;
  const TYPES = ['glow_sign_board', 'nonlit', 'impact'];

  let made = 0;
  for (let s = 0; s < stores.length; s++) {
    const store = stores[s];
    // recee task, already submitted, assigned to Alice
    const task = (await pool.query(
      `INSERT INTO tasks (task_type, vendor_id, store_id, employee_id, status)
       VALUES ('recee', $1, $2, $3, 'recee_submitted') RETURNING id`,
      [alice.vendor_id, store.id, alice.id]
    )).rows[0];

    const lat = Number(store.lat) || 19.076, long = Number(store.long) || 72.8777;
    const step = (await pool.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes)
       VALUES ($1,'recee',$2,$3,$4,$5) RETURNING id`,
      [task.id, alice.id, lat, long, 'Demo recee submission']
    )).rows[0];

    // 2 signages per recee, with a placeholder reference photo each
    const count = 2;
    for (let i = 1; i <= count; i++) {
      const photo = `https://picsum.photos/seed/${slug(store.name)}-recee-${i}/600/450`;
      await pool.query(
        `INSERT INTO task_step_photos
          (task_step_id, photo_url, lat, long, signage_type, boarding_size_id, distance_from_store_m, distance_from_first_m, signage_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [step.id, photo, lat + i * 0.0001, long + i * 0.0001, TYPES[(s + i) % TYPES.length],
         i === 1 ? sizeS : sizeM, i === 1 ? 0 : 15, i === 1 ? 0 : 15, i]
      );
    }
    made++;
  }

  console.log(`Seeded ${made} submitted recee(s) (2 signages each) for alice@test.com — visible in the Approvals queue.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
