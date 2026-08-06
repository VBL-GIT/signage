import { pool } from '../src/config/db';

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

async function main() {
  await pool.query('DELETE FROM follow_ups');
  await pool.query('DELETE FROM task_step_photos');
  await pool.query('DELETE FROM task_steps');
  await pool.query('DELETE FROM tasks'); // cascades to task_signage_plan
  console.log('Cleared all tasks, steps, photos, plans and follow_ups');

  const { rows: users } = await pool.query("SELECT id, email, vendor_id FROM users");
  const alice = users.find((u: any) => u.email === 'alice@test.com');
  const vendorId = alice.vendor_id;
  const { rows: stores } = await pool.query("SELECT id FROM stores ORDER BY name LIMIT 3");

  const { rows: brands } = await pool.query("SELECT id, name FROM brands ORDER BY name");
  const { rows: sizes } = await pool.query("SELECT id FROM standard_boarding_sizes WHERE is_active = true ORDER BY width_cm");
  const sizeS = sizes[0]?.id ?? null;
  const sizeM = sizes[1]?.id ?? sizeS;

  // ---- Seed a few random artworks per brand (idempotent). One carries a demo image. ----
  const THEMES = ['Summer', 'Festive', 'Classic', 'Monsoon', 'Republic'];
  let artCount = 0;
  for (const b of brands) {
    // 2-3 artworks per brand
    const n = 2 + (b.name.length % 2);
    for (let i = 0; i < n; i++) {
      const theme = THEMES[(b.name.length + i) % THEMES.length];
      const name = `${b.name}-${theme}-2026`;
      // Give the first artwork of each brand a demo reference image.
      const imageUrl = i === 0 ? `https://picsum.photos/seed/${slug(name)}/400/400` : null;
      const res = await pool.query(
        `INSERT INTO artworks (brand_id, name, image_url) VALUES ($1,$2,$3)
         ON CONFLICT (brand_id, lower(name)) DO NOTHING`,
        [b.id, name, imageUrl]
      );
      artCount += res.rowCount ?? 0;
    }
  }
  console.log(`Seeded ${artCount} new artwork(s) across ${brands.length} brand(s)`);

  // Map: brand id -> its artworks (id) for building plans
  const { rows: artworks } = await pool.query('SELECT id, brand_id FROM artworks WHERE is_active = true');
  const artByBrand = new Map<string, string[]>();
  for (const a of artworks) {
    const list = artByBrand.get(a.brand_id) ?? [];
    list.push(a.id);
    artByBrand.set(a.brand_id, list);
  }
  const firstArt = (brandId: string | null) => (brandId ? (artByBrand.get(brandId)?.[0] ?? null) : null);

  const brandA = brands[0]?.id ?? null;
  const brandB = brands[1]?.id ?? brandA;

  // Helper: direct_boarding task + a 2-signage plan (each signage: brand + size + artwork).
  async function boardingTask(storeId: string, employeeId: string | null) {
    const { rows } = await pool.query(
      `INSERT INTO tasks (task_type, installation_type, vendor_id, store_id, employee_id, status)
       VALUES ('installation','direct_boarding',$1,$2,$3,'pending') RETURNING id`,
      [vendorId, storeId, employeeId]
    );
    const taskId = rows[0].id;
    await pool.query(
      `INSERT INTO task_signage_plan (task_id, signage_index, signage_type, boarding_size_id, brand_id, artwork_id)
       VALUES ($1, 1, 'glow_sign_board', $2, $3, $4), ($1, 2, 'nonlit', $5, $6, $7)`,
      [taskId, sizeS, brandA, firstArt(brandA), sizeM, brandB, firstArt(brandB)]
    );
    return taskId;
  }

  // Recee + pamphlet tasks (recee is per-signage; employee chooses count 1-5 on site).
  await pool.query(`
    INSERT INTO tasks (task_type, installation_type, vendor_id, store_id, employee_id, target_pamphlet_count, status)
    VALUES
      ('recee', NULL, $3, $1, $2, NULL, 'pending'),
      ('installation', 'direct', $3, $4, $2, 200, 'pending'),
      ('recee', NULL, $3, $4, NULL, NULL, 'pending'),
      ('installation', 'direct', $3, $5, NULL, 150, 'pending')
  `, [stores[0]?.id, alice.id, vendorId, stores[1]?.id, stores[2]?.id]);

  // Direct-boarding tasks with 2-signage plans (brand + artwork per signage).
  await boardingTask(stores[2]?.id, alice.id);
  await boardingTask(stores[0]?.id, null);

  console.log('Re-seeded 6 tasks (recee ×2, pamphlet ×2, boarding ×2 with artwork plans) — 3 assigned to Alice, 3 unassigned');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
