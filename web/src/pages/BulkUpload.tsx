import { useState } from 'react';
import { useHasPrivilege } from '../store/auth';
import { uploadBulkFile, type BulkResult, type BulkTarget, type TaskKind } from '../api';
import type { Privilege } from '../types';
import { Button, Card, ErrorBanner } from '../components/ui';
import { apiError } from '../api/client';

// A single upload channel. Tasks are split by type — each posts to /api/bulk/tasks
// with its own `kind` and its own type-specific template — but they live together
// under one "Tasks" top-level tab with per-type sub-tabs.
interface Channel {
  key: string;
  label: string;
  target: BulkTarget;
  kind?: TaskKind;
  templateBase: string; // /templates/<base>_template.xlsx + _sample.xlsx
  priv: Privilege;
  hint: string;
}

// Top-level channels (each is its own tab).
const SIMPLE: Channel[] = [
  { key: 'vendors', label: 'Vendors', target: 'vendors', templateBase: 'vendors', priv: 'vendor.manage',
    hint: 'name (required), contact_person, contact_phone, contact_email — UID is auto-generated' },
  { key: 'stores', label: 'Stores', target: 'stores', templateBase: 'stores', priv: 'store.manage',
    hint: 'name, address, pincode, lat, long, uid, contact_no, contact_email, contact_person, vendor_uid (which vendor the store belongs to)' },
  { key: 'users', label: 'Users', target: 'users', templateBase: 'users', priv: 'user.manage',
    hint: 'first_name, last_name, email, role, mobile, password (optional), vendor_uid (optional)' },
];

// Task sub-channels — shown as sub-tabs under the single "Tasks" tab.
const TASK_SUBS: Channel[] = [
  { key: 'recee', label: 'Recee', target: 'tasks', kind: 'recee', templateBase: 'tasks_recee', priv: 'task.create',
    hint: 'vendor_uid and store_uid (both required)' },
  { key: 'direct', label: 'Direct Installation', target: 'tasks', kind: 'direct', templateBase: 'tasks_direct', priv: 'task.create',
    hint: 'vendor_uid (required), pincode, target_pamphlet_count, and optionally store_uid — pamphlet distribution' },
  { key: 'boarding', label: 'Installation w/o Recee', target: 'tasks', kind: 'direct_boarding', templateBase: 'tasks_boarding', priv: 'task.create',
    hint: 'vendor_uid and store_uid (both required), brand_name, artwork_name (must match the brand), width_in, height_in (board size in inches)' },
];

export function BulkUpload() {
  const has = useHasPrivilege();
  const simple = SIMPLE.filter((c) => has(c.priv));
  const taskSubs = TASK_SUBS.filter((c) => has(c.priv));
  const showTasks = taskSubs.length > 0;

  // Top-level tabs: the simple channels, plus a single "Tasks" group tab.
  const topTabs = [...simple.map((c) => ({ key: c.key, label: c.label })), ...(showTasks ? [{ key: 'tasks', label: 'Tasks' }] : [])];

  const [tab, setTab] = useState<string>(topTabs[0]?.key ?? 'users');
  const [taskSub, setTaskSub] = useState<string>(taskSubs[0]?.key ?? 'recee');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setFile(null); setResult(null); setErr(null); };

  const channel = tab === 'tasks'
    ? (taskSubs.find((c) => c.key === taskSub) ?? taskSubs[0])
    : simple.find((c) => c.key === tab);

  async function submit() {
    setErr(null); setResult(null);
    if (!channel) return;
    if (!file) { setErr('Choose an .xlsx file'); return; }
    setBusy(true);
    try { setResult(await uploadBulkFile(channel.target, file, channel.kind)); }
    catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (!channel) return <div><h1>Bulk Upload</h1><p className="meta">You don't have access to any bulk uploads.</p></div>;

  return (
    <div>
      <h1>Bulk Upload</h1>
      <div className="tabs">
        {topTabs.map((t) => (
          <div key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => { setTab(t.key); reset(); }}>
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="tabs" style={{ marginTop: -4, marginBottom: 4 }}>
          {taskSubs.map((c) => (
            <div key={c.key} className={`tab ${taskSub === c.key ? 'on' : ''}`} onClick={() => { setTaskSub(c.key); reset(); }}>
              {c.label}
            </div>
          ))}
        </div>
      )}

      <Card>
        <ErrorBanner msg={err} />
        <div className="meta" style={{ marginBottom: 12 }}><b>Expected columns:</b> {channel.hint}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <a className="btn secondary sm" href={`/templates/${channel.templateBase}_template.xlsx`} download>⬇ Download {channel.label} template</a>
          <a className="meta" href={`/templates/${channel.templateBase}_sample.xlsx`} download>or a filled sample</a>
        </div>
        <div className="meta" style={{ marginBottom: 12 }}>Download the template, fill in your rows, then upload the .xlsx below. All-or-nothing: if any row has a problem, nothing is imported — fix the flagged rows and re-upload.</div>

        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        <Button onClick={submit} disabled={busy} style={{ marginTop: 14 }}>{busy ? 'Uploading…' : `Upload ${channel.label}`}</Button>

        {result && (
          <div style={{ marginTop: 14 }}>
            {result.failed.length > 0 ? (
              <div className="banner-error">
                Nothing was imported — {result.failed.length} row{result.failed.length === 1 ? '' : 's'} failed. Fix these and re-upload the whole file:
                {result.failed.map((f) => <div key={f.row}>Row {f.row}: {f.reason}</div>)}
              </div>
            ) : (
              <div className="banner-ok">
                ✓ {result.inserted} row(s) imported
                {channel.target === 'users' && result.emailed != null ? ` · ${result.emailed} credential email(s) sent` : ''}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
