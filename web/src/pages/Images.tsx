import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getImages } from '../api';
import type { TaskImage } from '../types';
import { useLightbox } from '../components/Lightbox';
import { Card, Spinner, Button } from '../components/ui';
import { Pager } from '../components/Pager';
import { SIGNAGE_TYPE_LABELS } from '../types';

const TYPE_LABEL: Record<string, string> = {
  recee: 'Recee',
  post_recee: 'Installation (from recee)',
  direct: 'Direct Installation',
  direct_boarding: 'Installation w/o Recee',
};
function label(img: TaskImage) {
  if (img.task_type === 'installation' && img.installation_type) return TYPE_LABEL[img.installation_type] ?? 'Installation';
  return TYPE_LABEL[img.task_type] ?? img.task_type;
}

const PAGE_SIZE = 20;

export function Images() {
  const { open: zoom } = useLightbox();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [storeUid, setStoreUid] = useState('');
  const [pincode, setPincode] = useState('');
  const [hos, setHos] = useState('');
  const [employeeUid, setEmployeeUid] = useState('');

  const [images, setImages] = useState<TaskImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Accepts explicit overrides so callers (like Clear) don't race React's async
  // state updates — reading `from`/`to`/etc directly right after setting them
  // would still see the pre-update values in this render's closure.
  async function search(pageNum: number, overrides?: Partial<{ from: string; to: string; storeUid: string; pincode: string; hos: string; employeeUid: string }>) {
    setErr(null);
    setLoading(true);
    try {
      const f = overrides?.from ?? from;
      const t = overrides?.to ?? to;
      const su = overrides?.storeUid ?? storeUid;
      const pc = overrides?.pincode ?? pincode;
      const hs = overrides?.hos ?? hos;
      const eu = overrides?.employeeUid ?? employeeUid;
      const params = {
        from: f || undefined, to: t || undefined,
        store_uid: su.trim() || undefined, pincode: pc.trim() || undefined,
        hos: hs.trim() || undefined, employee_uid: eu.trim() || undefined,
        limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE,
      };
      const { images: data, total: t2 } = await getImages(params);
      setImages(data);
      setTotal(t2);
      setPage(pageNum);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { search(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1>Images</h1>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label>Customer Code</label>
            <input placeholder="e.g. ST-014" value={storeUid} onChange={(e) => setStoreUid(e.target.value)} style={{ width: 140 }} />
          </div>
          <div>
            <label>Pincode</label>
            <input placeholder="e.g. 400001" value={pincode} onChange={(e) => setPincode(e.target.value)} style={{ width: 120 }} />
          </div>
          <div>
            <label>HOS</label>
            <input placeholder="Head of sales" value={hos} onChange={(e) => setHos(e.target.value)} style={{ width: 150 }} />
          </div>
          <div>
            <label>Employee</label>
            <input placeholder="UID or name" value={employeeUid} onChange={(e) => setEmployeeUid(e.target.value)} style={{ width: 150 }} />
          </div>
          <Button onClick={() => search(1)} disabled={loading}>{loading ? 'Searching…' : 'Search'}</Button>
          {(from || to || storeUid || pincode || hos || employeeUid) && (
            <Button
              variant="secondary"
              onClick={() => {
                setFrom(''); setTo(''); setStoreUid(''); setPincode(''); setHos(''); setEmployeeUid('');
                search(1, { from: '', to: '', storeUid: '', pincode: '', hos: '', employeeUid: '' });
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="meta" style={{ marginTop: 10 }}>
          Pincode matches either the store's pincode or the task's own area pincode (mainly used for direct/pamphlet distribution, which often isn't tied to a store).
        </div>
      </Card>

      {err && <div className="banner-error" style={{ marginBottom: 16 }}>{err}</div>}
      {loading ? (
        <Spinner />
      ) : images.length === 0 ? (
        <p className="meta">No images match this search.</p>
      ) : (
        <>
          <div className="meta" style={{ marginBottom: 12 }}>
            {total} photo{total === 1 ? '' : 's'} · page {page} of {totalPages}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
            {images.map((img) => (
              <div key={img.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                <img
                  src={img.photo_url}
                  alt={label(img)}
                  onClick={() => zoom({ uri: img.photo_url, alt: label(img) })}
                  style={{ width: '100%', height: 150, objectFit: 'cover', cursor: 'zoom-in', display: 'block' }}
                />
                <div style={{ padding: '8px 10px', fontSize: 12.5 }}>
                  <div style={{ fontWeight: 700 }}>{label(img)}</div>
                  <div className="meta">{img.store_name ?? (img.area_label || 'No store')}</div>
                  {img.pincode && <div className="meta">Pincode: {img.pincode}</div>}
                  {img.brand_label && <div className="meta">Brand: {img.brand_label}</div>}
                  {img.signage_type && <div className="meta">{SIGNAGE_TYPE_LABELS[img.signage_type]}</div>}
                  {img.employee_name && <div className="meta">{img.employee_name}</div>}
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{new Date(img.captured_at).toLocaleDateString()}</div>
                  <Link to={`/tasks/${img.task_id}`} className="meta" style={{ display: 'inline-block', marginTop: 4 }}>Open task →</Link>
                </div>
              </div>
            ))}
          </div>
          <Pager page={page} totalPages={totalPages} onChange={search} />
        </>
      )}
    </div>
  );
}
