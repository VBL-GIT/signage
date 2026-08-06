import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getStore, getTasks, getBrands, getBoardingSizes, getArtworks, createTask } from '../api';
import type { Store, Task, Brand, BoardingSize, Artwork, SignageType } from '../types';
import { SIGNAGE_TYPES, SIGNAGE_TYPE_LABELS } from '../types';
import { TaskBadge, Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { useHasPrivilege } from '../store/auth';
import { apiError } from '../api/client';

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee', post_recee: 'Installation (from recee)',
  direct: 'Direct Installation', direct_boarding: 'Installation w/o Recee',
};
function taskLabel(t: Task) {
  if (t.task_type === 'installation' && t.installation_type) return TYPE_LABEL[t.installation_type] ?? 'Installation';
  return TYPE_LABEL[t.task_type] ?? t.task_type;
}

type Kind = 'recee' | 'boarding' | 'direct';

export function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canCreate = useHasPrivilege()('task.create');
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
    if (!store!.vendor_id) { setErr('Map this store to a vendor first (in Onboarding → Store).'); return; }
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
        {store.uid && <div className="meta">UID: {store.uid}</div>}
        <div className="meta">Vendor: {store.vendor_name ?? <span style={{ color: 'var(--danger)' }}>Not mapped</span>}</div>
        {store.contact_person && <div className="meta">Contact: {store.contact_person}{store.contact_no ? ` · ${store.contact_no}` : ''}</div>}
      </Card>

      {canCreate && (
      <Card>
        <h3>Create a task at this store</h3>
        {!hasVendor && <div className="banner-error">This store has no vendor mapped — set one in Onboarding → Store before creating tasks.</div>}
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
