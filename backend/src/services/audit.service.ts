import { pool } from '../config/db';

/**
 * Audit trail: who changed what, attributed to the account's EMAIL.
 *
 * Written by the auditTrail middleware for every successful change made through
 * the API by a non-employee account. Pure helpers (describeRequest, sanitizeDetails)
 * are separate so they can be tested without a database.
 */

const SECRET_KEY = /pass(word)?|token|secret|authorization|file|base64|content|buffer|data$/i;
const MAX_DETAILS_CHARS = 4000;

/** Request body with anything secret or bulky removed, size-capped, safe to store. */
export function sanitizeDetails(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) { out[k] = '[hidden]'; continue; }
    if (typeof v === 'string') out[k] = v.length > 300 ? `${v.slice(0, 300)}…` : v;
    else if (Array.isArray(v)) out[k] = v.length > 20 ? `[${v.length} items]` : v;
    else out[k] = v;
  }
  const json = JSON.stringify(out);
  if (json.length > MAX_DETAILS_CHARS) return { note: 'details too large to store', keys: Object.keys(out) };
  return Object.keys(out).length ? out : null;
}

interface Described { description: string; entity_type: string | null; label: string | null }

type Rule = (b: Record<string, any>, resBody: Record<string, any> | null) => Described;

const nameOf = (b: Record<string, any>) =>
  b.name ?? ([b.first_name, b.last_name].filter(Boolean).join(' ') || b.email) ?? null;

// Keyed "METHOD /api/mount/route/pattern". Anything unlisted still gets logged with a
// generic description, so a newly added endpoint is never silently unaudited.
const RULES: Record<string, Rule> = {
  'POST /api/users': (b) => ({ description: 'Created a user account', entity_type: 'user', label: b.email ?? nameOf(b) }),
  'PUT /api/users/:id/password': () => ({ description: 'Set a new password for an account', entity_type: 'user', label: null }),
  'PATCH /api/users/:id/status': (b) => ({ description: b.is_active ? 'Activated an account' : 'Deactivated an account', entity_type: 'user', label: null }),
  'PATCH /api/users/:id': (b) => ({ description: 'Edited an account', entity_type: 'user', label: b.email ?? nameOf(b) }),
  'PATCH /api/users/:id/role': () => ({ description: 'Changed an account\'s custom role', entity_type: 'user', label: null }),
  'DELETE /api/users/:id': () => ({ description: 'Deleted an employee account', entity_type: 'user', label: null }),
  'POST /api/brands': (b) => ({ description: 'Created a brand', entity_type: 'brand', label: b.name ?? null }),
  'POST /api/roles': (b) => ({ description: 'Created a role', entity_type: 'role', label: b.name ?? null }),
  'PATCH /api/roles/:id': (b) => ({ description: 'Edited a role', entity_type: 'role', label: b.name ?? null }),
  'POST /api/vendors': (b) => ({ description: 'Created a vendor', entity_type: 'vendor', label: b.name ?? null }),
  'PATCH /api/vendors/:id': (b) => ({ description: 'Edited a vendor', entity_type: 'vendor', label: b.name ?? null }),
  'PATCH /api/vendors/:id/status': (b) => ({ description: b.is_active ? 'Activated a vendor' : 'Deactivated a vendor', entity_type: 'vendor', label: null }),
  'POST /api/stores': (b) => ({ description: 'Created / updated a store', entity_type: 'store', label: b.name ?? b.customer_code ?? null }),
  'PATCH /api/stores/:id': (b) => ({ description: 'Edited a store', entity_type: 'store', label: b.name ?? null }),
  'POST /api/stores/:id/assignments': () => ({ description: 'Assigned an employee to a store', entity_type: 'store', label: null }),
  'DELETE /api/stores/:id/assignments/:employee_id': () => ({ description: 'Removed an employee from a store', entity_type: 'store', label: null }),
  'POST /api/artworks': (b) => ({ description: 'Created an artwork', entity_type: 'artwork', label: b.name ?? null }),
  'PATCH /api/artworks/:id': (b) => ({ description: 'Edited an artwork', entity_type: 'artwork', label: b.name ?? null }),
  'POST /api/tasks': (b) => ({ description: `Created a ${b.task_type ?? ''} task`.replace('  ', ' '), entity_type: 'task', label: null }),
  'POST /api/tasks/:id/assign': () => ({ description: 'Assigned / reassigned a task', entity_type: 'task', label: null }),
  'POST /api/tasks/assign-bulk': (b) => ({ description: `Bulk-assigned ${Array.isArray(b.task_ids) ? b.task_ids.length : ''} tasks`.replace('  ', ' '), entity_type: 'task', label: null }),
  'DELETE /api/tasks/:id': () => ({ description: 'Cancelled (deleted) a task', entity_type: 'task', label: null }),
  'POST /api/tasks/:id/approve': (b) => ({ description: b.approval_status === 'rejected' ? 'Rejected a recee' : 'Approved a recee', entity_type: 'task', label: null }),
  'POST /api/tasks/approve-bulk': (b) => ({ description: b.action === 'reject' ? 'Bulk-rejected recees' : 'Bulk-approved recees', entity_type: 'task', label: null }),
  'POST /api/bulk/users': () => ({ description: 'Bulk-uploaded users', entity_type: 'user', label: null }),
  'POST /api/bulk/tasks': () => ({ description: 'Bulk-uploaded tasks', entity_type: 'task', label: null }),
  'POST /api/bulk/stores': () => ({ description: 'Bulk-uploaded stores', entity_type: 'store', label: null }),
  'POST /api/bulk/vendors': () => ({ description: 'Bulk-uploaded vendors', entity_type: 'vendor', label: null }),
  'POST /api/password-requests/:id/resolve': () => ({ description: 'Resolved a password request (set a new password)', entity_type: 'password_request', label: null }),
  'POST /api/password-requests/:id/dismiss': () => ({ description: 'Dismissed a password request', entity_type: 'password_request', label: null }),
};

/** Human description + entity for a request. Pure. */
export function describeRequest(
  method: string, routePattern: string, body: unknown, resBody: unknown
): Described & { action: string } {
  const action = `${method} ${routePattern}`;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const r = (resBody && typeof resBody === 'object' ? resBody : null) as Record<string, any> | null;
  const rule = RULES[action];
  if (rule) return { action, ...rule(b, r) };
  return { action, description: `${method} ${routePattern}`, entity_type: null, label: null };
}

export interface AuditInput {
  actorId: string;
  method: string;
  routePattern: string;
  entityId: string | null;
  body: unknown;
  resBody: unknown;
  ip: string | null;
}

/** Writes one audit row. Never throws: auditing must not break the action it records. */
export async function writeAudit(a: AuditInput): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT email, name, role FROM users WHERE id = $1', [a.actorId]);
    const actor = rows[0];
    if (!actor) return;
    const d = describeRequest(a.method, a.routePattern, a.body, a.resBody);
    const resId = a.resBody && typeof a.resBody === 'object' ? (a.resBody as Record<string, any>).id : null;
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_email, actor_name, actor_role, action, description, entity_type, entity_id, entity_label, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [a.actorId, actor.email, actor.name, actor.role, d.action, d.description, d.entity_type,
       a.entityId ?? (typeof resId === 'string' ? resId : null), d.label,
       JSON.stringify(sanitizeDetails(a.body)), a.ip]
    );
  } catch (e) {
    console.warn('[audit] could not record entry:', (e as Error)?.message);
  }
}
