/**
 * Pure-logic checks for the centralised activity report, SPEED classification,
 * duplicate flagging and password-administration scope. No database, no network.
 *
 * Run: npx ts-node scripts/test-reporting.ts
 */
import { buildActivityFilter, toExportRow, ACTIVITY_TYPES } from '../src/services/activityReport.service';
import { validateOutletClassification, duplicateReasons, DUPLICATE_RADIUS_M } from '../src/services/outlets.service';
import { canAdministerPassword } from '../src/services/users.service';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
type U = { id: string; role: string; vendor_id: string | null };
const admin: U = { id: 'a', role: 'rjcorp_admin', vendor_id: null };
const vendorAdmin: U = { id: 'v', role: 'vendor_admin', vendor_id: V1 };

function build(q: Record<string, unknown>, u = admin) {
  const r = buildActivityFilter(q, u);
  if (!r.ok) throw new Error(r.error);
  return r.filter;
}
/** Every $n placeholder must have a parameter, and every parameter must be used. */
function placeholdersMatch(f: { where: string; params: unknown[] }) {
  const used = new Set([...f.where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  return f.params.every((_, i) => used.has(i + 1)) && [...used].every((n) => n <= f.params.length);
}

console.log('\n== report scope: vendor isolation is enforced from the user, not the query ==');
{
  const f = build({ vendor_id: V2 }, vendorAdmin);
  check('vendor admin query for another vendor is overridden', f.params.includes(V1) && !f.params.includes(V2));
  const u = build({ vendor_id: V2 }, { id: 'u', role: 'vendor_user', vendor_id: V1 });
  check('vendor user cannot widen scope with ?vendor_id=', u.params.includes(V1) && !u.params.includes(V2));
  const none = build({}, { id: 'x', role: 'vendor_admin', vendor_id: null });
  check('vendor user with no vendor sees nothing', none.where === 'false');
  const emp = build({ employee_id: V2 }, { id: E1, role: 'employee', vendor_id: V1 });
  check('employee is confined to own activities', emp.params[0] === E1);
  const a = build({ vendor_id: V2 });
  check('head office may filter by vendor', a.params.includes(V2));
  const unknownRole = build({}, { id: 'x', role: 'mystery', vendor_id: V1 });
  check('unknown role sees nothing', unknownRole.where === 'false');
}

console.log('\n== report filters: validation and construction ==');
{
  check('cancelled hidden by default', build({}).where.includes(`t.status <> 'cancelled'`));
  check('cancelled included when asked', !build({ status: 'cancelled' }).where.includes(`<> 'cancelled'`));
  check('invalid origin rejected', !buildActivityFilter({ origin: 'BOTH' }, admin).ok);
  check('invalid activity type rejected', !buildActivityFilter({ activity_type: 'x' }, admin).ok);
  check('invalid outlet type rejected', !buildActivityFilter({ outlet_type: 'x' }, admin).ok);
  check('invalid status rejected', !buildActivityFilter({ status: 'x' }, admin).ok);
  check('bad date rejected', !buildActivityFilter({ date_from: '13/10/2026' }, admin).ok);
  check('impossible date rejected', !buildActivityFilter({ date_to: '2026-99-99' }, admin).ok);
  check('bad employee uuid rejected (no SQL error)', !buildActivityFilter({ employee_id: "x' OR 1=1" }, admin).ok);
  check('bad vendor uuid rejected', !buildActivityFilter({ vendor_id: 'nope' }, admin).ok);
  check('all four activity types accepted', ACTIVITY_TYPES.every((t) => buildActivityFilter({ activity_type: t }, admin).ok));
  const all = build({
    date_from: '2026-01-01', date_to: '2026-12-31', activity_type: 'recee', origin: 'UNASSIGNED',
    employee_id: E1, outlet_type: 'speed', status: 'completed', q: 'abc',
  });
  check('every filter produces a matching placeholder per parameter', placeholdersMatch(all));
  check('search is parameterised, never inlined', !all.where.includes('abc') && all.params.includes('%abc%'));
  const wild = build({ q: '100%_' });
  check('LIKE wildcards in search are escaped', wild.params.includes('%100\\%\\_%'));
  check('no filters on head office yields a valid clause', placeholdersMatch(build({})));
}

console.log('\n== SPEED vs Non-SPEED (a SPEED outlet supplies its Customer Code) ==');
{
  const ok = validateOutletClassification('speed', ' ACC123 ');
  check('SPEED with a Customer Code is accepted and trimmed', ok.ok && ok.is_speed && ok.customer_code === 'ACC123');
  check('SPEED without a Customer Code is rejected', !validateOutletClassification('speed', '').ok);
  check('SPEED with a blank-space code is rejected', !validateOutletClassification('speed', '   ').ok);
  check('SPEED with an implausible code is rejected', !validateOutletClassification('speed', 'a b').ok);
  check('SPEED error names Customer Code, not SPEED ID', (() => { const r = validateOutletClassification('speed', ''); return !r.ok && /Customer Code/.test(r.error) && !/SPEED ID/.test(r.error); })());
  const ns = validateOutletClassification('non_speed', undefined);
  check('Non-SPEED needs no code', ns.ok && !ns.is_speed && ns.customer_code === null);
  const ns2 = validateOutletClassification('non_speed', 'ACC9');
  check('Non-SPEED discards a stray code so data cannot contradict the type', ns2.ok && ns2.customer_code === null);
  check('missing classification is rejected', !validateOutletClassification(undefined, 'ACC1').ok);
  check('unknown classification is rejected', !validateOutletClassification('maybe', 'ACC1').ok);
}

console.log('\n== duplicate flagging (flag only, never merge) ==');
{
  const probe = { name: 'Sharma Store', pincode: '560001', lat: 12.9, long: 77.5, customer_code: 'ACC1' };
  const other = (o: Partial<{ name: string; pincode: string; customer_code: string | null; distance_m: number | null }>) =>
    ({ name: 'Other', pincode: '560002', customer_code: null, distance_m: 5000, ...o });
  check('default radius is 150 m', DUPLICATE_RADIUS_M === 150);
  check('same Customer Code is flagged', duplicateReasons(probe, other({ customer_code: 'acc1' })).includes('same Customer Code'));
  check('same name + pincode is flagged', duplicateReasons(probe, other({ name: 'sharma store', pincode: '560001' })).includes('same name and pincode'));
  check('nearby outlet is flagged', duplicateReasons(probe, other({ distance_m: 80 })).some((r) => r.startsWith('within')));
  check('outlet just outside the radius is not flagged', duplicateReasons(probe, other({ distance_m: 151 })).length === 0);
  check('same name, different pincode, far away: not flagged', duplicateReasons(probe, other({ name: 'Sharma Store' })).length === 0);
  check('unrelated outlet is not flagged', duplicateReasons(probe, other({})).length === 0);
}

console.log('\n== export rows: blanks stay blank, origin is explicit ==');
{
  const row = toExportRow({
    activity_id: 'id1', activity_type: 'recee', activity_origin: 'UNASSIGNED', status: 'recee_submitted',
    outlet_type: 'not_recorded', assignments: 1, submission_attempts: 0, photo_count: 0,
  });
  check('unassigned recee is labelled', row['Activity Type'] === 'Unassigned Recee' && row['Activity Origin'] === 'Unassigned');
  check('missing values are blank, not invented', row['Completed'] === '' && row['Customer Code'] === '' && row['Brand'] === '');
  check('the report no longer carries a SPEED ID column', !('SPEED ID' in row));
  check('legacy outlets read "Not recorded"', row['Outlet Type'] === 'Not recorded');
  const re = toExportRow({ activity_type: 'recee', activity_origin: 'ASSIGNED', outlet_type: 'speed', assignments: 3, submission_attempts: 2, photo_count: 4 });
  check('assigned recee is labelled', re['Activity Type'] === 'Assigned Recee');
  check('times reassigned = assignments − 1', re['Times Reassigned'] === 2);
  check('resubmissions are a column, not extra rows', re['Submission Attempts'] === 2);
  check('never negative reassignments', toExportRow({ activity_type: 'recee', activity_origin: 'ASSIGNED', assignments: 0 })['Times Reassigned'] === 0);
}

console.log('\n== password administration scope ==');
{
  const emp = { role: 'employee', vendor_id: V1 };
  check('RJ admin may manage any account', canAdministerPassword({ role: 'rjcorp_admin', vendor_id: null }, emp));
  check('vendor admin may manage own staff', canAdministerPassword(vendorAdmin, emp));
  check('vendor admin may NOT manage another vendor', !canAdministerPassword(vendorAdmin, { role: 'employee', vendor_id: V2 }));
  check('vendor admin may NOT manage head-office accounts', !canAdministerPassword(vendorAdmin, { role: 'rjcorp_admin', vendor_id: V1 }));
  check('vendor user may NOT manage passwords', !canAdministerPassword({ role: 'vendor_user', vendor_id: V1 }, emp));
  check('employee may NOT manage passwords', !canAdministerPassword({ role: 'employee', vendor_id: V1 }, emp));
  check('rjcorp_user may NOT manage passwords', !canAdministerPassword({ role: 'rjcorp_user', vendor_id: null }, emp));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
