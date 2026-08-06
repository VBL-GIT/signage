import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTask, getBrands, getBoardingSizes, getArtworks, approveRecee, type ApproveSignage } from '../api';
import type { Task, Brand, BoardingSize, Artwork, TaskStepPhoto } from '../types';
import { SIGNAGE_TYPE_LABELS } from '../types';
import { Button, Card, Spinner, ErrorBanner } from '../components/ui';
import { AnnotatedImage } from '../components/AnnotatedImage';
import { cmToIn, inToCm, customSizeLabel } from '../lib/units';
import { apiError } from '../api/client';

interface Decision {
  accepted: boolean;
  brand_id: string | null;
  artwork_id: string | null;
  boarding_size_id: string | null;
  custom_width_cm: string;
  custom_height_cm: string;
  customMode: boolean;
}

function sizeLabel(p: TaskStepPhoto) {
  if (p.boarding_size_label) return p.boarding_size_label;
  const c = customSizeLabel(p.custom_width_cm, p.custom_height_cm);
  return c ? `${c} (custom)` : 'not specified';
}

export function Approve() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [sizes, setSizes] = useState<BoardingSize[]>([]);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getTask(id), getBrands(), getBoardingSizes(), getArtworks()])
      .then(([t, b, s, a]) => {
        setTask(t); setBrands(b); setSizes(s); setArtworks(a);
        const recee = t.steps?.find((x) => x.step_type === 'recee');
        const init: Record<number, Decision> = {};
        (recee?.photos ?? []).forEach((p, i) => {
          const si = p.signage_index ?? i + 1;
          init[si] = {
            accepted: true, brand_id: null, artwork_id: null,
            boarding_size_id: p.boarding_size_id ?? null,
            custom_width_cm: p.custom_width_cm ? String(cmToIn(p.custom_width_cm)) : '',
            custom_height_cm: p.custom_height_cm ? String(cmToIn(p.custom_height_cm)) : '',
            customMode: !p.boarding_size_id && !!p.custom_width_cm,
          };
        });
        setDecisions(init);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!task) return <p>Task not found.</p>;

  const recee = task.steps?.find((x) => x.step_type === 'recee');
  const signages = [...(recee?.photos ?? [])].sort((a, b) => (a.signage_index ?? 0) - (b.signage_index ?? 0));

  function upd(si: number, patch: Partial<Decision>) {
    setDecisions((prev) => ({ ...prev, [si]: { ...prev[si], ...patch } }));
  }

  async function approve() {
    setErr(null);
    const payload: ApproveSignage[] = [];
    for (let i = 0; i < signages.length; i++) {
      const si = signages[i].signage_index ?? i + 1;
      const d = decisions[si];
      if (!d?.accepted) continue;
      if (!d.brand_id) { setErr(`Select a brand for Signage ${si}`); return; }
      const entry: ApproveSignage = { signage_index: si, brand_id: d.brand_id };
      if (d.artwork_id) entry.artwork_id = d.artwork_id;
      if (d.customMode) {
        const w = parseInt(d.custom_width_cm, 10), h = parseInt(d.custom_height_cm, 10);
        if (!w || !h) { setErr(`Enter custom size for Signage ${si}`); return; }
        entry.custom_width_cm = inToCm(w); entry.custom_height_cm = inToCm(h);
      } else if (d.boarding_size_id) {
        entry.boarding_size_id = d.boarding_size_id;
      }
      payload.push(entry);
    }
    if (payload.length === 0) { setErr('Accept at least one signage, or reject the recee.'); return; }
    setBusy(true);
    try {
      await approveRecee(id!, { approval_status: 'approved', signages: payload });
      navigate(`/tasks/${id}`);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  async function reject() {
    if (!reason.trim()) { setErr('Provide a rejection reason'); return; }
    setBusy(true); setErr(null);
    try {
      await approveRecee(id!, { approval_status: 'rejected', rejection_reason: reason });
      navigate(`/tasks/${id}`);
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <Link to={`/tasks/${id}`} className="meta">← Task</Link>
      <h1>Review Recee</h1>
      <Card>
        <div style={{ fontWeight: 700 }}>{task.store_name}</div>
        <div className="meta">{task.store_address}</div>
        <div className="meta">Employee: {task.employee_name} · Signages found: {signages.length}</div>
      </Card>

      <ErrorBanner msg={err} />

      <h3>Confirm brand &amp; size per signage</h3>
      {signages.map((p, i) => {
        const si = p.signage_index ?? i + 1;
        const d = decisions[si];
        const accepted = d?.accepted ?? true;
        return (
          <Card key={p.id} style={accepted ? {} : { opacity: 0.7, borderColor: 'var(--danger)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <AnnotatedImage uri={p.photo_url} annotation={p.annotation} markerX={p.marker_x} markerY={p.marker_y} size={150} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--brand)' }}>
                  Signage {si}{p.signage_type ? ` · ${SIGNAGE_TYPE_LABELS[p.signage_type]}` : ''}
                </div>
                <div className="meta">Recee suggested size: {sizeLabel(p)}</div>
                <div className="chips" style={{ marginTop: 8 }}>
                  <div className={`chip ${accepted ? 'accept-on' : ''}`} onClick={() => upd(si, { accepted: true })}>✓ Accept</div>
                  <div className={`chip ${!accepted ? 'reject-on' : ''}`} onClick={() => upd(si, { accepted: false })}>✕ Reject</div>
                </div>

                {accepted && (
                  <>
                    <label>Brand *</label>
                    <select value={d?.brand_id ?? ''} onChange={(e) => upd(si, { brand_id: e.target.value || null, artwork_id: null })}>
                      <option value="">Select brand…</option>
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>

                    {d?.brand_id && (() => {
                      const opts = artworks.filter((a) => a.brand_id === d.brand_id && a.is_active);
                      return (
                        <>
                          <label>Artwork</label>
                          <select value={d?.artwork_id ?? ''} onChange={(e) => upd(si, { artwork_id: e.target.value || null })}>
                            <option value="">{opts.length ? 'Select artwork…' : 'No artworks for this brand'}</option>
                            {opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </>
                      );
                    })()}

                    <label>Board size</label>
                    <div className="chips" style={{ marginBottom: 6 }}>
                      <div className={`chip ${!d?.customMode ? 'on' : ''}`} onClick={() => upd(si, { customMode: false })}>Standard</div>
                      <div className={`chip ${d?.customMode ? 'on' : ''}`} onClick={() => upd(si, { customMode: true })}>Custom</div>
                    </div>
                    {d?.customMode ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input placeholder="Width in" value={d.custom_width_cm} onChange={(e) => upd(si, { custom_width_cm: e.target.value })} />
                        <input placeholder="Height in" value={d.custom_height_cm} onChange={(e) => upd(si, { custom_height_cm: e.target.value })} />
                      </div>
                    ) : (
                      <select value={d?.boarding_size_id ?? ''} onChange={(e) => upd(si, { boarding_size_id: e.target.value || null })}>
                        <option value="">Select size…</option>
                        {sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    )}
                  </>
                )}
                {!accepted && <div className="meta" style={{ color: 'var(--danger)', marginTop: 8 }}>This signage will be rejected and not installed.</div>}
              </div>
            </div>
          </Card>
        );
      })}

      <Card>
        <label>Rejection reason (to reject the whole recee)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection…" />
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button onClick={approve} disabled={busy}>Approve accepted signages</Button>
          <Button variant="danger" onClick={reject} disabled={busy}>Reject recee</Button>
        </div>
      </Card>
    </div>
  );
}
