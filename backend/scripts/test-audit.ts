/**
 * Pure-logic checks for the audit trail and the roles overview helpers.
 * No database, no network.  Run: npx ts-node scripts/test-audit.ts
 */
import { sanitizeDetails, describeRequest } from '../src/services/audit.service';
import { baseRolePrivileges, capPrivileges, ALL_PRIVILEGES, RJCORP_ADMIN_ONLY } from '../src/auth/privileges';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

console.log('\n== audit details never store secrets ==');
{
  const d = sanitizeDetails({ email: 'a@b.com', password: 'hunter2', new_password: 'x', refresh_token: 't', file: 'BASE64...', name: 'Ok' })!;
  check('password is hidden', d.password === '[hidden]');
  check('new_password is hidden', d.new_password === '[hidden]');
  check('token is hidden', d.refresh_token === '[hidden]');
  check('uploaded file content is hidden', d.file === '[hidden]');
  check('ordinary fields are kept', d.email === 'a@b.com' && d.name === 'Ok');
  check('no secret value survives anywhere', !JSON.stringify(d).includes('hunter2'));
  check('long strings are truncated', String(sanitizeDetails({ note: 'x'.repeat(1000) })!.note).length < 400);
  check('big arrays are summarised', sanitizeDetails({ ids: Array.from({ length: 50 }, (_, i) => i) })!.ids === '[50 items]');
  check('empty / non-object bodies give null', sanitizeDetails(null) === null && sanitizeDetails([1]) === null && sanitizeDetails({}) === null);
  const huge = sanitizeDetails(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, 'y'.repeat(100)])))!;
  check('oversized details are replaced by a note', 'note' in huge);
}

console.log('\n== audit descriptions ==');
{
  const a = describeRequest('POST', '/api/users', { email: 'new@x.com', first_name: 'N', last_name: 'M', password: 'p' }, { id: '1' });
  check('user creation is described and labelled by email', a.description === 'Created a user account' && a.label === 'new@x.com' && a.entity_type === 'user');
  check('password reset is described without the password', describeRequest('PUT', '/api/users/:id/password', { password: 'p' }, null).description === 'Set a new password for an account');
  check('activation vs deactivation', describeRequest('PATCH', '/api/users/:id/status', { is_active: false }, null).description === 'Deactivated an account'
    && describeRequest('PATCH', '/api/users/:id/status', { is_active: true }, null).description === 'Activated an account');
  check('approve vs reject', describeRequest('POST', '/api/tasks/:id/approve', { approval_status: 'rejected' }, null).description === 'Rejected a recee'
    && describeRequest('POST', '/api/tasks/:id/approve', { approval_status: 'approved' }, null).description === 'Approved a recee');
  const unknown = describeRequest('POST', '/api/new/thing', {}, null);
  check('an unlisted endpoint is still logged, never dropped', unknown.action === 'POST /api/new/thing' && unknown.description.length > 0);
  check('role changes are described', describeRequest('PATCH', '/api/roles/:id', { name: 'Ops' }, null).label === 'Ops');
}

console.log('\n== roles overview matches the enforced rules ==');
{
  check('RJ admin holds every privilege', baseRolePrivileges('rjcorp_admin').length === ALL_PRIVILEGES.length);
  check('vendor admin cannot manage roles or vendors', !baseRolePrivileges('vendor_admin').includes('role.manage') && !baseRolePrivileges('vendor_admin').includes('vendor.manage'));
  check('vendor user, employee have no management privileges', baseRolePrivileges('vendor_user').length === 0 && baseRolePrivileges('employee').length === 0);
  check('RJ user has no fixed set (comes from a custom role)', baseRolePrivileges('rjcorp_user').length === 0);
  const capped = capPrivileges('rjcorp_user', [...ALL_PRIVILEGES]);
  check('a custom role can never carry admin-only privileges', RJCORP_ADMIN_ONLY.every((p) => !capped.includes(p)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
