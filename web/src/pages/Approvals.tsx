import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTasks, getBrands, getArtworks, approveBulk, downloadApprovalsReport, type BulkApprovalResult } from '../api';
import type { Task, Brand, Artwork } from '../types';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { DownloadReportButton } from '../components/DownloadReportButton';
import { apiError } from '../api/client';

type Mode = null | 'approve' | 'reject';

export function Approvals() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>(null);
  const [brandId, setBrandId] = useState('');
  const [artworkId, setArtworkId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApprovalResult | null>(null);

  // filters
  const [query, setQuery] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('oldest');

  async function load() {
    const [t, b, a] = await Promise.all([getTasks({ status: 'recee_submitted' }), getBrands(), getArtworks()]);
    setTasks(t); setBrands(b); setArtworks(a);
  }
  useEffect(() => { load().catch((e) => { setErr(apiError(e)); setTasks([]); }); }, []);

  // Vendors that actually have recees awaiting approval (for the dropdown).
  const vendorsInQueue = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const t of tasks ?? []) {
      if (t.vendor_id && !m.has(t.vendor_id)) {
        m.set(t.vendor_id, { id: t.vendor_id, label: `${t.vendor_name ?? 'Vendor'}${t.vendor_uid ? ` (${t.vendor_uid})` : ''}` });
      }
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  // Apply search + vendor filter, then sort.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (tasks ?? []).filter((t) => {
      if (vendorId && t.vendor_id !== vendorId) return false;
      if (!q) return true;
      return [t.store_name, t.store_uid, t.vendor_name, t.vendor_uid, t.employee_name, t.store_pincode]
        .some((v) => (v ?? '').toString().toLowerCase().includes(q));
    });
    list = [...list].sort((a, b) => {
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return sort === 'oldest' ? da - db : db - da;
    });
    return list;
  }, [tasks, query, vendorId, sort]);

  const allIds = useMemo(() => shown.map((t) => t.id), [shown]);
  const allSelected = allIds.length > 0 && allIds.every((id) => sel.has(id));

  function toggle(id: string) {
    setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(allIds));
  }
  function openMode(m: Mode) { setErr(null); setResult(null); setBrandId(''); setArtworkId(''); setReason(''); setMode(m); }

  async function submit() {
    setErr(null);
    const task_ids = [...sel];
    if (!task_ids.length) { setErr('Select at least one recee'); return; }
    if (mode === 'approve' && !brandId) { setErr('Choose a brand to apply'); return; }
    if (mode === 'reject' && !reason.trim()) { setErr('Enter a rejection reason'); return; }
    setBusy(true);
    try {
      const res = mode === 'approve'
        ? await approveBulk({ action: 'approve', task_ids, brand_id: brandId, artwork_id: artworkId || undefined })
        : await approveBulk({ action: 'reject', task_ids, rejection_reason: reason.trim() });
      setResult(res);
      setMode(null);
      setSel(new Set());
      await load();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!tasks) return <Spinner />;

  const artOpts = artworks.filter((a) => a.brand_id === brandId && a.is_active);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1>Approvals <span className="muted" style={{ fontSize: 16 }}>({tasks.length} awaiting)</span></h1>
        <DownloadReportButton label="Download approval history" filenamePrefix="approvals-report" fetcher={downloadApprovalsReport} />
      </div>
      <p className="meta">Recees waiting for approval. Bulk actions apply to all signages of each selected recee — for per-signage accept/reject, open a recee individually.</p>

      <ErrorBanner msg={err} />
      {result && (
        <div className="banner-ok" style={{ marginBottom: 12 }}>
          ✓ {result.approved} approved · {result.rejected} rejected
          {result.failed.length > 0 && <> · {result.failed.length} skipped</>}
          {result.failed.map((f) => <div key={f.task_id} className="meta">Skipped {f.task_id.slice(0, 8)}…: {f.reason}</div>)}
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="meta">Nothing awaiting approval right now.</p>
      ) : (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div className="grid2">
              <div>
                <label>Search</label>
                <input placeholder="Store / vendor name, UID, employee, pincode…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div>
                <label>Vendor</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">All vendors</option>
                  {vendorsInQueue.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label>Sort</label>
                <select value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}>
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                {(query || vendorId) && <Button variant="secondary" size="sm" onClick={() => { setQuery(''); setVendorId(''); }}>Clear filters</Button>}
              </div>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>Showing {shown.length} of {tasks.length}</div>
          </Card>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 600 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={allSelected} onChange={toggleAll} />
              Select all{query || vendorId ? ' (filtered)' : ''}
            </label>
            <span className="meta">{sel.size} selected</span>
            <div style={{ flex: 1 }} />
            <Button size="sm" disabled={sel.size === 0} onClick={() => openMode('approve')}>Approve selected</Button>
            <Button size="sm" variant="danger" disabled={sel.size === 0} onClick={() => openMode('reject')}>Reject selected</Button>
          </div>

          {mode && (
            <Card style={{ marginBottom: 12, borderColor: 'var(--brand)' }}>
              {mode === 'approve' ? (
                <>
                  <h3>Approve {sel.size} recee(s)</h3>
                  <p className="meta">Applies this brand &amp; artwork to every signage; each signage keeps its recee-suggested size.</p>
                  <div className="grid2">
                    <div>
                      <label>Brand *</label>
                      <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setArtworkId(''); }}>
                        <option value="">Select brand…</option>
                        {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    {brandId && (
                      <div>
                        <label>Artwork (optional)</label>
                        <select value={artworkId} onChange={(e) => setArtworkId(e.target.value)}>
                          <option value="">{artOpts.length ? 'Select artwork…' : 'No artworks for this brand'}</option>
                          {artOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h3>Reject {sel.size} recee(s)</h3>
                  <label>Rejection reason *</label>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason applied to all selected recees…" />
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button onClick={submit} disabled={busy}>{busy ? 'Working…' : (mode === 'approve' ? 'Confirm approval' : 'Confirm rejection')}</Button>
                <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
              </div>
            </Card>
          )}

          {shown.length === 0 ? (
            <p className="meta">No recees match your filters.</p>
          ) : (
            <div className="row-list">
              {shown.map((t) => (
                <div key={t.id} className="list-row" style={{ cursor: 'default' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 0, flex: 1 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
                    <span>
                      <div style={{ fontWeight: 700 }}>{t.store_name ?? 'No store'}{t.store_uid ? <span className="muted"> · {t.store_uid}</span> : ''}</div>
                      <div className="meta">
                        {t.vendor_name ?? '—'}{t.vendor_uid ? ` (${t.vendor_uid})` : ''}
                        {t.employee_name ? ` · ${t.employee_name}` : ''} · {new Date(t.created_at).toLocaleDateString()}
                      </div>
                    </span>
                  </label>
                  <Link to={`/tasks/${t.id}/approve`} className="meta">Review ›</Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
