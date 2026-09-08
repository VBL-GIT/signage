import { useEffect, useMemo, useState } from 'react';
import { useHasPrivilege } from '../store/auth';
import {
  getVendors, getUsers, setVendorActive, setUserActive, updateVendor, updateUser, deleteEmployee,
  getRoles, getPrivilegeCatalog, createRole, updateRole,
  getBrands, createBrand, getArtworks, createArtwork, updateArtwork, uploadPublicImage,
  downloadVendorsReport, downloadEmployeesReport, downloadBrandsReport, downloadArtworksReport,
  getUserPassword,
} from '../api';
import type { Vendor, User, Role, PrivilegeDef, Privilege, Brand, Artwork } from '../types';
import { ROLE_LABELS } from '../types';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { useLightbox } from '../components/Lightbox';
import { DownloadReportButton } from '../components/DownloadReportButton';
import { apiError } from '../api/client';

type Tab = 'vendors' | 'employees' | 'brands' | 'artworks' | 'roles';

export function Manage() {
  const has = useHasPrivilege();
  const tabs: { key: Tab; label: string }[] = [
    ...(has('vendor.status') ? [{ key: 'vendors' as Tab, label: 'Vendors' }] : []),
    ...(has('user.status') ? [{ key: 'employees' as Tab, label: 'Employees' }] : []),
    ...(has('artwork.manage') ? [{ key: 'brands' as Tab, label: 'Brands' }] : []),
    ...(has('artwork.manage') ? [{ key: 'artworks' as Tab, label: 'Artworks' }] : []),
    ...(has('role.manage') ? [{ key: 'roles' as Tab, label: 'Roles' }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'employees');

  return (
    <div>
      <h1>Manage</h1>
      <div className="tabs">
        {tabs.map((t) => <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</div>)}
      </div>
      {tab === 'vendors' && <Vendors />}
      {tab === 'employees' && <Employees />}
      {tab === 'brands' && <Brands />}
      {tab === 'artworks' && <Artworks />}
      {tab === 'roles' && <Roles />}
    </div>
  );
}

function Brands() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  async function reload() { setBrands(await getBrands()); }
  useEffect(() => { reload().catch((e) => setErr(apiError(e))); }, []);

  async function add() {
    setErr(null);
    if (!name.trim()) { setErr('Enter a brand name'); return; }
    setBusy(true);
    try { await createBrand(name.trim()); setName(''); await reload(); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!brands) return <Spinner />;
  const q = query.trim().toLowerCase();
  const shown = brands.filter((b) => !q || b.name.toLowerCase().includes(q));

  return (
    <div className="grid2">
      <Card>
        <h3>Add brand</h3>
        <ErrorBanner msg={err} />
        <label>Brand name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pepsi" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button onClick={add} disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Add brand'}</Button>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Brands ({shown.length})</h3>
          <DownloadReportButton label="Download report" filenamePrefix="brands-report" fetcher={downloadBrandsReport} />
        </div>
        <input placeholder="Search brands…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12, marginTop: 12 }} />
        {shown.length === 0 && <p className="meta">No brands match.</p>}
        <div className="row-list">
          {shown.map((b) => (
            <div key={b.id} className="list-row" style={{ cursor: 'default' }}>
              <div style={{ fontWeight: 700 }}>{b.name}</div>
              {b.created_at && <div className="meta">Added {new Date(b.created_at).toLocaleDateString()}</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

type ArtworkSort = 'newest' | 'oldest';

function Artworks() {
  const { open: zoom } = useLightbox();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [artworks, setArtworks] = useState<Artwork[] | null>(null);
  const [brandId, setBrandId] = useState('');
  const [name, setName] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ArtworkSort>('newest');

  async function reload() { setArtworks(await getArtworks()); }
  useEffect(() => {
    Promise.all([getBrands(), getArtworks()]).then(([b, a]) => { setBrands(b); setArtworks(a); }).catch((e) => setErr(apiError(e)));
  }, []);

  async function add() {
    setErr(null);
    if (!brandId) { setErr('Select a brand'); return; }
    if (!name.trim()) { setErr('Enter an artwork name'); return; }
    setBusy(true);
    try {
      const image_url = imageFile ? await uploadPublicImage(imageFile) : undefined;
      await createArtwork({ brand_id: brandId, name: name.trim(), image_url });
      setName(''); setImageFile(null); await reload();
    }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }
  async function toggle(a: Artwork) {
    setBusyId(a.id); setErr(null);
    try { const u = await updateArtwork(a.id, { is_active: !a.is_active }); setArtworks((p) => p!.map((x) => (x.id === a.id ? u : x))); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  async function setImage(a: Artwork, file: File) {
    setBusyId(a.id); setErr(null);
    try { const url = await uploadPublicImage(file); const u = await updateArtwork(a.id, { image_url: url }); setArtworks((p) => p!.map((x) => (x.id === a.id ? u : x))); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }

  if (!artworks) return <Spinner />;
  const q = query.trim().toLowerCase();
  const shown = artworks
    .filter((a) => (brandId ? a.brand_id === brandId : true))
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.uid.toLowerCase().includes(q) || (a.brand_name ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const db = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sort === 'newest' ? db - da : da - db;
    });
  return (
    <div className="grid2">
      <Card>
        <h3>Add artwork</h3>
        <ErrorBanner msg={err} />
        <label>Brand</label>
        <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          <option value="">Select brand…</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label>Artwork name / code</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pepsi-Summer-2026" />
        <label>Reference image (optional)</label>
        <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
        <Button onClick={add} disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Add artwork'}</Button>
        <p className="meta" style={{ marginTop: 6 }}>Pick a brand to filter the list on the right. The image is shown to the employee during installation.</p>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Artworks ({shown.length})</h3>
          <DownloadReportButton label="Download report" filenamePrefix="artworks-report" fetcher={downloadArtworksReport} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            placeholder="Search name, UID or brand…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as ArtworkSort)} style={{ width: 'auto' }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        {shown.length === 0 && <p className="meta">No artworks match.</p>}
        <div className="row-list">
          {shown.map((a) => (
            <div key={a.id} className="list-row" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {a.image_url
                  ? <img
                      src={a.image_url}
                      alt={a.name}
                      onClick={() => zoom({ uri: a.image_url!, alt: a.name })}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in' }}
                    />
                  : <div style={{ width: 48, height: 48, borderRadius: 6, border: '1px dashed var(--border)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--muted)' }}>no img</div>}
                <div>
                  <div style={{ fontWeight: 700 }}>{a.name} <span className="muted">· {a.uid}</span></div>
                  <div className="meta">
                    {a.brand_name}
                    {a.created_at ? ` · Added ${new Date(a.created_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="meta" style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                  {a.image_url ? 'Replace image' : 'Add image'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    disabled={busyId === a.id}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setImage(a, f); }} />
                </label>
                <StatusPill active={a.is_active} />
                <Button size="sm" variant={a.is_active ? 'danger' : undefined} disabled={busyId === a.id} onClick={() => toggle(a)}>
                  {a.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`badge ${active ? 'completed' : 'recee_rejected'}`}>{active ? 'Active' : 'Inactive'}</span>;
}

function Vendors() {
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contact_person: '', contact_phone: '', contact_email: '' });
  const [query, setQuery] = useState('');
  useEffect(() => { getVendors().then(setVendors).catch((e) => setErr(apiError(e))); }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors ?? [];
    return (vendors ?? []).filter((v) =>
      v.name.toLowerCase().includes(q) ||
      v.uid.toLowerCase().includes(q) ||
      (v.contact_person ?? '').toLowerCase().includes(q) ||
      (v.contact_email ?? '').toLowerCase().includes(q) ||
      (v.contact_phone ?? '').toLowerCase().includes(q)
    );
  }, [vendors, query]);
  async function toggle(v: Vendor) {
    setBusyId(v.id); setErr(null);
    try { const u = await setVendorActive(v.id, !v.is_active); setVendors((p) => p!.map((x) => (x.id === v.id ? u : x))); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  function startEdit(v: Vendor) {
    setErr(null); setEditId(v.id);
    setForm({ name: v.name, contact_person: v.contact_person ?? '', contact_phone: v.contact_phone ?? '', contact_email: v.contact_email ?? '' });
  }
  async function save(v: Vendor) {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setBusyId(v.id); setErr(null);
    try { const u = await updateVendor(v.id, form); setVendors((p) => p!.map((x) => (x.id === v.id ? u : x))); setEditId(null); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  if (!vendors) return <Spinner />;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
        <DownloadReportButton label="Download report" filenamePrefix="vendors-report" fetcher={downloadVendorsReport} />
      </div>
      <ErrorBanner msg={err} />
      <input placeholder="Search name, UID, contact person, phone or email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12 }} />
      {filtered.length === 0 && <p className="meta">No vendors match.</p>}
      <div className="row-list">
        {filtered.map((v) => (
          <div key={v.id} className="list-row" style={{ cursor: 'default', alignItems: editId === v.id ? 'stretch' : 'center' }}>
            {editId === v.id ? (
              <div style={{ flex: 1 }}>
                <div className="muted" style={{ marginBottom: 6 }}>{v.uid}</div>
                <div className="grid2">
                  <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div><label>Contact person</label><input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                  <div><label>Contact phone</label><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
                  <div><label>Contact email</label><input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Button size="sm" disabled={busyId === v.id} onClick={() => save(v)}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontWeight: 700 }}>{v.name} <span className="muted">· {v.uid}</span></div>
                  <div className="meta">{v.contact_person ?? '—'}{v.contact_phone ? ` · ${v.contact_phone}` : ''}{v.contact_email ? ` · ${v.contact_email}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusPill active={v.is_active} />
                  <Button size="sm" variant="secondary" onClick={() => startEdit(v)}>Edit</Button>
                  <Button size="sm" variant={v.is_active ? 'danger' : undefined} disabled={busyId === v.id} onClick={() => toggle(v)}>
                    {v.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** One labelled read-only field in the user details panel. */
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="meta" style={{ marginBottom: 2 }}>{label}</div>
      <div>{value ?? <span className="muted">—</span>}</div>
    </div>
  );
}

function Employees() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', mobile: '' });
  useEffect(() => { getUsers({ role: 'employee' }).then(setUsers).catch((e) => setErr(apiError(e))); }, []);
  // Only head office can list vendors; degrade to "no vendor names" for others.
  useEffect(() => { getVendors().then(setVendors).catch(() => setVendors([])); }, []);
  const vendorName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.uid ?? '').toLowerCase().includes(q));
  }, [users, query]);
  async function toggle(u: User) {
    setBusyId(u.id); setErr(null);
    try { const upd = await setUserActive(u.id, !u.is_active); setUsers((p) => p!.map((x) => (x.id === u.id ? { ...x, is_active: upd.is_active } : x))); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  function startEdit(u: User) {
    setErr(null); setEditId(u.id);
    setForm({ first_name: u.first_name ?? '', last_name: u.last_name ?? '', email: u.email, mobile: u.phone ?? '' });
  }
  async function save(u: User) {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) { setErr('First name, last name and email are required'); return; }
    setBusyId(u.id); setErr(null);
    try { const upd = await updateUser(u.id, form); setUsers((p) => p!.map((x) => (x.id === u.id ? upd : x))); setEditId(null); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  async function remove(u: User) {
    if (!window.confirm(`Delete ${u.name}'s account? This permanently deletes them and ALL their tasks/history. This cannot be undone. (Dev/test cleanup only.)`)) return;
    setBusyId(u.id); setErr(null);
    try { await deleteEmployee(u.id); setUsers((p) => p!.filter((x) => x.id !== u.id)); }
    catch (e) { setErr(apiError(e)); } finally { setBusyId(null); }
  }
  if (!users) return <Spinner />;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12 }}>
        <DownloadReportButton label="Download report" filenamePrefix="employees-report" fetcher={downloadEmployeesReport} />
      </div>
      <ErrorBanner msg={err} />
      <input placeholder="Search name, UID or email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="row-list">
        {filtered.map((u) => (
          <div key={u.id} className="list-row" style={{ cursor: 'default', alignItems: editId === u.id ? 'stretch' : 'center' }}>
            {editId === u.id ? (
              <div style={{ flex: 1 }}>
                <div className="muted" style={{ marginBottom: 6 }}>{u.uid}</div>
                <div className="grid2">
                  <div><label>First name</label><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
                  <div><label>Last name</label><input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
                  <div><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div><label>Mobile</label><input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Button size="sm" disabled={busyId === u.id} onClick={() => save(u)}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div style={{ fontWeight: 700 }}>{u.name} {u.uid && <span className="muted">· {u.uid}</span>}</div>
                  <div className="meta">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                  {viewId === u.id && (
                    <div
                      className="grid2"
                      style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', gap: 10 }}
                    >
                      <Detail label="Full name" value={u.name} />
                      <Detail label="User UID" value={u.uid} />
                      <Detail label="First name" value={u.first_name} />
                      <Detail label="Last name" value={u.last_name} />
                      <Detail label="Email" value={u.email} />
                      <Detail label="Mobile" value={u.phone} />
                      <Detail label="Role" value={ROLE_LABELS[u.role] ?? u.role} />
                      <Detail label="Vendor" value={vendorName(u.vendor_id)} />
                      <Detail label="Custom role" value={u.custom_role_name} />
                      <Detail label="Status" value={(u.is_active ?? true) ? 'Active' : 'Inactive'} />
                    </div>
                  )}
                  {viewId === u.id && <PasswordDetail userId={u.id} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusPill active={u.is_active ?? true} />
                  <Button size="sm" variant="secondary" onClick={() => setViewId(viewId === u.id ? null : u.id)}>
                    {viewId === u.id ? 'Hide' : 'View'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => startEdit(u)}>Edit</Button>
                  <Button size="sm" variant={(u.is_active ?? true) ? 'danger' : undefined} disabled={busyId === u.id} onClick={() => toggle(u)}>
                    {(u.is_active ?? true) ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="danger" disabled={busyId === u.id} onClick={() => remove(u)} title="Dev/test cleanup only — permanently deletes this account and all its tasks">
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Roles() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [catalog, setCatalog] = useState<PrivilegeDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<Privilege>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function reload() { setRoles(await getRoles()); }
  useEffect(() => { Promise.all([getRoles(), getPrivilegeCatalog()]).then(([r, c]) => { setRoles(r); setCatalog(c); }).catch((e) => setErr(apiError(e))); }, []);

  function toggle(p: Privilege) {
    setPicked((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }
  function startNew() { setEditing(null); setName(''); setPicked(new Set()); }
  function startEdit(r: Role) { setEditing(r.id); setName(r.name); setPicked(new Set(r.privileges)); }

  async function save() {
    setErr(null);
    if (!name.trim()) { setErr('Role name is required'); return; }
    setBusy(true);
    try {
      if (editing) await updateRole(editing, { name: name.trim(), privileges: [...picked] });
      else await createRole({ name: name.trim(), privileges: [...picked] });
      startNew(); await reload();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!roles) return <Spinner />;
  return (
    <div className="grid2">
      <Card>
        <h3>{editing ? 'Edit role' : 'New role'}</h3>
        <ErrorBanner msg={err} />
        <label>Role name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Regional Coordinator" />
        <label>Privileges</label>
        <div style={{ display: 'grid', gap: 6 }}>
          {catalog.map((p) => (
            <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
              {p.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <Button onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Create role'}</Button>
          {editing && <Button variant="secondary" onClick={startNew}>Cancel</Button>}
        </div>
      </Card>

      <Card>
        <h3>Roles ({roles.length})</h3>
        {roles.length === 0 && <p className="meta">No custom roles yet.</p>}
        <div className="row-list">
          {roles.map((r) => (
            <div key={r.id} className="list-row" onClick={() => startEdit(r)}>
              <div>
                <div style={{ fontWeight: 700 }}>{r.name}</div>
                <div className="meta">{r.privileges.length} privilege{r.privileges.length === 1 ? '' : 's'}</div>
              </div>
              <span className="meta">Edit ›</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * Shows an account's password to an authorised admin.
 *
 * Fetched on demand, never with the user list: a password should only leave the
 * server when someone explicitly asks for that one account. Hidden again the
 * moment the detail panel is closed, since this component unmounts with it.
 *
 * A 403 renders nothing at all rather than "not allowed" — a vendor admin
 * browsing another vendor's staff has no reason to be told a password exists.
 */
function PasswordDetail({ userId }: { userId: string }) {
  const [state, setState] = useState<
    { status: 'idle' | 'loading' | 'hidden' } |
    { status: 'shown'; password: string | null; reason: string | null }
  >({ status: 'idle' });

  async function reveal() {
    setState({ status: 'loading' });
    try {
      const r = await getUserPassword(userId);
      setState({ status: 'shown', password: r.password, reason: r.reason });
    } catch {
      setState({ status: 'hidden' }); // not permitted, or gone — show nothing
    }
  }

  if (state.status === 'hidden') return null;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>Password</div>
      {state.status === 'shown' ? (
        state.password ? (
          <code style={{ fontSize: 14, background: 'var(--bg)', padding: '4px 8px', borderRadius: 4 }}>
            {state.password}
          </code>
        ) : (
          <div className="meta">{state.reason ?? 'Not available.'}</div>
        )
      ) : (
        <Button size="sm" variant="secondary" disabled={state.status === 'loading'} onClick={reveal}>
          {state.status === 'loading' ? 'Loading…' : 'Show password'}
        </Button>
      )}
    </div>
  );
}
