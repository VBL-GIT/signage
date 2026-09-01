/**
 * End-to-end check of the Customer-Code store upsert against the real schema.
 *
 * SAFE TO RUN AGAINST ANY DATABASE: every statement runs inside a single
 * transaction that is ALWAYS rolled back, including on failure. Nothing is
 * committed — no store, vendor or task created here survives the script.
 *
 * Requires migration 024 to have been applied.
 *
 * Run: npx ts-node scripts/test-store-upsert.ts
 */
import { pool } from '../src/config/db';
import {
  bulkUpsertStores,
  loadStoreIdentityLookup,
  resolveStoreIdentity,
  upsertStore,
  StoreInput,
} from '../src/services/stores.service';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

const TAG = `zz-test-${Date.now()}`;
const store = (over: Partial<StoreInput> = {}): StoreInput => ({
  customer_code: `${TAG}-CC1`,
  uid: `${TAG}-U1`,
  name: 'Test Store',
  address: 'Test Address',
  pincode: '400001',
  lat: 19.1,
  long: 72.8,
  contact_no: '9800000000',
  contact_email: 'test@example.com',
  contact_person: 'Tester',
  outlet_status: 'ACTIVE',
  ...over,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('\n== schema (migration 024) ==');
    const { rows: cols } = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='stores' AND column_name IN ('customer_code','outlet_status','source_metadata')`
    );
    const have = new Set(cols.map((c) => c.column_name));
    check('stores.customer_code exists', have.has('customer_code'));
    check('stores.outlet_status exists', have.has('outlet_status'));
    check('stores.source_metadata exists', have.has('source_metadata'));
    if (have.size < 3) {
      console.log('\n  Migration 024 has not been applied — skipping the rest.\n');
      await client.query('ROLLBACK');
      process.exit(1);
    }
    const { rows: idx } = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('stores','brands')`
    );
    const names = new Set(idx.map((i) => i.indexname));
    check('idx_stores_customer_code exists', names.has('idx_stores_customer_code'));
    check('idx_stores_uid_lower exists', names.has('idx_stores_uid_lower'));
    check('idx_brands_name_unique exists', names.has('idx_brands_name_unique'));

    console.log('\n== create ==');
    let lookup = await loadStoreIdentityLookup(client);
    let id1 = resolveStoreIdentity(lookup, store().customer_code, store().uid);
    check('new code+uid resolves to create', id1.ok && id1.targetId === null);
    const created = await upsertStore(client, store(), null);
    check('outcome is created', created.outcome === 'created');
    const storeId = created.store.id as string;
    check('customer_code stored', created.store.customer_code === `${TAG}-CC1`);
    check('outlet_status stored', created.store.outlet_status === 'ACTIVE');

    console.log('\n== attach a task, then update: FKs must survive ==');
    const { rows: v } = await client.query(
      `INSERT INTO vendors (name, contact_person, contact_phone, contact_email)
       VALUES ($1,null,null,$2) RETURNING id`,
      [`${TAG} Vendor`, `${TAG}@example.com`]
    );
    const { rows: t } = await client.query(
      `INSERT INTO tasks (task_type, vendor_id, store_id) VALUES ('recee',$1,$2) RETURNING id`,
      [v[0].id, storeId]
    );
    const taskId = t[0].id as string;

    lookup = await loadStoreIdentityLookup(client);
    const again = resolveStoreIdentity(lookup, `${TAG}-CC1`, `${TAG}-U1`);
    check('existing code resolves to the same store', again.ok && again.targetId === storeId);

    const updated = await upsertStore(
      client,
      store({ name: 'Renamed Store', pincode: '560001', contact_email: 'new@example.com' }),
      (again as { targetId: string }).targetId
    );
    check('outcome is updated', updated.outcome === 'updated');
    check('stores.id PRESERVED across update', updated.store.id === storeId, String(updated.store.id));
    check('name was replaced', updated.store.name === 'Renamed Store');
    check('pincode was replaced', updated.store.pincode === '560001');

    const { rows: taskAfter } = await client.query('SELECT store_id FROM tasks WHERE id = $1', [taskId]);
    check('existing task still points at the same store', taskAfter[0].store_id === storeId);

    console.log('\n== vendor mapping is preserved by an upsert ==');
    await client.query('UPDATE stores SET vendor_id = $1 WHERE id = $2', [v[0].id, storeId]);
    await upsertStore(client, store({ name: 'Third Write' }), storeId);
    const { rows: vAfter } = await client.query('SELECT vendor_id FROM stores WHERE id = $1', [storeId]);
    check('vendor_id untouched when not supplied', vAfter[0].vendor_id === v[0].id);

    // --- vendor mapping: the StoreDetail control's exact SQL ----------------
    // updateStore's vendor-only fast path runs precisely this UPDATE. Nothing
    // else about the store may move, and its tasks must stay attached.
    console.log('\n== vendor mapping / unmapping touches nothing else ==');
    const { rows: preMap } = await client.query(
      `SELECT id, customer_code, uid, name, address, pincode, lat, long,
              contact_no, contact_email, contact_person, outlet_status, created_at
       FROM stores WHERE id = $1`,
      [storeId]
    );
    const snapshot = preMap[0];

    // map -> vendor
    await client.query('UPDATE stores SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [v[0].id, storeId]);
    // unmap -> null
    await client.query('UPDATE stores SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [null, storeId]);
    // map again
    await client.query('UPDATE stores SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [v[0].id, storeId]);

    const { rows: postMap } = await client.query(
      `SELECT id, customer_code, uid, name, address, pincode, lat, long,
              contact_no, contact_email, contact_person, outlet_status, created_at, vendor_id
       FROM stores WHERE id = $1`,
      [storeId]
    );
    const after2 = postMap[0];
    check('vendor_id ends up mapped', after2.vendor_id === v[0].id);
    for (const col of ['id', 'customer_code', 'uid', 'name', 'address', 'pincode',
                       'contact_no', 'contact_email', 'contact_person', 'outlet_status'] as const) {
      check(`map/unmap left ${col} unchanged`,
        String(after2[col]) === String(snapshot[col]), `${snapshot[col]} -> ${after2[col]}`);
    }
    check('map/unmap left lat/long unchanged',
      Number(after2.lat) === Number(snapshot.lat) && Number(after2.long) === Number(snapshot.long));
    check('map/unmap left created_at unchanged',
      new Date(after2.created_at).getTime() === new Date(snapshot.created_at).getTime());

    const { rows: taskStill } = await client.query(
      'SELECT store_id FROM tasks WHERE id = $1', [taskId]
    );
    check('task still attached to the store after map/unmap', taskStill[0].store_id === storeId);
    const { rows: taskCount } = await client.query(
      'SELECT COUNT(*)::int n FROM tasks WHERE store_id = $1', [storeId]
    );
    check('task count on the store unchanged', taskCount[0].n === 1, String(taskCount[0].n));

    console.log('\n== identity conflicts are refused ==');
    const other = await upsertStore(client, store({ customer_code: `${TAG}-CC2`, uid: `${TAG}-U2` }), null);
    lookup = await loadStoreIdentityLookup(client);
    const conflict = resolveStoreIdentity(lookup, `${TAG}-CC1`, `${TAG}-U2`);
    check('code->A + uid->B is refused', !conflict.ok, JSON.stringify(conflict));
    const stolenUid = resolveStoreIdentity(lookup, `${TAG}-CC-NEW`, `${TAG}-U2`);
    check('new code with another store\'s uid is refused', !stolenUid.ok);
    check('second store really was separate', other.store.id !== storeId);

    console.log('\n== batched bulk upsert ==');
    const before = await client.query('SELECT COUNT(*)::int n FROM stores');
    const res = await bulkUpsertStores(client, [
      store({ name: 'Bulk Updated' }),                                        // existing -> update
      store({ customer_code: `${TAG}-CC3`, uid: `${TAG}-U3`, name: 'Bulk New' }), // new -> insert
    ]);
    check('bulk reports 1 created', res.created === 1, JSON.stringify(res));
    check('bulk reports 1 updated', res.updated === 1, JSON.stringify(res));
    const after = await client.query('SELECT COUNT(*)::int n FROM stores');
    check('exactly one new row added', after.rows[0].n === before.rows[0].n + 1);
    const { rows: bulkUpdated } = await client.query('SELECT id, name FROM stores WHERE id = $1', [storeId]);
    check('bulk update kept the same id', bulkUpdated[0].id === storeId && bulkUpdated[0].name === 'Bulk Updated');

    console.log('\n== absent optional fields do not wipe stored values ==');
    // Snapshot whatever is actually stored right now rather than assuming a
    // literal — earlier writes in this script legitimately change these values,
    // and the property under test is "unchanged by a row that omits them",
    // not any particular value.
    const { rows: beforePreserve } = await client.query(
      'SELECT contact_email, outlet_status FROM stores WHERE id = $1', [storeId]
    );
    const priorEmail: string | null = beforePreserve[0].contact_email;
    const priorStatus: string | null = beforePreserve[0].outlet_status;
    check('precondition: both fields are set before the test', !!priorEmail && !!priorStatus);

    await bulkUpsertStores(client, [store({ contact_email: null, outlet_status: null, name: 'Preserve Test' })]);
    const { rows: preserved } = await client.query(
      'SELECT contact_email, outlet_status, name FROM stores WHERE id = $1', [storeId]
    );
    check('contact_email preserved when the row omits it',
      preserved[0].contact_email === priorEmail, `${priorEmail} -> ${preserved[0].contact_email}`);
    check('outlet_status preserved when the row omits it',
      preserved[0].outlet_status === priorStatus, `${priorStatus} -> ${preserved[0].outlet_status}`);
    check('neither was nulled out',
      preserved[0].contact_email !== null && preserved[0].outlet_status !== null);
    check('a field the row DID supply was still updated', preserved[0].name === 'Preserve Test');

    console.log('\n== uniqueness backstops ==');
    let raced = false;
    try {
      await client.query('SAVEPOINT sp');
      await client.query(
        `INSERT INTO stores (customer_code, uid, name, address, pincode, lat, long)
         VALUES ($1,$2,'Dup','A','1',1,1)`,
        [`${TAG}-cc1`, `${TAG}-UNIQUE`] // different case, same code
      );
      await client.query('RELEASE SAVEPOINT sp');
    } catch {
      raced = true;
      await client.query('ROLLBACK TO SAVEPOINT sp');
    }
    check('case-insensitive duplicate customer_code rejected by the index', raced);

    await client.query('ROLLBACK');
    console.log('\n(transaction rolled back — database unchanged)');
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nERROR (transaction rolled back):', (e as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
