import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db';
import { processReceeApproval, getReceeSignageIndices } from '../src/services/tasks.service';

/**
 * Rich demo dataset: several vendors, their employees + stores, artworks, and
 * ~35 tasks spanning every type and status — including a populated Approvals
 * queue and auto-generated post-recee installs.
 *
 *   npm run demo:seed   (or wired into demo:reset)
 *
 * Vendors/stores/employees are upserted (safe to re-run). Tasks are wiped and
 * regenerated so the counts stay predictable.
 */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];
const photo = (tag: string) => `https://picsum.photos/seed/${slug(tag)}/600/450`;

const VENDORS = [
  { name: 'Acme Signage Co', cp: 'Bob Kapoor', phone: '9820011111', email: 'ops@acme.example' },
  { name: 'Rajat Cool Traders', cp: 'Rajat Mehta', phone: '9811022222', email: 'contact@rajatcool.example' },
  { name: 'Bengal Signworks', cp: 'Sourav Das', phone: '9830033333', email: 'hello@bengalsign.example' },
  { name: 'Metro Media Solutions', cp: 'Priya Nair', phone: '9840044444', email: 'team@metromedia.example' },
  { name: 'Deccan Displays', cp: 'Imran Sheikh', phone: '9850055555', email: 'info@deccandisplays.example' },
];

const FIRST = ['Amit', 'Neha', 'Ravi', 'Sana', 'Vikram', 'Divya', 'Arjun', 'Meera', 'Karan', 'Pooja', 'Rohit', 'Anita', 'Suresh', 'Fatima', 'Manish'];
const LAST = ['Sharma', 'Patel', 'Rao', 'Khan', 'Iyer', 'Bose', 'Gupta', 'Reddy', 'Singh', 'Menon'];

const STORE_POOL = [
  { name: 'MG Road Outlet', addr: '12 MG Road', city: 'Mumbai', pin: '400001', lat: 19.0760, long: 72.8777 },
  { name: 'Park Street Store', addr: '45 Park Street', city: 'Kolkata', pin: '700016', lat: 22.5726, long: 88.3639 },
  { name: 'Brigade Road Shop', addr: '7 Brigade Road', city: 'Bengaluru', pin: '560025', lat: 12.9716, long: 77.5946 },
  { name: 'Connaught Place Kiosk', addr: 'A-9 Connaught Place', city: 'Delhi', pin: '110001', lat: 28.6315, long: 77.2167 },
  { name: 'Banjara Hills Mart', addr: 'Road No 12, Banjara Hills', city: 'Hyderabad', pin: '500034', lat: 17.4126, long: 78.4482 },
  { name: 'FC Road Corner', addr: '88 FC Road', city: 'Pune', pin: '411004', lat: 18.5204, long: 73.8567 },
  { name: 'Anna Salai Point', addr: '210 Anna Salai', city: 'Chennai', pin: '600002', lat: 13.0604, long: 80.2496 },
  { name: 'CG Road Plaza', addr: '5 CG Road', city: 'Ahmedabad', pin: '380009', lat: 23.0225, long: 72.5714 },
  { name: 'MI Road Depot', addr: '33 MI Road', city: 'Jaipur', pin: '302001', lat: 26.9124, long: 75.7873 },
  { name: 'Hazratganj Store', addr: '19 Hazratganj', city: 'Lucknow', pin: '226001', lat: 26.8467, long: 80.9462 },
  { name: 'Sector 17 Shop', addr: 'SCO 21, Sector 17', city: 'Chandigarh', pin: '160017', lat: 30.7333, long: 76.7794 },
  { name: 'Panampilly Outlet', addr: 'Panampilly Nagar', city: 'Kochi', pin: '682036', lat: 9.9658, long: 76.2999 },
  { name: 'Civil Lines Mart', addr: '2 Civil Lines', city: 'Nagpur', pin: '440001', lat: 21.1458, long: 79.0882 },
  { name: 'Ashram Road Store', addr: '77 Ashram Road', city: 'Surat', pin: '395002', lat: 21.1702, long: 72.8311 },
  { name: 'Lalbagh Kiosk', addr: 'Lalbagh Main Rd', city: 'Bengaluru', pin: '560027', lat: 12.9507, long: 77.5848 },
];

const TYPES = ['glow_sign_board', 'nonlit', 'impact'];

async function main() {
  // ---- brands + sizes (ensure present) ----
  await pool.query(`INSERT INTO brands (name) VALUES ('BrandX'),('BrandY'),('BrandZ') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO standard_boarding_sizes (label, width_cm, height_cm) VALUES
    ('Small (2x1.5 ft)',61,46),('Medium (4x3 ft)',122,91),('Large (6x4 ft)',183,122),('XL (8x4 ft)',244,122)
    ON CONFLICT DO NOTHING`);
  const brands = (await pool.query('SELECT id, name FROM brands ORDER BY name')).rows;
  const sizes = (await pool.query('SELECT id FROM standard_boarding_sizes WHERE is_active = true ORDER BY width_cm')).rows.map((r) => r.id);

  // ---- artworks per brand (with a demo image on the first) ----
  const THEMES = ['Summer', 'Festive', 'Classic', 'Monsoon'];
  for (const b of brands) {
    for (let i = 0; i < 3; i++) {
      const name = `${b.name}-${THEMES[i % THEMES.length]}-2026`;
      await pool.query(
        `INSERT INTO artworks (brand_id, name, image_url) VALUES ($1,$2,$3) ON CONFLICT (brand_id, lower(name)) DO NOTHING`,
        [b.id, name, i === 0 ? photo(name) : null]
      );
    }
  }
  const artRows = (await pool.query('SELECT id, brand_id FROM artworks WHERE is_active = true')).rows;
  const artByBrand = new Map<string, string[]>();
  for (const a of artRows) { const l = artByBrand.get(a.brand_id) ?? []; l.push(a.id); artByBrand.set(a.brand_id, l); }
  const brandArt = (bi: number) => {
    const brand = brands[bi % brands.length];
    return { brand_id: brand.id, artwork_id: (artByBrand.get(brand.id) ?? [])[0] ?? null };
  };

  const hash = await bcrypt.hash('password123', 10);
  const passSecret = process.env.RJADMIN_KEEP ? '' : '';
  void passSecret;

  // Approvals must be performed by a head-office/supervisor account, never the
  // submitting employee (employees have no task.approve privilege in the real
  // app). Falls back to bob@test.com (vendor_admin) if the RJCorp seed account
  // isn't present.
  const approver = (await pool.query(
    "SELECT id FROM users WHERE email IN ('rjadmin@test.com','bob@test.com') ORDER BY email = 'rjadmin@test.com' DESC LIMIT 1"
  )).rows[0];
  if (!approver) throw new Error('No approver account found — seed rjadmin@test.com or bob@test.com first');
  const approverId = approver.id as string;

  // ---- vendors, employees, stores (upsert) ----
  const pw = hash;
  let storeSeq = (await pool.query('SELECT COUNT(*)::int AS n FROM stores')).rows[0].n as number;
  const vendors: { id: string; code: number; name: string; employees: string[]; stores: string[] }[] = [];
  let storePoolIdx = 0;

  for (let vi = 0; vi < VENDORS.length; vi++) {
    const v = VENDORS[vi];
    let row = (await pool.query('SELECT id, code FROM vendors WHERE name = $1', [v.name])).rows[0];
    if (!row) {
      row = (await pool.query(
        `INSERT INTO vendors (name, contact_person, contact_phone, contact_email) VALUES ($1,$2,$3,$4) RETURNING id, code`,
        [v.name, v.cp, v.phone, v.email]
      )).rows[0];
      await pool.query('UPDATE vendors SET uid = $1 WHERE id = $2', [`VND-${String(row.code).padStart(3, '0')}`, row.id]);
    }
    const vendorId = row.id, code = row.code;

    // employees (3 per vendor)
    const employees: string[] = [];
    let empCount = (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE vendor_id=$1 AND role='employee'", [vendorId])).rows[0].n as number;
    for (let e = 0; e < 3; e++) {
      const first = pick(FIRST, vi * 3 + e), last = pick(LAST, vi + e);
      const email = `${slug(first)}.${slug(last)}.${code}@demo.example`;
      let u = (await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email])).rows[0];
      if (!u) {
        empCount += 1;
        const uid = `V${code}-E${String(empCount).padStart(3, '0')}`;
        u = (await pool.query(
          `INSERT INTO users (name, first_name, last_name, email, password_hash, role, phone, vendor_id, uid)
           VALUES ($1,$2,$3,$4,$5,'employee',$6,$7,$8) RETURNING id`,
          [`${first} ${last}`, first, last, email, pw, `98${code}${e}0000${e}`, vendorId, uid]
        )).rows[0];
      }
      employees.push(u.id);
    }
    // Keep the mobile demo account (alice) as an Acme employee with real tasks.
    if (v.name === 'Acme Signage Co') {
      const alice = (await pool.query("SELECT id FROM users WHERE email='alice@test.com'")).rows[0];
      if (alice) employees.unshift(alice.id);
    }

    // stores (3 per vendor)
    const stores: string[] = [];
    for (let s = 0; s < 3; s++) {
      const sp = STORE_POOL[storePoolIdx % STORE_POOL.length]; storePoolIdx++;
      const uid = `ST-${String(++storeSeq).padStart(3, '0')}`;
      let st = (await pool.query('SELECT id FROM stores WHERE uid=$1', [uid])).rows[0];
      if (!st) {
        st = (await pool.query(
          `INSERT INTO stores (name, address, pincode, lat, long, uid, contact_no, contact_email, contact_person, vendor_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [`${sp.name} - ${sp.city}`, `${sp.addr}, ${sp.city}`, sp.pin, sp.lat, sp.long, uid,
           `0${code}${s}1234567`, `store.${uid.toLowerCase()}@demo.example`, `Mgr ${pick(LAST, s)}`, vendorId]
        )).rows[0];
      }
      stores.push(st.id);
    }

    vendors.push({ id: vendorId, code, name: v.name, employees, stores });
  }

  // ---- wipe tasks and regenerate ----
  await pool.query('DELETE FROM follow_ups');
  await pool.query('DELETE FROM task_step_photos');
  await pool.query('DELETE FROM task_steps');
  await pool.query('DELETE FROM tasks');

  const created: Record<string, number> = {};
  const bump = (k: string) => (created[k] = (created[k] ?? 0) + 1);

  async function newTask(fields: any, ageDays: number) {
    const cols = Object.keys(fields);
    const vals = cols.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `INSERT INTO tasks (${cols.join(',')}, created_at, updated_at)
       VALUES (${vals}, NOW() - ($${cols.length + 1} || ' days')::interval, NOW()) RETURNING id, vendor_id, store_id`,
      [...cols.map((c) => fields[c]), ageDays]
    );
    return rows[0];
  }

  async function addReceeStep(taskId: string, empId: string, lat: number, long: number, n: number, storeName: string) {
    const step = (await pool.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes) VALUES ($1,'recee',$2,$3,$4,$5) RETURNING id`,
      [taskId, empId, lat, long, 'Demo recee']
    )).rows[0];
    for (let i = 1; i <= n; i++) {
      await pool.query(
        `INSERT INTO task_step_photos (task_step_id, photo_url, lat, long, signage_type, boarding_size_id, distance_from_store_m, distance_from_first_m, signage_index)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [step.id, photo(`${storeName}-recee-${i}`), lat + i * 1e-4, long + i * 1e-4, pick(TYPES, i), pick(sizes, i), i === 1 ? 0 : 12 * i, i === 1 ? 0 : 12 * i, i]
      );
    }
  }

  async function boardingPlan(taskId: string, specs: { type: string; sizeId: string; brand_id: string; artwork_id: string | null }[]) {
    let idx = 0;
    for (const sp of specs) {
      idx++;
      await pool.query(
        `INSERT INTO task_signage_plan (task_id, signage_index, signage_type, boarding_size_id, brand_id, artwork_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [taskId, idx, sp.type, sp.sizeId, sp.brand_id, sp.artwork_id]
      );
    }
  }

  async function completeInstall(taskId: string, empId: string, lat: number, long: number, tag: string, n: number, pamphlet?: number) {
    const step = (await pool.query(
      `INSERT INTO task_steps (task_id, step_type, performed_by, lat, long, notes, pamphlet_count) VALUES ($1,'installation',$2,$3,$4,$5,$6) RETURNING id`,
      [taskId, empId, lat, long, 'Demo install', pamphlet ?? null]
    )).rows[0];
    for (let i = 1; i <= n; i++) {
      await pool.query(
        `INSERT INTO task_step_photos (task_step_id, photo_url, lat, long, signage_index) VALUES ($1,$2,$3,$4,$5)`,
        [step.id, photo(`${tag}-install-${i}`), lat, long, i]
      );
    }
    await pool.query("UPDATE tasks SET status='completed', updated_at=NOW() WHERE id=$1", [taskId]);
  }

  for (let vi = 0; vi < vendors.length; vi++) {
    const V = vendors[vi];
    const st = (i: number) => V.stores[i % V.stores.length];
    const emp = (i: number) => V.employees[i % V.employees.length];
    const sp = STORE_POOL; // for coords
    const coord = (i: number) => sp[(vi * 3 + i) % sp.length];

    // 1) recee pending, assigned
    await newTask({ task_type: 'recee', vendor_id: V.id, store_id: st(0), employee_id: emp(0), status: 'pending' }, 2 + vi); bump('recee');
    // 2) recee pending, unassigned
    await newTask({ task_type: 'recee', vendor_id: V.id, store_id: st(1), employee_id: null, status: 'pending' }, 1 + vi); bump('recee');

    // 3) recee_submitted (Approvals queue), assigned
    {
      const t = await newTask({ task_type: 'recee', vendor_id: V.id, store_id: st(2), employee_id: emp(1), status: 'recee_submitted' }, 3 + vi);
      const c = coord(2);
      await addReceeStep(t.id, emp(1), c.lat, c.long, 2, `${V.name}-${c.city}`); bump('recee_submitted');
    }

    // 4) recee approved -> generates a post_recee install (leave some unassigned)
    {
      const t = await newTask({ task_type: 'recee', vendor_id: V.id, store_id: st(0), employee_id: emp(2), status: 'recee_submitted' }, 6 + vi);
      const c = coord(0);
      await addReceeStep(t.id, emp(2), c.lat, c.long, 2, `${V.name}-${c.city}-ap`);
      const indices = await getReceeSignageIndices(t.id);
      const ba = brandArt(vi);
      await processReceeApproval(
        { id: t.id, vendor_id: V.id, store_id: st(0) },
        { approval_status: 'approved', signages: indices.map((i) => ({ signage_index: i, brand_id: ba.brand_id, artwork_id: ba.artwork_id })) },
        approverId
      );
      bump('recee_approved'); bump('post_recee_install');
      // assign the generated install to an employee for half of them
      if (vi % 2 === 0) {
        await pool.query("UPDATE tasks SET employee_id=$1 WHERE parent_task_id=$2", [emp(0), t.id]);
      }
    }

    // 5) direct_boarding pending, assigned, 2 signages (brand+artwork+size)
    {
      const ba0 = brandArt(vi), ba1 = brandArt(vi + 1);
      const t = await newTask({ task_type: 'installation', installation_type: 'direct_boarding', vendor_id: V.id, store_id: st(1), employee_id: emp(2), status: 'pending', brand_id: ba0.brand_id, artwork_id: ba0.artwork_id, boarding_size_id: pick(sizes, 1) }, 1 + vi);
      await boardingPlan(t.id, [
        { type: 'glow_sign_board', sizeId: pick(sizes, 1), brand_id: ba0.brand_id, artwork_id: ba0.artwork_id },
        { type: 'nonlit', sizeId: pick(sizes, 2), brand_id: ba1.brand_id, artwork_id: ba1.artwork_id },
      ]); bump('boarding');
    }
    // 6) direct_boarding pending, unassigned, 1 signage
    {
      const ba = brandArt(vi + 2);
      const t = await newTask({ task_type: 'installation', installation_type: 'direct_boarding', vendor_id: V.id, store_id: st(2), employee_id: null, status: 'pending', brand_id: ba.brand_id, artwork_id: ba.artwork_id, boarding_size_id: pick(sizes, 0) }, 2 + vi);
      await boardingPlan(t.id, [{ type: 'impact', sizeId: pick(sizes, 0), brand_id: ba.brand_id, artwork_id: ba.artwork_id }]); bump('boarding');
    }

    // 7) direct (pamphlet) pending, assigned
    await newTask({ task_type: 'installation', installation_type: 'direct', vendor_id: V.id, store_id: st(0), employee_id: emp(0), status: 'pending', target_pamphlet_count: 100 + vi * 50, pincode: coord(0).pin }, 1 + vi); bump('direct');
  }

  // ---- a few completed tasks for the Completed tab ----
  for (let vi = 0; vi < 3; vi++) {
    const V = vendors[vi];
    const c = STORE_POOL[vi];
    // completed pamphlet
    const dt = await newTask({ task_type: 'installation', installation_type: 'direct', vendor_id: V.id, store_id: V.stores[0], employee_id: V.employees[0], status: 'pending', target_pamphlet_count: 200, pincode: c.pin }, 8 + vi);
    await completeInstall(dt.id, V.employees[0], c.lat, c.long, `${V.name}-pamph`, 2, 187); bump('direct_completed');

    // completed boarding
    const ba = brandArt(vi);
    const bt = await newTask({ task_type: 'installation', installation_type: 'direct_boarding', vendor_id: V.id, store_id: V.stores[1], employee_id: V.employees[1], status: 'pending', brand_id: ba.brand_id, artwork_id: ba.artwork_id, boarding_size_id: sizes[1] }, 9 + vi);
    await boardingPlan(bt.id, [{ type: 'glow_sign_board', sizeId: sizes[1], brand_id: ba.brand_id, artwork_id: ba.artwork_id }]);
    await completeInstall(bt.id, V.employees[1], c.lat, c.long, `${V.name}-board`, 1); bump('boarding_completed');
  }

  const totals = (await pool.query('SELECT COUNT(*)::int AS n FROM tasks')).rows[0].n;
  const vn = vendors.length;
  const en = (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='employee'")).rows[0].n;
  const sn = (await pool.query('SELECT COUNT(*)::int AS n FROM stores')).rows[0].n;
  const an = (await pool.query('SELECT COUNT(*)::int AS n FROM artworks')).rows[0].n;
  const subm = (await pool.query("SELECT COUNT(*)::int AS n FROM tasks WHERE status='recee_submitted'")).rows[0].n;

  console.log('--- Demo data seeded ---');
  console.log(`Vendors: ${vn} | Employees: ${en} | Stores: ${sn} | Artworks: ${an}`);
  console.log(`Tasks: ${totals} total (awaiting approval: ${subm})`);
  console.log('Breakdown:', created);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
