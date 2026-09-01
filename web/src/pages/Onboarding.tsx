import { useEffect, useState } from 'react';
import { useAuth, useHasPrivilege } from '../store/auth';
import {
  createVendor, createStore, createUser, createTask,
  getVendors, getStores, getBrands, getBoardingSizes, getArtworks, getRoles,
} from '../api';
import type { Vendor, Store, Brand, BoardingSize, Artwork, SignageType, Role } from '../types';
import { SIGNAGE_TYPES, SIGNAGE_TYPE_LABELS, ROLE_LABELS } from '../types';
import { Button, Card, ErrorBanner, SearchableSelect } from '../components/ui';
import { apiError } from '../api/client';

type Tab = 'vendor' | 'store' | 'user' | 'task';

export function Onboarding() {
  const role = useAuth((s) => s.user?.role)!;
  const has = useHasPrivilege();
  const isHeadOffice = role === 'rjcorp_admin' || role === 'rjcorp_user';
  const tabs: { key: Tab; label: string }[] = [
    ...(has('vendor.manage') ? [{ key: 'vendor' as Tab, label: 'Vendor' }] : []),
    ...(has('store.manage') ? [{ key: 'store' as Tab, label: 'Store' }] : []),
    ...(has('user.manage') ? [{ key: 'user' as Tab, label: 'Employee' }] : []),
    ...(has('task.create') ? [{ key: 'task' as Tab, label: 'Task' }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'user');

  return (
    <div>
      <h1>Onboarding</h1>
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>
        ))}
      </div>
      {tab === 'vendor' && <VendorForm />}
      {tab === 'store' && <StoreForm />}
      {tab === 'user' && <UserForm isRjcorp={isHeadOffice} canAssignRole={has('role.manage')} />}
      {tab === 'task' && <TaskForm />}
    </div>
  );
}

function useFormStatus() {
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return { err, setErr, ok, setOk, busy, setBusy };
}

function VendorForm() {
  const s = useFormStatus();
  const [name, setName] = useState('');
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  async function submit() {
    s.setErr(null); s.setOk(null);
    if (!name.trim() || !person.trim() || !phone.trim() || !email.trim()) {
      s.setErr('Company name, contact person, phone and email are all required'); return;
    }
    s.setBusy(true);
    try {
      const v = await createVendor({
        name: name.trim(), contact_person: person.trim(), contact_phone: phone.trim(), contact_email: email.trim(),
      });
      s.setOk(`Vendor "${v.name}" created · UID ${v.uid}`);
      setName(''); setPerson(''); setPhone(''); setEmail('');
    } catch (e) { s.setErr(apiError(e)); } finally { s.setBusy(false); }
  }
  return (
    <Card>
      <h3>Onboard Vendor</h3>
      <ErrorBanner msg={s.err} />{s.ok && <div className="banner-ok">{s.ok}</div>}
      <label>Company Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Signage Co" />
      <div className="grid2">
        <div><label>Contact Person Name *</label><input value={person} onChange={(e) => setPerson(e.target.value)} /></div>
        <div><label>Contact Person Phone *</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <label>Vendor Email *</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@vendor.com" />
      <p className="meta" style={{ marginTop: 6 }}>All fields are required. Emails must be unique across vendors. A vendor UID is generated automatically.</p>
      <Button onClick={submit} disabled={s.busy} style={{ marginTop: 14 }}>Create Vendor</Button>
    </Card>
  );
}

const EMPTY_STORE = {
  customer_code: '', uid: '', name: '', address: '', pincode: '',
  lat: '', long: '', contact_no: '', contact_email: '', contact_person: '', outlet_status: '',
};

/**
 * Create-or-update a store, keyed on Customer Code. There is deliberately no
 * vendor picker here any more: a store's vendor mapping is managed separately
 * and is never changed by this form.
 */
function StoreForm() {
  const s = useFormStatus();
  const [f, setF] = useState({ ...EMPTY_STORE });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    s.setErr(null); s.setOk(null);
    const missing = ([
      ['customer_code', 'Customer Code'], ['uid', 'Store UID'], ['name', 'Name'],
      ['address', 'Address'], ['pincode', 'Pincode'], ['lat', 'Latitude'], ['long', 'Longitude'],
      ['contact_no', 'Contact No'], ['contact_email', 'Contact Email'], ['contact_person', 'Contact Person'],
    ] as [keyof typeof f, string][]).filter(([k]) => !f[k].trim()).map(([, label]) => label);
    if (missing.length) { s.setErr(`Required: ${missing.join(', ')}`); return; }
    const lat = Number(f.lat), long = Number(f.long);
    if (Number.isNaN(lat) || Number.isNaN(long)) { s.setErr('Latitude/Longitude must be numbers'); return; }
    s.setBusy(true);
    try {
      const saved = await createStore({
        customer_code: f.customer_code.trim(), uid: f.uid.trim(),
        name: f.name.trim(), address: f.address.trim(), pincode: f.pincode.trim(), lat, long,
        contact_no: f.contact_no.trim(), contact_email: f.contact_email.trim(),
        contact_person: f.contact_person.trim(), outlet_status: f.outlet_status.trim() || undefined,
      });
      s.setOk(saved.outcome === 'updated'
        ? `Existing store "${saved.name}" updated (Customer Code ${saved.customer_code})`
        : `Store "${saved.name}" created (Customer Code ${saved.customer_code})`);
      setF({ ...EMPTY_STORE });
    } catch (e) { s.setErr(apiError(e)); } finally { s.setBusy(false); }
  }
  return (
    <Card>
      <h3>Create / Update Store</h3>
      <ErrorBanner msg={s.err} />{s.ok && <div className="banner-ok">{s.ok}</div>}
      <p className="meta" style={{ marginTop: -4 }}>
        Saving looks the store up by <b>Customer Code</b>: if it already exists the existing
        record is updated in place (its tasks stay attached); otherwise a new store is created.
      </p>
      <div className="grid2">
        <div><label>Customer Code *</label><input value={f.customer_code} onChange={set('customer_code')} placeholder="e.g. YG000000026" /></div>
        <div><label>Store UID *</label><input value={f.uid} onChange={set('uid')} placeholder="e.g. 00830422" /></div>
      </div>
      <label>Name *</label><input value={f.name} onChange={set('name')} />
      <label>Address *</label><input value={f.address} onChange={set('address')} />
      <div className="grid2">
        <div><label>Pincode *</label><input value={f.pincode} onChange={set('pincode')} /></div>
        <div><label>Outlet Status</label><input value={f.outlet_status} onChange={set('outlet_status')} placeholder="e.g. ACTIVE" /></div>
        <div><label>Latitude *</label><input value={f.lat} onChange={set('lat')} placeholder="19.0760" /></div>
        <div><label>Longitude *</label><input value={f.long} onChange={set('long')} placeholder="72.8777" /></div>
        <div><label>Contact Person *</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div><label>Contact No *</label><input value={f.contact_no} onChange={set('contact_no')} /></div>
      </div>
      <label>Contact Email *</label><input value={f.contact_email} onChange={set('contact_email')} placeholder="store@example.com" />
      <Button onClick={submit} disabled={s.busy} style={{ marginTop: 14 }}>Save Store</Button>
    </Card>
  );
}

const ROLES_RJCORP = ['rjcorp_admin', 'rjcorp_user', 'vendor_admin', 'vendor_user', 'employee'];
const ROLES_VENDOR = ['employee', 'vendor_user', 'vendor_admin'];
const VENDOR_SCOPED = ['vendor_admin', 'vendor_user', 'employee'];

function UserForm({ isRjcorp, canAssignRole }: { isRjcorp: boolean; canAssignRole: boolean }) {
  const s = useFormStatus();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [roleOptions, setRoleOptions] = useState<Role[]>([]);
  const roles = isRjcorp ? ROLES_RJCORP : ROLES_VENDOR;
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', role: roles[0], mobile: '', vendor_id: '', custom_role_id: '' });
  useEffect(() => { if (isRjcorp) getVendors().then(setVendors).catch(() => {}); }, [isRjcorp]);
  useEffect(() => { if (canAssignRole) getRoles().then(setRoleOptions).catch(() => {}); }, [canAssignRole]);
  const needsVendor = isRjcorp && VENDOR_SCOPED.includes(f.role);
  // A named custom role selection means role=rjcorp_user + that role's privileges.
  const roleSelectValue = f.custom_role_id ? `custom:${f.custom_role_id}` : f.role;
  function onRoleChange(v: string) {
    if (v.startsWith('custom:')) setF({ ...f, role: 'rjcorp_user', custom_role_id: v.slice(7) });
    else setF({ ...f, role: v, custom_role_id: '' });
  }
  async function submit() {
    s.setErr(null); s.setOk(null);
    if (!f.first_name || !f.last_name || !f.email) { s.setErr('First name, last name, email required'); return; }
    if (needsVendor && !f.vendor_id) { s.setErr('Select a vendor for this account'); return; }
    s.setBusy(true);
    try {
      const created = await createUser({
        first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim(),
        role: f.role, mobile: f.mobile.trim() || undefined,
        vendor_id: needsVendor ? f.vendor_id : undefined,
        custom_role_id: f.custom_role_id || undefined,
      });
      const { user, email_sent } = created;
      const emailNote = email_sent
        ? ' · temporary password emailed'
        : ' · NOTE: email is not configured, so no password was delivered. The user must use “Forgot password”.';
      s.setOk((user.uid ? `Account "${f.email}" created · UID ${user.uid}` : `Account "${f.email}" created`) + emailNote);
      setF({ ...f, first_name: '', last_name: '', email: '', mobile: '', custom_role_id: '' });
    } catch (e) { s.setErr(apiError(e)); } finally { s.setBusy(false); }
  }
  return (
    <Card>
      <h3>Create Account</h3>
      <ErrorBanner msg={s.err} />{s.ok && <div className="banner-ok">{s.ok}</div>}
      <div className="grid2">
        <div><label>First Name</label><input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></div>
        <div><label>Last Name</label><input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></div>
      </div>
      <label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label>Mobile (optional)</label>
      <input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
      <p className="meta" style={{ marginTop: 4 }}>
        A temporary password is generated automatically and emailed to this address.
        Nobody else — including you — is shown it.
      </p>
      <label>Role</label>
      <select value={roleSelectValue} onChange={(e) => onRoleChange(e.target.value)}>
        {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}</option>)}
        {canAssignRole && roleOptions.length > 0 && (
          <optgroup label="Custom roles (RJCorp)">
            {roleOptions.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
          </optgroup>
        )}
      </select>
      {canAssignRole && (
        <p className="meta" style={{ marginTop: 4 }}>
          Named custom roles come from Manage → Roles and are applied as RJCorp users with those privileges.
        </p>
      )}
      {needsVendor && (
        <>
          <label>Vendor</label>
          <select value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </>
      )}
      <Button onClick={submit} disabled={s.busy} style={{ marginTop: 14 }}>Create Account</Button>
    </Card>
  );
}

type TaskKind = 'recee' | 'boarding' | 'pamphlet';
function TaskForm() {
  const s = useFormStatus();
  const [kind, setKind] = useState<TaskKind>('recee');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sizes, setSizes] = useState<BoardingSize[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [vendorId, setVendorId] = useState(''); const [storeId, setStoreId] = useState('');
  const [brandId, setBrandId] = useState(''); const [artworkId, setArtworkId] = useState(''); const [sizeId, setSizeId] = useState(''); const [sigType, setSigType] = useState<SignageType | ''>('');
  const [pincode, setPincode] = useState(''); const [target, setTarget] = useState('');
  useEffect(() => {
    Promise.all([getVendors(), getStores(), getBrands(), getBoardingSizes(), getArtworks()])
      .then(([v, st, b, sz, aw]) => { setVendors(v); setStores(st); setBrands(b); setSizes(sz); setArtworks(aw); }).catch(() => {});
  }, []);
  const storeRequired = kind === 'recee' || kind === 'boarding';
  async function submit() {
    s.setErr(null); s.setOk(null);
    if (!vendorId) { s.setErr('Select a vendor'); return; }
    if (storeRequired && !storeId) { s.setErr('Select a store'); return; }
    s.setBusy(true);
    try {
      if (kind === 'recee') await createTask({ task_type: 'recee', vendor_id: vendorId, store_id: storeId });
      else if (kind === 'boarding') await createTask({
        task_type: 'installation', installation_type: 'direct_boarding', vendor_id: vendorId, store_id: storeId,
        brand_id: brandId || undefined, artwork_id: artworkId || undefined, boarding_size_id: sizeId || undefined, signage_type: sigType || undefined,
      });
      else await createTask({
        task_type: 'installation', installation_type: 'direct', vendor_id: vendorId, store_id: storeId || undefined,
        pincode: pincode.trim() || undefined, target_pamphlet_count: target.trim() ? Number(target) : undefined,
      });
      s.setOk('Task created and assigned to the vendor');
    } catch (e) { s.setErr(apiError(e)); } finally { s.setBusy(false); }
  }
  return (
    <Card>
      <h3>Create Task</h3>
      <ErrorBanner msg={s.err} />{s.ok && <div className="banner-ok">{s.ok}</div>}
      <label>Task Type</label>
      <div className="chips">
        {([['recee', 'Recee'], ['boarding', 'Installation w/o Recee'], ['pamphlet', 'Direct Installation']] as [TaskKind, string][]).map(([k, l]) => (
          <div key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</div>
        ))}
      </div>
      <label>Vendor *</label>
      <SearchableSelect
        value={vendorId}
        onChange={setVendorId}
        placeholder="Search vendor…"
        options={vendors.map((v) => ({ value: v.id, label: v.name }))}
      />
      <label>Store {storeRequired ? '*' : '(optional)'}</label>
      <SearchableSelect
        value={storeId}
        onChange={setStoreId}
        placeholder="Search store…"
        options={stores.map((st) => ({ value: st.id, label: st.name }))}
      />
      {kind === 'boarding' && (
        <>
          <label>Brand (optional)</label>
          <SearchableSelect
            value={brandId}
            onChange={(v) => { setBrandId(v); setArtworkId(''); }}
            placeholder="Search brand…"
            options={brands.map((b) => ({ value: b.id, label: b.name }))}
          />
          {brandId && (() => {
            const opts = artworks.filter((a) => a.brand_id === brandId && a.is_active);
            return (
              <>
                <label>Artwork (optional)</label>
                <SearchableSelect
                  value={artworkId}
                  onChange={setArtworkId}
                  placeholder={opts.length ? 'Search artwork…' : 'No artworks for this brand'}
                  disabled={!opts.length}
                  options={opts.map((a) => ({ value: a.id, label: a.name }))}
                />
              </>
            );
          })()}
          <label>Board Size (optional)</label>
          <SearchableSelect
            value={sizeId}
            onChange={setSizeId}
            placeholder="Search size…"
            options={sizes.map((sz) => ({ value: sz.id, label: sz.label }))}
          />
          <label>Signage Type (optional)</label>
          <select value={sigType} onChange={(e) => setSigType(e.target.value as SignageType)}>
            <option value="">Select type…</option>
            {SIGNAGE_TYPES.map((t) => <option key={t} value={t}>{SIGNAGE_TYPE_LABELS[t]}</option>)}
          </select>
        </>
      )}
      {kind === 'pamphlet' && (
        <div className="grid2">
          <div><label>Pincode (optional)</label><input value={pincode} onChange={(e) => setPincode(e.target.value)} /></div>
          <div><label>Target Pamphlet Count (optional)</label><input value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        </div>
      )}
      <Button onClick={submit} disabled={s.busy} style={{ marginTop: 14 }}>Create Task</Button>
    </Card>
  );
}

