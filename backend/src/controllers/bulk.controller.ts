import { Response } from 'express';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../types/domain';
import { resolveUserScope } from '../services/users.service';
import { isEmailConfigured, sendCredentialsEmail } from '../services/email.service';
import { env } from '../config/env';

interface RowError { row: number; reason: string }

// SSRF guard: the bulk endpoints fetch a user-supplied file_url server-side.
// Only allow URLs hosted on our own Supabase Storage origin so this can't be
// used to pull from internal/metadata endpoints (e.g. 169.254.169.254) or
// arbitrary intranet hosts.
const STORAGE_ORIGIN = (() => {
  try { return new URL(env.SUPABASE_URL).origin; } catch { return ''; }
})();

function assertAllowedFileUrl(fileUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(fileUrl); } catch { throw new Error('file_url is not a valid URL'); }
  if (parsed.protocol !== 'https:') throw new Error('file_url must use https');
  if (!STORAGE_ORIGIN || parsed.origin !== STORAGE_ORIGIN) {
    throw new Error('file_url must point to the configured storage bucket');
  }
}

async function fetchSheetRows(fileUrl: string): Promise<Record<string, unknown>[]> {
  assertAllowedFileUrl(fileUrl);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Could not download file (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
}

function str(v: unknown): string {
  return (v === undefined || v === null) ? '' : String(v).trim();
}

const CHUNK = 500;

/**
 * Insert pre-validated rows in chunks via multi-row VALUES, inside the given client.
 * Returns the concatenated RETURNING rows. `conflict` lets callers add ON CONFLICT clauses.
 */
async function chunkedInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  valueRows: unknown[][],
  opts: { conflict?: string; returning?: string } = {}
): Promise<any[]> {
  const ncols = columns.length;
  const out: any[] = [];
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    const chunk = valueRows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map((_, ri) => `(${columns.map((__, ci) => `$${ri * ncols + ci + 1}`).join(',')})`)
      .join(',');
    const params = chunk.flat();
    const sql =
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}` +
      (opts.conflict ? ` ${opts.conflict}` : '') +
      (opts.returning ? ` RETURNING ${opts.returning}` : '');
    const r = await client.query(sql, params);
    out.push(...r.rows);
  }
  return out;
}

/** Run the insert phase in a single transaction on one pooled client. */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------------
/**
 * Bulk onboard users from an Excel file.
 * Expected columns: first_name, last_name, email, role, mobile, password (optional), vendor_uid (optional)
 */
const ROLE_LETTER: Partial<Record<UserRole, string>> = { employee: 'E', vendor_admin: 'A', vendor_user: 'U' };
const VENDOR_SCOPED: UserRole[] = ['vendor_admin', 'vendor_user', 'employee'];

export async function bulkUsers(req: AuthRequest, res: Response) {
  const { file_url } = req.body;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const vendorByUid = new Map<string, { id: string; code: number }>();
  const vendorById = new Map<string, number>();
  const { rows: vendors } = await pool.query('SELECT id, uid, code FROM vendors');
  for (const v of vendors) { vendorByUid.set(String(v.uid), { id: v.id, code: v.code }); vendorById.set(v.id, v.code); }

  const failed: RowError[] = [];
  interface Valid { row: number; name: string; first: string; last: string; email: string; password: string; role: UserRole; mobile: string | null; vendorId: string | null; }
  const valid: Valid[] = [];
  const seenEmails = new Set<string>();

  // Phase 1 — validate every row in JS (no DB writes), collect per-row errors.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      const role = str(r.role) as UserRole;
      const vendorUid = str(r.vendor_uid);
      const bodyVendorId = vendorUid ? vendorByUid.get(vendorUid)?.id ?? null : null;
      if (vendorUid && !bodyVendorId) throw new Error(`Unknown vendor_uid "${vendorUid}"`);
      const scope = resolveUserScope(req.user!, role, bodyVendorId);

      const first = str(r.first_name), last = str(r.last_name), email = str(r.email);
      if (!first || !last) throw new Error('first_name and last_name are required');
      if (!email) throw new Error('email is required');
      const key = email.toLowerCase();
      if (seenEmails.has(key)) throw new Error('Duplicate email within the file');
      seenEmails.add(key);

      valid.push({
        row: rowNum, name: `${first} ${last}`.trim(), first, last, email: email.toLowerCase(),
        password: str(r.password) || 'password123',
        role: scope.role, mobile: str(r.mobile) || null, vendorId: scope.vendor_id,
      });
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // Pre-check existing emails. All-or-nothing: any failure (validation or a
  // pre-existing email) aborts the whole import — nothing is inserted, so a
  // failed upload never leaves a partial result the admin has to untangle.
  if (valid.length) {
    const { rows: ex } = await pool.query(
      'SELECT lower(email) AS e FROM users WHERE lower(email) = ANY($1)',
      [valid.map((v) => v.email.toLowerCase())]
    );
    const existing = new Set(ex.map((x) => x.e));
    for (const v of valid) {
      if (existing.has(v.email.toLowerCase())) failed.push({ row: v.row, reason: `Email already exists: ${v.email}` });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }
  if (!valid.length) {
    res.json({ inserted: 0, failed });
    return;
  }

  // Per-(vendor,role) running UID counter seeded from current DB counts.
  const counters = new Map<string, number>();
  for (const v of valid) {
    if (!v.vendorId || !ROLE_LETTER[v.role]) continue;
    const k = `${v.vendorId}|${v.role}`;
    if (!counters.has(k)) {
      const { rows: c } = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE vendor_id = $1 AND role = $2', [v.vendorId, v.role]);
      counters.set(k, c[0].n);
    }
  }

  const hashes = await Promise.all(valid.map((v) => bcrypt.hash(v.password, 10)));
  const tuples = valid.map((v, idx) => {
    let uid: string | null = null;
    if (v.vendorId && ROLE_LETTER[v.role]) {
      const k = `${v.vendorId}|${v.role}`;
      const next = counters.get(k)! + 1; counters.set(k, next);
      uid = `V${vendorById.get(v.vendorId)}-${ROLE_LETTER[v.role]}${String(next).padStart(3, '0')}`;
    }
    return [v.name, v.first, v.last, v.email, hashes[idx], v.role, v.mobile, v.vendorId, uid];
  });

  const out = await inTransaction((client) => chunkedInsert(
    client, 'users',
    ['name', 'first_name', 'last_name', 'email', 'password_hash', 'role', 'phone', 'vendor_id', 'uid'],
    tuples, { returning: 'id' }
  ));
  const inserted = out.length;

  // Email credentials to the newly-onboarded users (best-effort, capped
  // concurrency). No-op unless SMTP is configured. For very large imports a
  // background queue would be preferable.
  let emailed = 0;
  if (isEmailConfigured() && valid.length) {
    const CONC = 5;
    for (let i = 0; i < valid.length; i += CONC) {
      const slice = valid.slice(i, i + CONC);
      const results = await Promise.all(slice.map((u) =>
        sendCredentialsEmail({ to: u.email, name: u.name, email: u.email, password: u.password, role: u.role })
      ));
      emailed += results.filter(Boolean).length;
    }
  }
  res.json({ inserted, emailed, failed });
}

// ----------------------------------------------------------------------------
/**
 * Bulk create tasks from an Excel file (RJCorp admin only).
 * Each task type has its own template, so `kind` (recee | direct | direct_boarding)
 * fixes the type for every row and the sheet omits the task_type/installation_type
 * columns. When `kind` is absent, the legacy combined format is read per-row.
 * Type-specific columns: vendor_uid, store_uid, pincode,
 *   target_pamphlet_count (direct), brand_name, artwork_name, width_in, height_in
 *   (direct_boarding). Board size is width_in / height_in (inches) → custom cm.
 * Store is identified by store_uid only — no store_name fallback, since names
 * can collide across vendors/stores while UIDs are unambiguous.
 */
const INCH_TO_CM = 2.54;
// kind → [task_type, installation_type]
const TASK_KIND: Record<string, [string, string | null]> = {
  recee: ['recee', null],
  direct: ['installation', 'direct'],
  direct_boarding: ['installation', 'direct_boarding'],
};

export async function bulkTasks(req: AuthRequest, res: Response) {
  const { file_url, kind } = req.body as { file_url: string; kind?: string };
  const fixedType = kind ? TASK_KIND[kind] : null;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const vendorByUid = new Map<string, string>();
  for (const v of (await pool.query('SELECT id, uid FROM vendors')).rows) vendorByUid.set(String(v.uid), v.id);
  const storeByUid = new Map<string, string>();
  for (const s of (await pool.query('SELECT id, uid FROM stores WHERE uid IS NOT NULL')).rows) {
    storeByUid.set(String(s.uid).toLowerCase(), s.id);
  }
  const brandByName = new Map<string, string>();
  for (const b of (await pool.query('SELECT id, name FROM brands')).rows) brandByName.set(String(b.name).toLowerCase(), b.id);
  // Artworks keyed by `${brand_id}|${lower(name)}` — must match the row's brand.
  const artworkByBrandName = new Map<string, string>();
  for (const a of (await pool.query('SELECT id, brand_id, name FROM artworks')).rows) {
    artworkByBrandName.set(`${a.brand_id}|${String(a.name).toLowerCase()}`, a.id);
  }

  const failed: RowError[] = [];
  const tuples: unknown[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      let taskType: string;
      let installationType: string | null;
      if (fixedType) {
        // Type-specific template: the kind fixes the type; sheet has no type columns.
        [taskType, installationType] = fixedType;
      } else {
        // Legacy combined template: read the type from the row.
        taskType = str(r.task_type);
        if (!['recee', 'installation'].includes(taskType)) throw new Error(`Invalid task_type "${taskType}"`);
        installationType = null;
        if (taskType === 'installation') {
          installationType = str(r.installation_type);
          if (installationType !== 'direct' && installationType !== 'direct_boarding') {
            throw new Error('installation_type must be "direct" or "direct_boarding"');
          }
        }
      }
      const isBoarding = installationType === 'direct_boarding';
      const storeUid = str(r.store_uid);
      if ((taskType === 'recee' || isBoarding) && !storeUid) {
        throw new Error(`store_uid is required for ${taskType === 'recee' ? 'recee' : 'boarding installation'} tasks`);
      }

      const vendorUid = str(r.vendor_uid);
      const vendorId = vendorUid ? vendorByUid.get(vendorUid) : null;
      if (!vendorId) throw new Error(`Unknown vendor_uid "${vendorUid}"`);

      let storeId: string | null = null;
      if (storeUid) {
        storeId = storeByUid.get(storeUid.toLowerCase()) ?? null;
        if (!storeId) throw new Error(`Unknown store_uid "${storeUid}"`);
      }

      let brandId: string | null = null, artworkId: string | null = null;
      let customW: number | null = null, customH: number | null = null;
      if (isBoarding) {
        const bn = str(r.brand_name);
        if (bn) { brandId = brandByName.get(bn.toLowerCase()) ?? null; if (!brandId) throw new Error(`Unknown brand_name "${bn}"`); }
        const an = str(r.artwork_name);
        if (an) {
          if (!brandId) throw new Error('brand_name is required when artwork_name is given');
          artworkId = artworkByBrandName.get(`${brandId}|${an.toLowerCase()}`) ?? null;
          if (!artworkId) throw new Error(`Unknown artwork_name "${an}" for the given brand`);
        }
        // Board size as width_in x height_in (inches) -> stored as custom cm.
        const wStr = str(r.width_in), hStr = str(r.height_in);
        if (wStr || hStr) {
          const w = parseFloat(wStr), h = parseFloat(hStr);
          if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
            throw new Error('width_in and height_in must both be positive numbers (inches)');
          }
          customW = Math.round(w * INCH_TO_CM);
          customH = Math.round(h * INCH_TO_CM);
        }
      }
      const tpcStr = installationType === 'direct' ? str(r.target_pamphlet_count) : '';
      const tpc = tpcStr ? parseInt(tpcStr, 10) : null;

      tuples.push([taskType, installationType, vendorId, storeId, brandId, artworkId, customW, customH, str(r.pincode) || null, tpc]);
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // All-or-nothing: if any row failed validation, import nothing.
  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }

  let inserted = 0;
  if (tuples.length) {
    await inTransaction(async (client) => {
      const created = await chunkedInsert(
        client, 'tasks',
        ['task_type', 'installation_type', 'vendor_id', 'store_id', 'brand_id', 'artwork_id', 'custom_width_cm', 'custom_height_cm', 'pincode', 'target_pamphlet_count'],
        tuples, { returning: 'id, installation_type, brand_id, artwork_id, custom_width_cm, custom_height_cm' }
      );
      inserted = created.length;
      // Each direct_boarding task needs a one-signage plan so the employee sees a requirement.
      const planTuples = created
        .filter((t) => t.installation_type === 'direct_boarding')
        .map((t) => [t.id, 1, null, null, t.custom_width_cm, t.custom_height_cm, t.brand_id, t.artwork_id]);
      if (planTuples.length) {
        await chunkedInsert(
          client, 'task_signage_plan',
          ['task_id', 'signage_index', 'signage_type', 'boarding_size_id', 'custom_width_cm', 'custom_height_cm', 'brand_id', 'artwork_id'],
          planTuples
        );
      }
    });
  }
  res.json({ inserted, failed });
}

// ----------------------------------------------------------------------------
/**
 * Bulk create stores from an Excel file (RJCorp admin only).
 * Columns: name, address, pincode, lat, long, uid, contact_no, contact_email, contact_person, vendor_uid
 */
export async function bulkStores(req: AuthRequest, res: Response) {
  const { file_url } = req.body;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const vendorByUid = new Map<string, string>();
  for (const v of (await pool.query('SELECT id, uid FROM vendors')).rows) vendorByUid.set(String(v.uid), v.id);

  const failed: RowError[] = [];
  interface V { row: number; tuple: unknown[]; uid: string | null }
  const valid: V[] = [];
  const seenUids = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      const name = str(r.name), address = str(r.address), pincode = str(r.pincode);
      const lat = parseFloat(str(r.lat)), long = parseFloat(str(r.long));
      if (!name || !address || !pincode) throw new Error('name, address and pincode are required');
      if (isNaN(lat) || isNaN(long)) throw new Error('lat and long must be numbers');

      const uid = str(r.uid) || null;
      if (uid) {
        if (seenUids.has(uid)) throw new Error(`Duplicate store uid within the file: ${uid}`);
        seenUids.add(uid);
      }
      const vendorUid = str(r.vendor_uid);
      let vendorId: string | null = null;
      if (vendorUid) { vendorId = vendorByUid.get(vendorUid) ?? null; if (!vendorId) throw new Error(`Unknown vendor_uid "${vendorUid}"`); }

      valid.push({
        row: rowNum, uid,
        tuple: [name, address, pincode, lat, long, uid, str(r.contact_no) || null, str(r.contact_email) || null, str(r.contact_person) || null, vendorId],
      });
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // Existing-uid check. All-or-nothing: any failure aborts the whole import.
  const withUid = valid.filter((v) => v.uid).map((v) => v.uid!) as string[];
  if (withUid.length) {
    const { rows: ex } = await pool.query('SELECT uid FROM stores WHERE uid = ANY($1)', [withUid]);
    const existing = new Set(ex.map((x) => x.uid));
    for (const v of valid) {
      if (v.uid && existing.has(v.uid)) failed.push({ row: v.row, reason: `Store UID already exists: ${v.uid}` });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }

  let inserted = 0;
  if (valid.length) {
    const out = await inTransaction((client) => chunkedInsert(
      client, 'stores',
      ['name', 'address', 'pincode', 'lat', 'long', 'uid', 'contact_no', 'contact_email', 'contact_person', 'vendor_id'],
      valid.map((v) => v.tuple), { returning: 'id' }
    ));
    inserted = out.length;
  }
  res.json({ inserted, failed });
}

// ----------------------------------------------------------------------------
/**
 * Bulk create vendors from an Excel file (RJCorp admin only).
 * Columns: name (required), contact_person, contact_phone, contact_email. UID auto-generated (VND-NNN).
 */
export async function bulkVendors(req: AuthRequest, res: Response) {
  const { file_url } = req.body;
  let rows: Record<string, unknown>[];
  try { rows = await fetchSheetRows(file_url); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const failed: RowError[] = [];
  interface V { row: number; email: string | null; tuple: unknown[] }
  const valid: V[] = [];
  const seenEmails = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    try {
      const name = str(r.name);
      if (!name) throw new Error('name is required');
      const email = str(r.contact_email) || null;
      if (email) {
        const key = email.toLowerCase();
        if (seenEmails.has(key)) throw new Error(`Duplicate email within the file: ${email}`);
        seenEmails.add(key);
      }
      valid.push({ row: rowNum, email, tuple: [name, str(r.contact_person) || null, str(r.contact_phone) || null, email] });
    } catch (e) {
      failed.push({ row: rowNum, reason: (e as Error).message || 'Unknown error' });
    }
  }

  // Existing-email check (case-insensitive). All-or-nothing: any failure aborts the whole import.
  const withEmail = valid.filter((v) => v.email);
  if (withEmail.length) {
    const { rows: ex } = await pool.query(
      'SELECT lower(contact_email) AS e FROM vendors WHERE contact_email IS NOT NULL AND lower(contact_email) = ANY($1)',
      [withEmail.map((v) => v.email!.toLowerCase())]
    );
    const existing = new Set(ex.map((x) => x.e));
    for (const v of withEmail) {
      if (existing.has(v.email!.toLowerCase())) failed.push({ row: v.row, reason: `Vendor email already exists: ${v.email}` });
    }
  }

  if (failed.length) {
    failed.sort((a, b) => a.row - b.row);
    res.json({ inserted: 0, failed });
    return;
  }

  let inserted = 0;
  if (valid.length) {
    await inTransaction(async (client) => {
      const created = await chunkedInsert(
        client, 'vendors',
        ['name', 'contact_person', 'contact_phone', 'contact_email'],
        valid.map((v) => v.tuple), { returning: 'id, code' }
      );
      inserted = created.length;
      // Assign VND-NNN UIDs from the auto-generated codes in one batched UPDATE.
      if (created.length) {
        await client.query(
          `UPDATE vendors v SET uid = data.uid
           FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS uid) data
           WHERE v.id = data.id`,
          [created.map((c) => c.id), created.map((c) => `VND-${String(c.code).padStart(3, '0')}`)]
        );
      }
    });
  }
  res.json({ inserted, failed });
}
