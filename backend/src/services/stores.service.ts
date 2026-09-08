import { Pool, PoolClient } from 'pg';
import { pool } from '../config/db';
import { str, validateOptionalEmail, joinAddressParts } from './validation';

/** Anything we can run a query on — the pool, or a client inside a transaction. */
type Queryable = Pool | PoolClient;

export const STORE_COLUMNS =
  'id, uid, customer_code, name, address, pincode, lat, long, contact_no, contact_email, ' +
  'contact_person, outlet_status, source_metadata, vendor_id, created_at, updated_at';

export interface StoreInput {
  customer_code: string;
  uid: string;
  name: string;
  address: string;
  pincode: string;
  lat: number;
  long: number;
  contact_no?: string | null;
  contact_email?: string | null;
  contact_person?: string | null;
  outlet_status?: string | null;
  /**
   * undefined => leave whatever the store already has (the normal case now that
   * vendor_uid is gone from store creation). null => explicitly clear it.
   * Never let an upsert silently unmap an existing store from its vendor.
   */
  vendor_id?: string | null;
  /** undefined => leave untouched. Written only by the customer-master import. */
  source_metadata?: Record<string, unknown> | null;
}

export type UpsertOutcome = 'created' | 'updated';

// ----------------------------------------------------------------------------
// Identity resolution — THE rule for create-vs-update, shared by every entry
// point so manual, API and bulk can never drift apart.

export interface IdentityLookup {
  /** lower(customer_code) -> store id */
  byCode(code: string): string | undefined;
  /** lower(uid) -> store id */
  byUid(uid: string): string | undefined;
}

export type IdentityResult =
  | { ok: true; targetId: string | null } // null => insert a new store
  | { ok: false; reason: string };

/**
 * Decide which store (if any) a Customer Code + Store UID pair refers to.
 *
 * Customer Code is the primary lookup key. Store UID is a second unique
 * identifier, so the two can disagree — and when they do we refuse rather than
 * guess, because either choice would silently corrupt one of the two stores.
 *
 *   code -> A, uid -> A      update A
 *   code -> A, uid -> none   update A (its uid is being changed to the new one)
 *   code -> A, uid -> B      CONFLICT — the code and the UID name different stores
 *   code -> none, uid -> B   CONFLICT — this UID already belongs to another store
 *   code -> none, uid -> none create
 */
export function resolveStoreIdentity(
  lookup: IdentityLookup,
  customerCode: string,
  uid: string
): IdentityResult {
  const byCode = lookup.byCode(customerCode.toLowerCase());
  const byUid = lookup.byUid(uid.toLowerCase());

  if (byCode && byUid) {
    if (byCode !== byUid) {
      return {
        ok: false,
        reason:
          `Conflicting identity: customer_code "${customerCode}" and uid "${uid}" ` +
          `belong to two different stores. Fix one of them and re-upload.`,
      };
    }
    return { ok: true, targetId: byCode };
  }
  if (byCode) return { ok: true, targetId: byCode };
  if (byUid) {
    return {
      ok: false,
      reason:
        `Conflicting identity: uid "${uid}" already belongs to another store ` +
        `with a different customer_code. Store UIDs must be unique.`,
    };
  }
  return { ok: true, targetId: null };
}

/** Build a lookup over the whole stores table (one query; the table is small). */
export async function loadStoreIdentityLookup(q: Queryable = pool): Promise<IdentityLookup> {
  const { rows } = await q.query(
    `SELECT id, lower(customer_code) AS code, lower(uid) AS uid FROM stores`
  );
  const codes = new Map<string, string>();
  const uids = new Map<string, string>();
  for (const r of rows) {
    if (r.code) codes.set(r.code, r.id);
    if (r.uid) uids.set(r.uid, r.id);
  }
  return { byCode: (c) => codes.get(c), byUid: (u) => uids.get(u) };
}

// ----------------------------------------------------------------------------
// Row validation — shared by manual create/edit and bulk import.

export interface NormalizedStore {
  input: StoreInput;
  errors: string[];
}

/**
 * Columns that carry no store field of their own. They are operational context
 * from the customer master, kept with the store in source_metadata so nothing
 * from the source row is lost, and required because the store template requires
 * them — the onboarding form collects exactly the same set.
 */
export const METADATA_COLUMNS = ['HOS', 'State_CD', 'CHANNEL', 'SUB_CHANNEL'] as const;

/**
 * Validate + normalise one store payload (an API body or a spreadsheet row).
 * Collects ALL problems rather than throwing on the first, so a bulk row can
 * report everything wrong with it in a single pass.
 *
 * `requireContactEmail` is false for the customer-master channel: that export
 * has no email column at all, so demanding one would make the whole file
 * unimportable.
 *
 * `requireMetadata` enforces HOS / State_CD / CHANNEL / SUB_CHANNEL. Both the
 * store form and the store template collect them, so both pass it — this is
 * what stops the two drifting apart again.
 */
export function normalizeStoreInput(
  raw: Record<string, unknown>,
  opts: { requireContactEmail?: boolean; requireMetadata?: boolean } = {}
): NormalizedStore {
  const errors: string[] = [];

  if (opts.requireMetadata) {
    for (const key of METADATA_COLUMNS) {
      const meta = (raw.source_metadata ?? {}) as Record<string, unknown>;
      if (!str(raw[key]) && !str(meta[key])) errors.push(`${key} is required`);
    }
  }

  const customer_code = str(raw.customer_code);
  // Customer Code is the store's single identifier: it is what the console
  // shows and what every template collects. uid is no longer collected, but
  // tasks, images and older spreadsheets still look stores up by it, so it is
  // kept in step with the code rather than left empty. An explicitly supplied
  // uid still wins, which is what preserves existing values on update.
  const uid = str(raw.uid) || customer_code;
  const name = str(raw.name);
  // The store form and the store template both supply the address as
  // ADDR_1..ADDR_5, so they are joined here rather than in either caller. A
  // pre-joined `address` still wins, which is what the bulk mapper passes.
  const address = str(raw.address) ||
    joinAddressParts([raw.ADDR_1, raw.ADDR_2, raw.ADDR_3, raw.ADDR_4, raw.ADDR_5]);
  const pincode = str(raw.pincode);

  if (!customer_code) errors.push('customer_code (Customer Code) is required');
  if (!name) errors.push('name is required');
  if (!address) errors.push('address (ADDR_1) is required');
  if (!pincode) errors.push('pincode is required');

  const lat = parseFloat(str(raw.lat));
  const long = parseFloat(str(raw.long));
  if (isNaN(lat) || isNaN(long)) {
    errors.push('lat and long must be numbers');
  } else {
    if (lat < -90 || lat > 90) errors.push('lat must be between -90 and 90');
    if (long < -180 || long > 180) errors.push('long must be between -180 and 180');
  }

  const emailCheck = validateOptionalEmail(raw.contact_email, 'contact_email');
  if (!emailCheck.ok) errors.push(emailCheck.reason!);
  if (opts.requireContactEmail && !str(raw.contact_email)) {
    errors.push('contact_email is required');
  }

  const input: StoreInput = {
    customer_code,
    uid,
    name,
    address,
    pincode,
    lat,
    long,
    contact_no: str(raw.contact_no) || null,
    contact_email: emailCheck.value,
    contact_person: str(raw.contact_person) || null,
    outlet_status: str(raw.outlet_status) || null,
  };
  if (raw.vendor_id !== undefined) input.vendor_id = (raw.vendor_id as string) || null;
  if (raw.source_metadata !== undefined) {
    input.source_metadata = raw.source_metadata as Record<string, unknown> | null;
  } else {
    // The store form sends HOS / State_CD / CHANNEL / SUB_CHANNEL as ordinary
    // fields; the bulk mapper sends the whole sheet row as source_metadata.
    // Collect the form's version here so both channels persist the same
    // context. Left unset when none were supplied, so an update that omits
    // them does not wipe what is already stored.
    const collected: Record<string, unknown> = {};
    for (const key of METADATA_COLUMNS) {
      const v = str(raw[key]);
      if (v) collected[key] = v;
    }
    if (Object.keys(collected).length) input.source_metadata = collected;
  }

  return { input, errors };
}

// ----------------------------------------------------------------------------
// Write

/**
 * Insert a new store, or update the existing one in place.
 *
 * An update NEVER touches stores.id, so tasks.store_id, store_assignments and
 * every other FK keep pointing at the same row — that is the whole reason this
 * is an UPDATE rather than a delete+recreate.
 *
 * vendor_id and source_metadata are only written when the caller explicitly
 * supplies them; omitting them preserves whatever the store already had.
 */
export async function upsertStore(
  q: Queryable,
  input: StoreInput,
  targetId: string | null
): Promise<{ store: Record<string, unknown>; outcome: UpsertOutcome }> {
  if (targetId) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    add('customer_code', input.customer_code);
    add('uid', input.uid);
    add('name', input.name);
    add('address', input.address);
    add('pincode', input.pincode);
    add('lat', input.lat);
    add('long', input.long);
    add('contact_no', input.contact_no ?? null);
    add('contact_email', input.contact_email ?? null);
    add('contact_person', input.contact_person ?? null);
    add('outlet_status', input.outlet_status ?? null);
    if (input.vendor_id !== undefined) add('vendor_id', input.vendor_id);
    if (input.source_metadata !== undefined) {
      add('source_metadata', input.source_metadata ? JSON.stringify(input.source_metadata) : null);
    }
    // stores.updated_at has existed since 001 but nothing has ever maintained it.
    sets.push('updated_at = NOW()');

    params.push(targetId);
    const { rows } = await q.query(
      `UPDATE stores SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${STORE_COLUMNS}`,
      params
    );
    return { store: rows[0], outcome: 'updated' };
  }

  const { rows } = await q.query(
    `INSERT INTO stores
       (customer_code, uid, name, address, pincode, lat, long,
        contact_no, contact_email, contact_person, outlet_status, vendor_id, source_metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${STORE_COLUMNS}`,
    [
      input.customer_code,
      input.uid,
      input.name,
      input.address,
      input.pincode,
      input.lat,
      input.long,
      input.contact_no ?? null,
      input.contact_email ?? null,
      input.contact_person ?? null,
      input.outlet_status ?? null,
      input.vendor_id ?? null,
      input.source_metadata ? JSON.stringify(input.source_metadata) : null,
    ]
  );
  return { store: rows[0], outcome: 'created' };
}

const UPSERT_COLS = [
  'customer_code', 'uid', 'name', 'address', 'pincode', 'lat', 'long',
  'contact_no', 'contact_email', 'contact_person', 'outlet_status', 'source_metadata',
] as const;

// Fields a channel may legitimately not carry (the customer-master export has
// no email column at all, the compact template has no source_metadata). COALESCE
// keeps whatever the store already had instead of nulling it, so importing
// through one channel never destroys data captured through the other.
const PRESERVE_IF_ABSENT = new Set(['contact_no', 'contact_email', 'contact_person', 'outlet_status', 'source_metadata']);

const CHUNK_SIZE = 200;

/**
 * Batched create-or-update keyed on Customer Code, for bulk import.
 *
 * One multi-row statement per chunk rather than a query per row — a 1,600-row
 * customer-master file would otherwise be 1,600 round-trips to a remote
 * database. Identity conflicts are resolved and rejected by the caller BEFORE
 * this runs, so the ON CONFLICT arbiter here only ever fires on customer_code.
 *
 * vendor_id is absent from the column list on purpose: an update leaves the
 * store's existing vendor mapping alone, and an insert defaults it to NULL.
 *
 * `xmax = 0` distinguishes a row that was inserted from one that was updated —
 * the standard way to get per-row outcomes out of an upsert.
 */
export async function bulkUpsertStores(
  client: PoolClient,
  inputs: StoreInput[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  const setClause = UPSERT_COLS
    .filter((c) => c !== 'customer_code')
    .map((c) =>
      PRESERVE_IF_ABSENT.has(c)
        ? `${c} = COALESCE(EXCLUDED.${c}, stores.${c})`
        : `${c} = EXCLUDED.${c}`
    )
    .concat('updated_at = NOW()')
    .join(', ');

  for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
    const chunk = inputs.slice(i, i + CHUNK_SIZE);
    const n = UPSERT_COLS.length;
    const placeholders = chunk
      .map((_, ri) => `(${UPSERT_COLS.map((__, ci) => `$${ri * n + ci + 1}`).join(',')})`)
      .join(',');

    const params: unknown[] = [];
    for (const s of chunk) {
      params.push(
        s.customer_code,
        s.uid,
        s.name,
        s.address,
        s.pincode,
        s.lat,
        s.long,
        s.contact_no ?? null,
        s.contact_email ?? null,
        s.contact_person ?? null,
        s.outlet_status ?? null,
        s.source_metadata ? JSON.stringify(s.source_metadata) : null
      );
    }

    const { rows } = await client.query(
      `INSERT INTO stores (${UPSERT_COLS.join(',')}) VALUES ${placeholders}
       ON CONFLICT (lower(customer_code)) WHERE customer_code IS NOT NULL
       DO UPDATE SET ${setClause}
       RETURNING (xmax = 0) AS inserted`,
      params
    );
    for (const r of rows) {
      if (r.inserted) created++;
      else updated++;
    }
  }

  return { created, updated };
}

/**
 * Translate a Postgres unique violation on stores into a message an operator
 * can act on. The pre-checks catch these first; this is the race-condition path.
 */
export function storeConflictMessage(e: unknown): string | null {
  if ((e as { code?: string }).code !== '23505') return null;
  const c = (e as { constraint?: string }).constraint ?? '';
  if (c.includes('customer_code')) return 'A store with this Customer Code already exists';
  if (c.includes('uid')) return 'A store with this Store UID already exists';
  return 'This store conflicts with an existing record';
}
