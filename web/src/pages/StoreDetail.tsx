import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getStore, getTasks, getBrands, getBoardingSizes, getArtworks, createTask, updateStore, getVendors } from '../api';
import type { Store, Task, Brand, BoardingSize, Artwork, SignageType, Vendor } from '../types';
import { SIGNAGE_TYPES, SIGNAGE_TYPE_LABELS } from '../types';
import { TaskBadge, Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { useHasPrivilege } from '../store/auth';
import { apiError } from '../api/client';
import { columnValue } from '../lib/columns';

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee', post_recee: 'Installation (from recee)',
  direct: 'Direct Installation', direct_boarding: 'Installation w/o Recee',
};
function taskLabel(t: Task) {
  if (t.task_type === 'installation' && t.installation_type) return TYPE_LABEL[t.installation_type] ?? 'Installation';
  return TYPE_LABEL[t.task_type] ?? t.task_type;
}

type Kind = 'recee' | 'boarding' | 'direct';

/**
 * Edit an existing store. Customer Code is editable but must
 * stay unique — the backend refuses a change that would collide with another
 * store rather than merging the two records.
 */
function StoreEditCard({ store, onSaved }: { store: Store; onSaved: (s: Store) => void }) {
  const [f, setF] = useState({
    customer_code: store.customer_code ?? '',
    uid: store.uid ?? '',
    name: store.name,
    address: store.address,
    pincode: store.pincode,
    lat: String(store.lat ?? ''),
    long: String(store.long ?? ''),
    contact_no: store.contact_no ?? '',
    contact_email: store.contact_email ?? '',
    contact_person: store.contact_person ?? '',
    outlet_status: store.outlet_status ?? '',
    // Context columns from the customer master. They live in source_metadata
    // rather than in columns of their own, and are prefilled from it — blank on
    // stores imported before they were collected, which must then be filled in
    // before the store can be saved.
    //
    // Read by spelling, not by exact key: new imports store these all-caps
    // (STATE_CD) while older ones carry whatever casing the source sheet used
    // (State_CD, "state cd"). An exact lookup showed a value that is plainly
    // stored as blank, and saving the form then had to re-enter it.
    HOS: columnValue(store.source_metadata, 'HOS'),
    STATE_CD: columnValue(store.source_metadata, 'STATE_CD'),
    CHANNEL: columnValue(store.source_metadata, 'CHANNEL'),
    SUB_CHANNEL: columnValue(store.source_metadata, 'SUB_CHANNEL'),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    const lat = Number(f.lat), long = Number(f.long);
    if (Number.isNaN(lat) || Number.isNaN(long)) { setErr('Latitude/Longitude must be numbers'); return; }
    setBusy(true);
    try {
      const saved = await updateStore(store.id, {
        customer_code: f.customer_code.trim(),
        // Carry the store's existing uid through untouched — tasks and images
        // still resolve stores by it. Omitted when the store has none, in which
        // case the server keeps it in step with the customer code.
        uid: f.uid.trim() || undefined,
        name: f.name.trim(),
        address: f.address.trim(), pincode: f.pincode.trim(), lat, long,
        contact_no: f.contact_no.trim(), contact_email: f.contact_email.trim(),
        contact_person: f.contact_person.trim(), outlet_status: f.outlet_status.trim(),
        HOS: f.HOS.trim(), STATE_CD: f.STATE_CD.trim(),
        CHANNEL: f.CHANNEL.trim(), SUB_CHANNEL: f.SUB_CHANNEL.trim(),
      });
      onSaved(saved);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <h3>Edit store</h3>
      <ErrorBanner msg={err} />
      <div className="grid2">
        <div><label>HOS *</label><input value={f.HOS} onChange={set('HOS')} /></div>
        <div><label>STATE_CD *</label><input value={f.STATE_CD} onChange={set('STATE_CD')} /></div>
        <div><label>CUST_CD (Customer Code) *</label><input value={f.customer_code} onChange={set('customer_code')} /></div>
        <div><label>CUST_STATUS *</label><input value={f.outlet_status} onChange={set('outlet_status')} /></div>
        <div><label>CHANNEL *</label><input value={f.CHANNEL} onChange={set('CHANNEL')} /></div>
        <div><label>SUB_CHANNEL *</label><input value={f.SUB_CHANNEL} onChange={set('SUB_CHANNEL')} /></div>
      </div>
      <label>CUST_NAME *</label><input value={f.name} onChange={set('name')} />
      <label>ADDR_1 (Address) *</label><input value={f.address} onChange={set('address')} />
      <div className="grid2">
        <div><label>ADDR_POSTAL (Pincode) *</label><input value={f.pincode} onChange={set('pincode')} /></div>
        <div><label>LATITUDE *</label><input value={f.lat} onChange={set('lat')} /></div>
        <div><label>LONGITUDE *</label><input value={f.long} onChange={set('long')} /></div>
        <div><label>CONT_PR (Contact Person) *</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div><label>MOBILE_NO (Contact No) *</label><input value={f.contact_no} onChange={set('contact_no')} /></div>
      </div>
      <label>CONTACT_EMAIL</label><input value={f.contact_email} onChange={set('contact_email')} />
      <p className="meta" style={{ marginTop: 6 }}>
        The store's vendor mapping is not changed here.
      </p>
      <Button onClick={save} disabled={busy} style={{ marginTop: 12 }}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </Card>
  );
}

/**
 * Map (or unmap) the store's vendor. Kept separate from the Edit form because
 * it is the one store change that affects who can SEE the store: vendor staff
 * only ever see stores mapped to their own vendor. Sending just vendor_id also
 * lets this work on stores created before Customer Code existed.
 */
function VendorMappingCard({ store, onSaved }: { store: Store; onSaved: (s: Store) => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState(store.vendor_id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getVendors().then(setVendors).catch((e) => setErr(apiError(e))); }, []);

  async function save() {
    setErr(null); setOk(null); setBusy(true);
    try {
      const saved = await updateStore(store.id, { vendor_id: vendorId || null });
      onSaved(saved);
      setOk(saved.vendor_id
        ? `Store mapped to ${saved.vendor_name ?? 'the selected vendor'}. Their team can now see it.`
        : 'Store is no longer mapped to a vendor.');
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  const changed = (vendorId || null) !== (store.vendor_id ?? null);
  return (
    <Card>
      <h3>Vendor mapping</h3>
      <ErrorBanner msg={err} />{ok && <div className="banner-ok">{ok}</div>}
      <p className="meta" style={{ marginTop: -4 }}>
        Which vendor is responsible for this store. Vendor staff only see stores mapped to
        their own vendor, and tasks created from this page are assigned to this vendor.
      </p>
      <label>Vendor</label>
      <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
        <option value="">Not mapped</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.uid}</option>)}
      </select>
      <Button onClick={save} disabled={busy || !changed} style={{ marginTop: 12 }}>
        {busy ? 'Saving…' : 'Save vendor mapping'}
      </Button>
    </Card>
  );
}

export function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const has = useHasPrivilege();
  const canCreate = has('task.create');
  const canManageStore = has('store.manage');
  const [editing, setEditing] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sizes, setSizes] = useState<BoardingSize[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);

  const [kind, setKind] = useState<Kind>('recee');
  const [brandId, setBrandId] = useState(''); const [artworkId, setArtworkId] = useState(''); const [sizeId, setSizeId] = useState(''); const [sigType, setSigType] = useState<SignageType | ''>('');
  const [pincode, setPincode] = useState(''); const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function reload() {
    if (!id) return;
    const [s, storeTasks] = await Promise.all([getStore(id), getTasks({ store_id: id })]);
    setStore(s);
    setTasks(storeTasks);
  }

  useEffect(() => {
    if (!id) return;
    Promise.all([getStore(id), getTasks({ store_id: id }), getBrands(), getBoardingSizes(), getArtworks()])
      .then(([s, storeTasks, b, sz, aw]) => {
        setStore(s); setTasks(storeTasks); setBrands(b); setSizes(sz); setArtworks(aw);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!store) return <p>Store not found.</p>;

  const hasVendor = !!store.vendor_id;

  async function create() {
    setErr(null); setOk(null);
    if (!store!.vendor_id) { setErr('Map this store to a vendor first, using the Vendor mapping section above.'); return; }
    setBusy(true);
    try {
      if (kind === 'recee') {
        await createTask({ task_type: 'recee', vendor_id: store!.vendor_id, store_id: store!.id });
      } else if (kind === 'boarding') {
        await createTask({
          task_type: 'installation', installation_type: 'direct_boarding',
          vendor_id: store!.vendor_id, store_id: store!.id,
          brand_id: brandId || undefined, artwork_id: artworkId || undefined, boarding_size_id: sizeId || undefined, signage_type: sigType || undefined,
        });
      } else {
        await createTask({
          task_type: 'installation', installation_type: 'direct',
          vendor_id: store!.vendor_id, store_id: store!.id,
          pincode: pincode.trim() || undefined, target_pamphlet_count: target.trim() ? Number(target) : undefined,
        });
      }
      setOk(`${kind === 'recee' ? 'Recee' : kind === 'boarding' ? 'Boarding installation' : 'Direct installation'} task created for ${store!.name}`);
      setBrandId(''); setArtworkId(''); setSizeId(''); setSigType(''); setPincode(''); setTarget('');
      await reload();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <Link to="/stores" className="meta">← Stores</Link>
      <h1>{store.name}</h1>

      <Card>
        <div className="meta">{store.address} · {store.pincode}</div>
        {store.customer_code && <div className="meta">Customer Code: <b>{store.customer_code}</b></div>}
        
        {store.outlet_status && <div className="meta">Outlet Status: {store.outlet_status}</div>}
        <div className="meta">Vendor: {store.vendor_name ?? <span style={{ color: 'var(--danger)' }}>Not mapped</span>}</div>
        {store.contact_person && <div className="meta">Contact: {store.contact_person}{store.contact_no ? ` · ${store.contact_no}` : ''}</div>}
        {store.contact_email && <div className="meta">Email: {store.contact_email}</div>}
        {canManageStore && (
          <Button className="secondary sm" onClick={() => setEditing((v) => !v)} style={{ marginTop: 10 }}>
            {editing ? 'Cancel edit' : 'Edit store'}
          </Button>
        )}
      </Card>

      {canManageStore && editing && (
        <StoreEditCard store={store} onSaved={(s) => { setStore(s); setEditing(false); }} />
      )}

      {canManageStore && <VendorMappingCard store={store} onSaved={setStore} />}

      {canCreate && (
      <Card>
        <h3>Create a task at this store</h3>
        {!hasVendor && (
          <div className="banner-error">
            This store has no vendor mapped{canManageStore
              ? ' \u2014 use the Vendor mapping section above before creating tasks here.'
              : ' \u2014 ask an administrator to map one before creating tasks here.'}
          </div>
        )}
        <ErrorBanner msg={err} />{ok && <div className="banner-ok">{ok}</div>}
        <div className="chips" style={{ marginBottom: 10 }}>
          {([['recee', 'Recee'], ['boarding', 'Installation w/o Recee'], ['direct', 'Direct Installation']] as [Kind, string][]).map(([k, l]) => (
            <div key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</div>
          ))}
        </div>

        {kind === 'boarding' && (
          <div className="grid2">
            <div>
              <label>Brand (optional)</label>
              <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setArtworkId(''); }}>
                <option value="">Select brand…</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {brandId && (
              <div>
                <label>Artwork (optional)</label>
                <select value={artworkId} onChange={(e) => setArtworkId(e.target.value)}>
                  {(() => {
                    const opts = artworks.filter((a) => a.brand_id === brandId && a.is_active);
                    return <>
                      <option value="">{opts.length ? 'Select artwork…' : 'No artworks for this brand'}</option>
                      {opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </>;
                  })()}
                </select>
              </div>
            )}
            <div>
              <label>Board Size (optional)</label>
              <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
                <option value="">Select size…</option>
                {sizes.map((sz) => <option key={sz.id} value={sz.id}>{sz.label}</option>)}
              </select>
            </div>
            <div>
              <label>Signage Type (optional)</label>
              <select value={sigType} onChange={(e) => setSigType(e.target.value as SignageType)}>
                <option value="">Select type…</option>
                {SIGNAGE_TYPES.map((t) => <option key={t} value={t}>{SIGNAGE_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
        )}
        {kind === 'direct' && (
          <div className="grid2">
            <div><label>Pincode (optional)</label><input value={pincode} onChange={(e) => setPincode(e.target.value)} /></div>
            <div><label>Target Count (optional)</label><input value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
        )}
        <Button onClick={create} disabled={busy || !hasVendor} style={{ marginTop: 14 }}>Create Task</Button>
        {hasVendor && <p className="meta" style={{ marginTop: 6 }}>Will be assigned to vendor <b>{store.vendor_name}</b>.</p>}
      </Card>
      )}

      <Card>
        <h3>Tasks at this store ({tasks.length})</h3>
        {tasks.length === 0 && <p className="meta">No tasks yet.</p>}
        <div className="row-list">
          {tasks.map((t) => (
            <div key={t.id} className="list-row" onClick={() => navigate(`/tasks/${t.id}`)}>
              <div>
                <div style={{ fontWeight: 700 }}>{taskLabel(t)}</div>
                <div className="meta">{t.employee_name ?? 'unassigned'}</div>
              </div>
              <TaskBadge task={t} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
