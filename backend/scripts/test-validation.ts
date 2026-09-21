/**
 * Pure-logic checks for the shared validation + store identity rules.
 * No database, no network — safe to run anywhere.
 *
 * Run: npx ts-node scripts/test-validation.ts
 */
import {
  validateEmail,
  validateOptionalEmail,
  joinAddressParts,
  assertSheetShape,
  assertHeaderSpelling,
} from '../src/services/validation';
import {
  resolveStoreIdentity,
  normalizeStoreInput,
  IdentityLookup,
} from '../src/services/stores.service';
import {
  ALL_PRIVILEGES,
  RJCORP_ADMIN_ONLY,
  capPrivileges,
  type Privilege,
} from '../src/auth/privileges';
import { validate } from '../src/middleware/validate';
import { storeCreateBody } from '../src/routes/stores';
import { generateTemporaryPassword } from '../src/services/password';
import { buildCredentialsEmail } from '../src/services/email.service';
import { resolveUserScope, duplicateEmailMessage } from '../src/services/users.service';
import type { UserRole } from '../src/types/domain';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

console.log('\n== email syntax: must be rejected ==');
for (const bad of [
  'john doe@gmail.com',
  'john@ gmail.com',
  'john@gmail',
  'john@@gmail.com',
  'john@gmail..com',
  '.john@gmail.com',
  'john.@gmail.com',
  'john@-gmail.com',
  'john@gmail.c',
  '@gmail.com',
  'john@',
  '',
]) {
  const r = validateEmail(bad);
  check(`reject ${JSON.stringify(bad)}`, !r.ok, r.ok ? 'was accepted' : '');
}

console.log('\n== email syntax: must be accepted ==');
for (const good of [
  'john@gmail.com',
  'john.doe@vbl.co.in',
  'john+tag@sub.domain.example',
  "o'brien@example.com",
  'user_name-1@example-host.com',
]) {
  const r = validateEmail(good);
  check(`accept ${good}`, r.ok, r.reason ?? '');
}

console.log('\n== normalisation (trim + lowercase) ==');
{
  const r = validateEmail('   John.Doe@GMAIL.com  ');
  check('trims and lowercases', r.ok && r.value === 'john.doe@gmail.com', r.value);
}
{
  const r = validateOptionalEmail('');
  check('blank optional email -> null, ok', r.ok && r.value === null);
}
{
  const r = validateOptionalEmail('nope@@x.com');
  check('bad optional email -> not ok', !r.ok);
}

console.log('\n== domain typo suggestions ==');
for (const [input, want] of [
  ['user@gmial.com', 'user@gmail.com'],
  ['user@gamil.com', 'user@gmail.com'],
  ['user@hotmial.com', 'user@hotmail.com'],
  ['user@yahooo.com', 'user@yahoo.com'],
] as [string, string][]) {
  const r = validateEmail(input);
  check(`${input} suggests ${want}`, !r.ok && !!r.reason?.includes(want), r.reason ?? '');
}
check('legitimate domain not flagged as typo', validateEmail('user@gmail.com').ok);

console.log('\n== address joining (customer-master ADDR_1..5) ==');
check(
  'drops "-" placeholder and de-duplicates',
  joinAddressParts(['52B3 VRINDAVAN', '52b3  vrindavan', 'Thane', 'Maharashtra', '-']) ===
    '52B3 VRINDAVAN, Thane, Maharashtra',
  joinAddressParts(['52B3 VRINDAVAN', '52b3  vrindavan', 'Thane', 'Maharashtra', '-'])
);
check('collapses whitespace', joinAddressParts(['A   B', '', 'C']) === 'A B, C');
check('all-blank -> empty string', joinAddressParts(['', '-', 'NA']) === '');

console.log('\n== store identity resolution ==');
const lookup = (codes: Record<string, string>, uids: Record<string, string>): IdentityLookup => ({
  byCode: (c) => codes[c],
  byUid: (u) => uids[u],
});

{
  const r = resolveStoreIdentity(lookup({}, {}), 'YG001', 'U1');
  check('new code + new uid -> create', r.ok && r.targetId === null);
}
{
  const r = resolveStoreIdentity(lookup({ yg001: 'A' }, { u1: 'A' }), 'YG001', 'U1');
  check('both point at same store -> update it', r.ok && r.targetId === 'A');
}
{
  const r = resolveStoreIdentity(lookup({ yg001: 'A' }, {}), 'YG001', 'U-NEW');
  check('known code + new uid -> update (uid changes)', r.ok && r.targetId === 'A');
}
{
  const r = resolveStoreIdentity(lookup({ yg001: 'A' }, { u1: 'B' }), 'YG001', 'U1');
  check('code->A but uid->B -> conflict', !r.ok, JSON.stringify(r));
}
{
  const r = resolveStoreIdentity(lookup({}, { u1: 'B' }), 'YG-NEW', 'U1');
  check('new code but uid owned by another store -> conflict', !r.ok, JSON.stringify(r));
}
{
  const r = resolveStoreIdentity(lookup({ yg001: 'A' }, { u1: 'A' }), 'yg001', 'u1');
  check('lookup is case-insensitive', r.ok && r.targetId === 'A');
}

console.log('\n== store row validation ==');
const baseRow = {
  customer_code: 'YG000000026', uid: '00830422', name: 'BALAJI', address: 'Thane',
  pincode: '400601', lat: '19.207875', long: '72.984682', contact_email: 'a@b.com',
};
{
  const { errors } = normalizeStoreInput(baseRow, {});
  check('valid row has no errors', errors.length === 0, errors.join('; '));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, customer_code: '' }, {});
  check('missing CUST_CD rejected', errors.some((e) => e.includes('CUST_CD')), errors.join('; '));
}
{
  // Customer Code is now the store's single identifier. uid is no longer
  // collected: an omitted one defaults to the customer code rather than being
  // an error, so tasks and images that still resolve stores by uid keep working.
  const { input, errors } = normalizeStoreInput({ ...baseRow, uid: '' }, {});
  check('missing uid is NOT an error any more', !errors.some((e) => e.includes('uid')), errors.join('; '));
  check('omitted uid defaults to the customer code', input.uid === baseRow.customer_code, input.uid);
}
{
  // An explicitly supplied uid still wins — that is what carries an existing
  // store's legacy uid through an edit unchanged.
  const { input } = normalizeStoreInput({ ...baseRow, uid: 'LEGACY-1' }, {});
  check('an explicit uid is preserved', input.uid === 'LEGACY-1', input.uid);
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, lat: 'abc' }, {});
  check('non-numeric LATITUDE rejected', errors.some((e) => e.includes('LATITUDE')), errors.join('; '));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, lat: '99' }, {});
  check('out-of-range lat rejected', errors.some((e) => e.includes('-90')));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, contact_email: 'bad@@x.com' }, {});
  check('invalid CONTACT_EMAIL rejected', errors.some((e) => e.includes('CONTACT_EMAIL')), errors.join('; '));
}
{
  // CONTACT_EMAIL is optional on every channel, and there is no longer an
  // option to demand it: a blank one must never stop a store being saved.
  const { input, errors } = normalizeStoreInput({ ...baseRow, contact_email: '' }, {});
  check('a blank CONTACT_EMAIL is accepted', errors.length === 0, errors.join('; '));
  check('and is stored as NULL', input.contact_email === null, String(input.contact_email));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, contact_person: '', contact_no: '' }, {});
  check('blank CONT_PR / MOBILE_NO are accepted', errors.length === 0, errors.join('; '));
}

// The context columns are canonically STATE_CD now, in caps like the template.
// Renaming the canonical spelling must not reject sheets or clients still
// sending the old one.
{
  const withOldSpelling = { ...baseRow, HOS: 'Rajesh', State_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery' };
  const { input, errors } = normalizeStoreInput(withOldSpelling, { requireMetadata: true });
  check('State_CD still satisfies STATE_CD', errors.length === 0, errors.join('; '));
  check('and is stored under the canonical caps name',
    (input.source_metadata as Record<string, unknown>)?.STATE_CD === 'MH',
    JSON.stringify(input.source_metadata));
}
{
  const capsSpelling = { ...baseRow, HOS: 'Rajesh', STATE_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery' };
  const { errors } = normalizeStoreInput(capsSpelling, { requireMetadata: true });
  check('STATE_CD satisfies STATE_CD', errors.length === 0, errors.join('; '));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, HOS: 'Rajesh', CHANNEL: 'GT', SUB_CHANNEL: 'G' }, { requireMetadata: true });
  check('a missing context column is named in caps',
    errors.some((e) => e === 'STATE_CD is required'), errors.join('; '));
}
{
  const { input } = normalizeStoreInput(baseRow, {});
  check('vendor_id absent when not supplied (preserved on update)', input.vendor_id === undefined);
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, name: '', address: '', pincode: '' }, {});
  check('collects ALL problems, not just the first', errors.length >= 3, errors.join('; '));
}

// Header matching. A sheet arrives with whatever casing and punctuation its
// author used; an exact-key lookup reported every column of a perfectly good
// sheet as missing, which is indistinguishable from bad data.
{
  const caps = {
    CUSTOMER_CODE: 'YG000000026', NAME: 'BALAJI', ADDRESS: 'Thane',
    PINCODE: '400601', LAT: '19.207875', LONG: '72.984682',
  };
  const { input, errors } = normalizeStoreInput(caps, {});
  check('all-caps headers are matched', errors.length === 0, errors.join('; '));
  check('all-caps row keeps its values', input.customer_code === 'YG000000026' && input.lat === 19.207875);
}
{
  const spaced = {
    'Customer Code': 'YG000000027', 'Name': 'BALAJI 2', 'Addr 1': 'Thane West',
    'Pincode': '400602', 'Lattitude': '19.2', 'Longitude': '72.9',
  };
  const { input, errors } = normalizeStoreInput(spaced, {});
  check('spaced headers and LATTITUDE are matched', errors.length === 0, errors.join('; '));
  check('ADDR_1 alone becomes the address', input.address === 'Thane West', input.address);
}
{
  // The customer master's own headers, straight from the export, with no
  // mapping step in front of them.
  const master = {
    CUST_CD: 'YG000000028', CUST_NAME: 'BALAJI 3', ADDR_1: 'Plot 4', ADDR_2: 'Andheri East',
    ADDR_POSTAL: '400069', LATITUDE: '19.1197', LONGITUDE: '72.8468',
    CONT_PR: 'Store Mgr', MOBILE_NO: '02233440001', CUST_STATUS: 'ACTIVE',
  };
  const { input, errors } = normalizeStoreInput(master, {});
  check('customer-master headers are matched unmapped', errors.length === 0, errors.join('; '));
  check('CUST_CD becomes the customer code', input.customer_code === 'YG000000028', input.customer_code);
  check('ADDR_1..ADDR_5 are joined', input.address === 'Plot 4, Andheri East', input.address);
  check('CONT_PR / MOBILE_NO / CUST_STATUS are carried',
    input.contact_person === 'Store Mgr' && input.contact_no === '02233440001' && input.outlet_status === 'ACTIVE');
}
{
  // A sheet with none of the store columns must still be rejected — that is
  // what the wrong-tab guard in bulk.controller reports before validating.
  const vendorSheet = {
    COMPANY_NAME: 'Apex Technologies Pvt. Ltd.', CONTACT_PERSON: 'Rahul Mehta',
    CONTACT_PHONE: '+91 98765 43210', CONTACT_EMAIL: 'rahul@example.com', REMARKS: 'demo',
  };
  const { errors } = normalizeStoreInput(vendorSheet, {});
  check('a vendor sheet is still not a store row', errors.length >= 4, errors.join('; '));
}

console.log('\n== bulk sheet identification (wrong-tab guard) ==');
function shapeError(rows: Record<string, unknown>[], expected: string): string {
  try { assertSheetShape(rows, expected); return ''; } catch (e) { return (e as Error).message; }
}
const vendorRows = [{
  COMPANY_NAME: 'Apex Technologies Pvt. Ltd.', CONTACT_PERSON: 'Rahul Mehta',
  CONTACT_PHONE: '+91 98765 43210', CONTACT_EMAIL: 'rahul@example.com', REMARKS: 'demo',
}];
const storeRows = [{
  HOS: 'Rajesh', State_CD: 'MH', CUST_CD: 'YG000000026', CUST_NAME: 'BALAJI', CONT_PR: 'Mgr',
  MOBILE_NO: '02233440001', ADDR_1: 'Plot 4', ADDR_POSTAL: '400069', CHANNEL: 'GT',
  SUB_CHANNEL: 'Grocery', LATITUDE: '19.1', LONGITUDE: '72.8', CUST_STATUS: 'ACTIVE',
}];
{
  const msg = shapeError(vendorRows, 'Stores');
  check('a vendor sheet on the Stores tab is refused once', msg !== '');
  check('and it names the Vendors tab', msg.includes('Vendors tab'), msg);
}
{
  check('a vendor sheet on the Vendors tab passes', shapeError(vendorRows, 'Vendors') === '');
  check('a store sheet on the Stores tab passes', shapeError(storeRows, 'Stores') === '');
}
{
  const msg = shapeError(storeRows, 'Employees');
  check('a store sheet on the Employees tab is refused', msg !== '');
  check('and it names the Stores tab', msg.includes('Stores tab'), msg);
}
{
  // An older compact store sheet is still a store sheet.
  const compact = [{ customer_code: 'YG1', name: 'A', address: 'B', pincode: '400601', lat: '19', long: '72' }];
  check('a compact store sheet is recognised as Stores', shapeError(compact, 'Stores') === '');
}
{
  // A recognised sheet missing one column is NOT refused here — that stays a
  // per-row error, which is what tells the operator which rows to fix.
  const partial = [{ COMPANY_NAME: 'Apex' }];
  check('an incomplete but recognised sheet still validates per row', shapeError(partial, 'Vendors') === '');
}
{
  check('an empty file is not refused by shape', shapeError([], 'Stores') === '');
}

console.log('\n== header spelling (case is fine, typos are not) ==');
function spellingError(rows: Record<string, unknown>[], channel: string): string {
  try { assertHeaderSpelling(rows, channel); return ''; } catch (e) { return (e as Error).message; }
}
{
  // Any casing or punctuation of a real column must import untouched — that is
  // the whole point of matching normalised names.
  const casings = [
    { cust_cd: 'YG1', cust_name: 'A', addr_1: 'B', addr_postal: '400601', latitude: '19', longitude: '72' },
    { 'Cust CD': 'YG1', 'Cust Name': 'A', 'Addr 1': 'B', 'Addr Postal': '400601' },
    { CUSTOMER_CODE: 'YG1', NAME: 'A', ADDRESS: 'B', PINCODE: '400601', LAT: '19', LONG: '72' },
  ];
  for (const [i, row] of casings.entries()) {
    check(`casing variant ${i + 1} is accepted`, spellingError([row], 'Stores') === '', spellingError([row], 'Stores'));
  }
  check('LATTITUDE is a known spelling, not a typo',
    spellingError([{ CUST_CD: 'YG1', LATTITUDE: '19' }], 'Stores') === '');
}
{
  const msg = spellingError([{ CUSTMER_CODE: 'YG1', CUST_NAME: 'A' }], 'Stores');
  check('a misspelled column is refused', msg !== '');
  check('and the right spelling is suggested', msg.includes('CUSTOMER_CODE'), msg);
}
{
  const msg = spellingError([{ COMPANY_NAM: 'Apex', CONTACT_PERSON: 'R' }], 'Vendors');
  check('a misspelled vendor column is refused', msg.includes('COMPANY_NAME'), msg);
}
{
  const msg = spellingError([{ FIRST_NAME: 'A', LAST_NAME: 'B', EMAIL: 'a@b.com', ROLE: 'employee', MOBIEL: '9' }], 'Employees');
  check('a misspelled employee column is refused', msg.includes('MOBILE'), msg);
}
{
  // A real customer-master export carries dozens of columns with no field here.
  // They are kept as source data, so they must not be mistaken for typos.
  const wide = {
    CUST_CD: 'YG1', CUST_NAME: 'A', ADDR_1: 'B', ADDR_POSTAL: '400601',
    GST_NO: '27AAA', BEAT_NAME: 'North 4', ROUTE_CODE: 'R12', SALESMAN: 'K Rao', DISTRIBUTOR_NAME: 'D1',
  };
  check('unrelated extra columns are left alone', spellingError([wide], 'Stores') === '', spellingError([wide], 'Stores'));
}
{
  check('an empty file has no spelling to check', spellingError([], 'Stores') === '');
}

console.log('\n== Create Store request body (the schema the app mounts) ==');
// Exactly what the Create / Update Store form posts: every input it draws,
// with the ones left blank arriving as "".
const formBody = {
  customer_code: 'YG000000026', name: 'BALAJI', pincode: '400601', lat: 19.2, long: 72.9,
  ADDR_1: 'Plot 4', ADDR_2: '', ADDR_3: '', ADDR_4: '', ADDR_5: '',
  HOS: 'Rajesh', State_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery',
  contact_no: '9800000001', contact_email: '', contact_person: 'Store Mgr', outlet_status: 'ACTIVE',
};
{
  // The regression: Contact Email is labelled optional, but `.min(1).optional()`
  // rejected "" and failed the whole save on "Too small: expected string to
  // have >=1 characters" — naming no field.
  const r = storeCreateBody.safeParse(formBody);
  check('a blank optional Contact Email is accepted',
    r.success, r.success ? '' : JSON.stringify(r.error.flatten().fieldErrors));
}
{
  const r = storeCreateBody.safeParse({ ...formBody, contact_email: 'store@example.com' });
  check('a filled Contact Email is still accepted', r.success);
}
{
  const r = storeCreateBody.safeParse({ ...formBody, contact_no: '', contact_person: '' });
  check('other blank optional fields are accepted too', r.success);
}
{
  const r = storeCreateBody.safeParse({ ...formBody, contact_email: 5 });
  check('a non-string Contact Email is still rejected', !r.success);
}
{
  const r = storeCreateBody.safeParse({ ...formBody, customer_code: '' });
  check('a blank Customer Code is still rejected', !r.success);
}

console.log('\n== validation error messages name their field ==');
function validationDetails(schema: Parameters<typeof validate>[0], body: unknown): Record<string, string[]> {
  let payload: { error?: string; details?: Record<string, string[]> } = {};
  const res = {
    status() { return this; },
    json(p: typeof payload) { payload = p; return this; },
  };
  validate(schema)({ body } as never, res as never, () => { payload = {}; });
  return payload.details ?? {};
}
{
  const d = validationDetails(storeCreateBody, { ...formBody, name: '' });
  check('a blank required field says which field', (d.name?.[0] ?? '').startsWith('name'), JSON.stringify(d));
  check('and says it must not be blank', (d.name?.[0] ?? '').includes('blank'), JSON.stringify(d));
}
{
  const { customer_code, ...withoutCode } = formBody;
  void customer_code;
  const d = validationDetails(storeCreateBody, withoutCode);
  check('a missing field reads as required', d.customer_code?.[0] === 'customer_code is required', JSON.stringify(d));
}
{
  const d = validationDetails(storeCreateBody, { ...formBody, name: 5 });
  check('a wrongly-typed field says so', d.name?.[0] === 'name must be a string', JSON.stringify(d));
}
{
  const d = validationDetails(storeCreateBody, { ...formBody, vendor_id: 'not-a-uuid' });
  check('a malformed uuid names the field and the format',
    d.vendor_id?.[0] === 'vendor_id is not a valid uuid', JSON.stringify(d));
}
{
  const d = validationDetails(storeCreateBody, { ...formBody, name: '', pincode: '' });
  check('every bad field is reported, keyed by name',
    Object.keys(d).sort().join(',') === 'name,pincode', JSON.stringify(d));
}
{
  // No zod message reaches the client without a field in front of it — that is
  // what made the original report unactionable.
  const d = validationDetails(storeCreateBody, { ...formBody, name: '', customer_code: '' });
  const raw = Object.values(d).flat().filter((m) => m.startsWith('Too small') || m.startsWith('Invalid input'));
  check('no bare Zod wording survives', raw.length === 0, raw.join('; '));
}

console.log('\n== head-office hierarchy (privilege ceiling) ==');
{
  // An rjcorp_user's privileges come from whatever custom role is assigned, so
  // without a ceiling the hierarchy was only as strong as that role: a role
  // carrying user.manage would let an rjcorp_user create accounts, including
  // ones that hold everything it does not.
  const greedy: Privilege[] = ['task.assign', 'task.approve', 'user.manage', 'user.status', 'role.manage'];
  const capped = capPrivileges('rjcorp_user', greedy);
  check('rjcorp_user cannot hold user.manage', !capped.includes('user.manage'), capped.join(', '));
  check('rjcorp_user cannot hold user.status', !capped.includes('user.status'), capped.join(', '));
  check('rjcorp_user cannot hold role.manage', !capped.includes('role.manage'), capped.join(', '));
  check('rjcorp_user keeps assigning', capped.includes('task.assign'), capped.join(', '));
  check('rjcorp_user keeps approving', capped.includes('task.approve'), capped.join(', '));
}
{
  // Everything operational is still delegable — that is what makes an
  // rjcorp_user useful rather than merely restricted.
  const operational: Privilege[] = ['task.create', 'task.assign', 'task.approve', 'store.manage', 'artwork.manage', 'vendor.manage', 'vendor.status'];
  const capped = capPrivileges('rjcorp_user', operational);
  check('every operational privilege survives the cap', capped.length === operational.length, capped.join(', '));
}
{
  const capped = capPrivileges('rjcorp_admin', ALL_PRIVILEGES);
  check('rjcorp_admin is never capped', capped.length === ALL_PRIVILEGES.length, capped.join(', '));
  check('rjcorp_admin holds every privilege', ALL_PRIVILEGES.every((p) => capped.includes(p)));
}
{
  // Vendor admins manage their own vendor's staff; the controllers confine them
  // to it, so the ceiling must not strip what they legitimately hold.
  const vendorAdmin = capPrivileges('vendor_admin', ['task.assign', 'user.manage', 'user.status']);
  check('vendor_admin keeps managing its own staff',
    vendorAdmin.includes('user.manage') && vendorAdmin.includes('user.status'), vendorAdmin.join(', '));
}
{
  check('the ceiling is exactly account + role administration',
    [...RJCORP_ADMIN_ONLY].sort().join(',') === 'role.manage,user.manage,user.status',
    RJCORP_ADMIN_ONLY.join(', '));
  check('every capped privilege is a real one', RJCORP_ADMIN_ONLY.every((p) => ALL_PRIVILEGES.includes(p)));
}

console.log('\n== temporary password generation ==');
// NOTE: no generated password is ever printed here, not even on failure —
// test output is one of the places a plaintext password must never appear.
{
  const pw = generateTemporaryPassword();
  check('default length is 16', pw.length === 16);
  check('contains a lowercase letter', /[a-z]/.test(pw));
  check('contains an uppercase letter', /[A-Z]/.test(pw));
  check('contains a digit', /[0-9]/.test(pw));
  check('contains a symbol', /[!@#$%*?\-_]/.test(pw));
  check('has no whitespace', !/\s/.test(pw));
  check('avoids ambiguous glyphs (0 O 1 l I)', !/[0O1lI]/.test(pw));
  check('satisfies the 6-char login minimum', pw.length >= 6);
}
{
  // Uniqueness across many draws — a constant or low-entropy generator fails this.
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(generateTemporaryPassword());
  check('2000 draws are all distinct', seen.size === 2000, `${seen.size} distinct`);
}
{
  // The guaranteed-class characters must not always land in the same slots;
  // without the shuffle, position 0 would be lowercase every single time.
  const firstChars = new Set<string>();
  for (let i = 0; i < 200; i++) firstChars.add(generateTemporaryPassword()[0]);
  check('first character varies across draws (shuffled)', firstChars.size > 5, `${firstChars.size} distinct`);
}
{
  const long = generateTemporaryPassword(32);
  check('honours a custom length', long.length === 32);
}

console.log('\n== credentials email contents ==');
{
  const pw = generateTemporaryPassword();
  const { subject, text, html } = buildCredentialsEmail({
    to: 'ramesh@vendor.example', name: 'Ramesh Yadav', email: 'ramesh@vendor.example',
    password: pw, role: 'employee', uid: 'V1-E001',
  });
  check('has a subject', subject.length > 0);
  // 1. name  2. login email/UID  3. temporary password  4. login URL  5. instruction
  check('text: contains the employee name', text.includes('Ramesh Yadav'));
  check('text: contains the login email', text.includes('ramesh@vendor.example'));
  check('text: contains the user UID', text.includes('V1-E001'));
  check('text: contains the temporary password', text.includes(pw));
  check('text: contains a login page line', text.includes('Login page:'));
  check('text: tells them how to set their own password', text.includes('Forgot password'));
  check('text: warns against forwarding', text.toLowerCase().includes('do not share'));
  check('html: contains the employee name', html.includes('Ramesh Yadav'));
  check('html: contains the temporary password', html.includes(pw));
  check('html: contains the user UID', html.includes('V1-E001'));
  // The app has no change-password screen, so the email must not send people there.
  check('does NOT tell them to change it "from your profile"',
    !/from your profile/i.test(text) && !/from your profile/i.test(html));
}
{
  // uid is optional — a head-office account has none.
  const { text, html } = buildCredentialsEmail({
    to: 'a@b.com', name: 'No Uid', email: 'a@b.com', password: 'Xx1!aaaaaaaaaaaa',
  });
  check('omits the User ID line when there is no uid',
    !text.includes('User ID') && !html.includes('User ID'));
}

console.log('\n== nothing is logged while handling a password ==');
{
  // Capture every console channel, then exercise the code paths that touch a
  // plaintext password. None of them may emit it.
  const captured: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = console.error = console.warn = console.info =
    ((...a: unknown[]) => { captured.push(a.map(String).join(' ')); }) as typeof console.log;
  let pw = '';
  try {
    pw = generateTemporaryPassword();
    buildCredentialsEmail({ to: 'x@y.com', name: 'X', email: 'x@y.com', password: pw, uid: 'V1-E001' });
  } finally {
    Object.assign(console, orig);
  }
  check('generation + email rendering log nothing at all', captured.length === 0, `${captured.length} line(s)`);
  check('no captured line contains the password', !captured.some((l) => l.includes(pw)));
}

console.log('\n== vendor/user scope validation (unchanged behaviour) ==');
const HEAD = { role: 'rjcorp_admin' as UserRole, vendor_id: null };
const RJUSER = { role: 'rjcorp_user' as UserRole, vendor_id: null };
const VADMIN = { role: 'vendor_admin' as UserRole, vendor_id: 'vendor-A' };
const EMP = { role: 'employee' as UserRole, vendor_id: 'vendor-A' };
const tryScope = (creator: { role: UserRole; vendor_id: string | null }, role: UserRole, vid: string | null) => {
  try { return { ok: true, ...resolveUserScope(creator, role, vid) }; }
  catch (e) { return { ok: false, msg: (e as Error).message }; }
};
{
  const r = tryScope(HEAD, 'employee', 'vendor-A');
  check('head office can create an employee under a vendor', r.ok && (r as any).vendor_id === 'vendor-A');
}
{
  const r = tryScope(HEAD, 'employee', null);
  check('employee without vendor_id is rejected', !r.ok && /vendor_id is required/.test((r as any).msg));
}
{
  const r = tryScope(RJUSER, 'rjcorp_admin', null);
  check('rjcorp_user cannot mint an rjcorp_admin', !r.ok && /Only an RJCorp admin/.test((r as any).msg));
}
{
  const r = tryScope(VADMIN, 'employee', 'vendor-B');
  check('vendor admin is forced to their OWN vendor', r.ok && (r as any).vendor_id === 'vendor-A');
}
{
  const r = tryScope(VADMIN, 'rjcorp_admin', null);
  check('vendor admin cannot create head-office accounts', !r.ok);
}
{
  const r = tryScope(EMP, 'employee', 'vendor-A');
  check('an employee cannot create users at all', !r.ok);
}

console.log('\n== duplicate-email messages (unchanged behaviour) ==');
check('same vendor -> "same vendor" wording',
  duplicateEmailMessage('vendor-A', 'vendor-A') === 'Mail/user already exists in the same vendor.');
check('different vendor -> "another vendor/account" wording',
  duplicateEmailMessage('vendor-A', 'vendor-B') === 'This email is already registered with another vendor/account.');
check('existing head-office account (null vendor) -> "another vendor/account"',
  duplicateEmailMessage(null, 'vendor-A').includes('another vendor/account'));
check('both null -> "another vendor/account"',
  duplicateEmailMessage(null, null).includes('another vendor/account'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
