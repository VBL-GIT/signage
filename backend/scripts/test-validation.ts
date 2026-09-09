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
  canonicalColumnName,
  upperCaseKeys,
} from '../src/services/validation';
import {
  resolveStoreIdentity,
  normalizeStoreInput,
  IdentityLookup,
} from '../src/services/stores.service';
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
  const { errors } = normalizeStoreInput(baseRow, { requireContactEmail: true });
  check('valid row has no errors', errors.length === 0, errors.join('; '));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, customer_code: '' }, {});
  // Reported by the template's own column name — CUST_CD, not customer_code.
  check('missing CUST_CD rejected', errors.some((e) => e.includes('CUST_CD')));
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
  check('non-numeric LATITUDE rejected', errors.some((e) => e.includes('LATITUDE')));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, lat: '99' }, {});
  check('out-of-range lat rejected', errors.some((e) => e.includes('-90')));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, contact_email: 'bad@@x.com' }, {});
  check('invalid CONTACT_EMAIL rejected', errors.some((e) => e.includes('CONTACT_EMAIL')));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, contact_email: '' }, { requireContactEmail: true });
  check('compact channel requires CONTACT_EMAIL', errors.some((e) => e.includes('CONTACT_EMAIL is required')));
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, contact_email: '' }, { requireContactEmail: false });
  check('customer-master channel does not require contact_email', errors.length === 0, errors.join('; '));
}
{
  const { input } = normalizeStoreInput(baseRow, {});
  check('vendor_id absent when not supplied (preserved on update)', input.vendor_id === undefined);
}
{
  const { errors } = normalizeStoreInput({ ...baseRow, name: '', address: '', pincode: '' }, {});
  check('collects ALL problems, not just the first', errors.length >= 3, errors.join('; '));
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

console.log('\n== column names: spelling matters, case does not ==');
{
  // The store template's own all-caps headers, as a sheet row.
  const capsRow = {
    HOS: 'Rajesh Kumar', STATE_CD: 'MH', CUST_CD: 'YG000000026', CUST_NAME: 'BALAJI',
    CONT_PR: 'Store Mgr', MOBILE_NO: '02233440001', ADDR_1: 'Plot 4', ADDR_POSTAL: '400601',
    CHANNEL: 'GT', SUB_CHANNEL: 'Grocery', LATITUDE: '19.207875', LONGITUDE: '72.984682',
    CUST_STATUS: 'ACTIVE',
  };
  const { input, errors } = normalizeStoreInput(capsRow, { requireMetadata: true });
  check('all-caps template row imports', errors.length === 0, errors.join('; '));
  check('CUST_CD -> customer_code', input.customer_code === 'YG000000026', input.customer_code);
  check('CUST_NAME -> name', input.name === 'BALAJI', input.name);
  check('ADDR_1 -> address', input.address === 'Plot 4', input.address);
  check('ADDR_POSTAL -> pincode', input.pincode === '400601', input.pincode);
  check('LATITUDE/LONGITUDE parsed', input.lat === 19.207875 && input.long === 72.984682);
  check('CONT_PR/MOBILE_NO/CUST_STATUS mapped',
    input.contact_person === 'Store Mgr' && input.contact_no === '02233440001' && input.outlet_status === 'ACTIVE');
  check('context columns stored all-caps',
    JSON.stringify(input.source_metadata) === JSON.stringify({ HOS: 'Rajesh Kumar', STATE_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery' }),
    JSON.stringify(input.source_metadata));
}
{
  // The same row in every other casing/punctuation a real export uses.
  const mixedRow = {
    hos: 'Rajesh Kumar', State_CD: 'MH', 'cust cd': 'YG000000026', Cust_name: 'BALAJI',
    'cont-pr': 'Store Mgr', mobile_no: '02233440001', addr_1: 'Plot 4', 'Addr Postal': '400601',
    channel: 'GT', 'sub channel': 'Grocery', LATTITUDE: '19.2', longtitude: '72.9',
    cust_status: 'ACTIVE',
  };
  const { input, errors } = normalizeStoreInput(mixedRow, { requireMetadata: true });
  check('mixed-case row imports identically', errors.length === 0, errors.join('; '));
  check('mixed-case CUST_CD found', input.customer_code === 'YG000000026', input.customer_code);
  check('misspelled LATTITUDE accepted', input.lat === 19.2, String(input.lat));
  check('mixed-case context columns are stored all-caps',
    JSON.stringify(input.source_metadata) === JSON.stringify({ HOS: 'Rajesh Kumar', STATE_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery' }),
    JSON.stringify(input.source_metadata));
}
{
  // A missing context column is still refused — spelling is what identifies it.
  const { errors } = normalizeStoreInput(
    { CUST_CD: 'YG1', CUST_NAME: 'X', ADDR_1: 'A', ADDR_POSTAL: '1', LATITUDE: '1', LONGITUDE: '1', HOS: 'h' },
    { requireMetadata: true }
  );
  check('missing STATE_CD still reported', errors.some((e) => e.includes('STATE_CD')), errors.join('; '));
}
{
  // Editing a context column must survive: the stored metadata is the base and
  // the edited field is layered over it, whatever case either side used.
  const { input } = normalizeStoreInput({
    customer_code: 'YG1', name: 'X', address: 'A', pincode: '1', lat: '1', long: '1',
    source_metadata: { HOS: 'old', State_CD: 'MH', CHANNEL: 'GT', SUB_CHANNEL: 'Grocery', CUST_CD: 'YG1' },
    HOS: 'new',
  }, { requireMetadata: true });
  const meta = input.source_metadata as Record<string, unknown>;
  check('edited HOS overwrites the stored one', meta.HOS === 'new', String(meta.HOS));
  check('stored State_CD is re-keyed to STATE_CD',
    meta.STATE_CD === 'MH' && meta.State_CD === undefined, JSON.stringify(meta));
  check('the rest of the source row survives an edit', meta.CUST_CD === 'YG1');
}
{
  check('canonicalColumnName uppercases and underscores',
    canonicalColumnName(' cust cd ') === 'CUST_CD' && canonicalColumnName('Cust-CD') === 'CUST_CD');
  const keyed = upperCaseKeys({ Cust_CD: 'a', 'state cd': 'b' });
  check('upperCaseKeys re-keys a whole row',
    JSON.stringify(keyed) === JSON.stringify({ CUST_CD: 'a', STATE_CD: 'b' }), JSON.stringify(keyed));
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
