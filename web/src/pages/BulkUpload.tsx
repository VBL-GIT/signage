import { useState } from 'react';
import { useHasPrivilege } from '../store/auth';
import { uploadBulkFile, type BulkResult, type BulkTarget, type TaskKind, type StoreFormat } from '../api';
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
  format?: StoreFormat;
  templateBase?: string; // /templates/<base>_template.xlsx + _sample.xlsx
  priv: Privilege;
  hint: string;
  note?: string;
}

// Top-level channels (each is its own tab).
const SIMPLE: Channel[] = [
  { key: 'vendors', label: 'Vendors', target: 'vendors', templateBase: 'vendors', priv: 'vendor.manage',
    hint: 'company_name (required), contact_person, contact_phone, contact_email, remarks — UID is auto-generated' },
  // Target stays 'users' — that is the API endpoint. Only the label and the
  // template file are named for employees, which is what these rows create.
  { key: 'users', label: 'Employees', target: 'users', templateBase: 'employees', priv: 'user.manage',
    hint: 'first_name, last_name, email, role, mobile, vendor_uid (optional) — a temporary password is generated and emailed to each account' },
];

// Stores accept two sheet layouts, as sub-tabs under one "Stores" tab.
const STORE_SUBS: Channel[] = [
  { key: 'compact', label: 'Store template', target: 'stores', format: 'compact', templateBase: 'stores', priv: 'store.manage',
    hint: 'customer_code, name, address, pincode, lat, long, contact_no, contact_email, contact_person, outlet_status',
    note: 'Rows are matched on customer_code: an existing code updates that store in place (its tasks stay attached), a new code creates one. Stores keep whichever vendor they are already mapped to — vendor_uid is no longer part of this template.' },
  { key: 'customer_master', label: 'Customer master (Speed dump)', target: 'stores', format: 'customer_master',
    templateBase: 'stores_customer_master', priv: 'store.manage',
    hint: 'hos, state cd, CUST_CD, CUST_NAME, CONT_PR, MOBILE_NO, ADDR_1…ADDR_5, ADDR_POSTAL, CHANNEL, SUB_CHANNEL, LATITUDE, LONGITUDE, CUST_STATUS',
    note: 'Upload the customer-master export unchanged, or start from the template — the columns are identical. CUST_CD becomes the Customer Code, which is what identifies the store and decides update vs. create. ADDR_1…ADDR_5 are joined into one address, dropping blanks, "-" and "NA". hos, state cd, CHANNEL and SUB_CHANNEL have no field of their own but are still kept with the store as source data. This export has no email column, so any contact email already on record is left untouched.' },
];

// Task sub-channels — shown as sub-tabs under the single "Tasks" tab.
const TASK_SUBS: Channel[] = [
  { key: 'recee', label: 'Recee', target: 'tasks', kind: 'recee', templateBase: 'tasks_recee', priv: 'task.create',
    hint: 'vendor_uid and customer_code (both required)' },
  { key: 'direct', label: 'Direct Installation', target: 'tasks', kind: 'direct', templateBase: 'tasks_direct', priv: 'task.create',
    hint: 'vendor_uid (required), pincode, target_pamphlet_count, and optionally customer_code — pamphlet distribution' },
  { key: 'boarding', label: 'Installation w/o Recee', target: 'tasks', kind: 'direct_boarding', templateBase: 'tasks_boarding', priv: 'task.create',
    hint: 'vendor_uid and customer_code (both required), brand_name, artwork_name (must match the brand), width_in, height_in (board size in inches)' },
];

export function BulkUpload() {
  const has = useHasPrivilege();
  const simple = SIMPLE.filter((c) => has(c.priv));
  const taskSubs = TASK_SUBS.filter((c) => has(c.priv));
  const storeSubs = STORE_SUBS.filter((c) => has(c.priv));
  const showTasks = taskSubs.length > 0;
  const showStores = storeSubs.length > 0;

  // Top-level tabs: the simple channels, plus grouped "Stores" and "Tasks" tabs.
  const topTabs = [
    ...simple.map((c) => ({ key: c.key, label: c.label })),
    ...(showStores ? [{ key: 'stores', label: 'Stores' }] : []),
    ...(showTasks ? [{ key: 'tasks', label: 'Tasks' }] : []),
  ];

  const [tab, setTab] = useState<string>(topTabs[0]?.key ?? 'users');
  const [taskSub, setTaskSub] = useState<string>(taskSubs[0]?.key ?? 'recee');
  const [storeSub, setStoreSub] = useState<string>(storeSubs[0]?.key ?? 'compact');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setFile(null); setResult(null); setErr(null); };

  const channel = tab === 'tasks'
    ? (taskSubs.find((c) => c.key === taskSub) ?? taskSubs[0])
    : tab === 'stores'
      ? (storeSubs.find((c) => c.key === storeSub) ?? storeSubs[0])
      : simple.find((c) => c.key === tab);

  async function submit() {
    setErr(null); setResult(null);
    if (!channel) return;
    if (!file) { setErr('Choose an .xlsx file'); return; }
    setBusy(true);
    try { setResult(await uploadBulkFile(channel.target, file, channel.kind, channel.format)); }
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

      {tab === 'stores' && (
        <div className="tabs" style={{ marginTop: -4, marginBottom: 4 }}>
          {storeSubs.map((c) => (
            <div key={c.key} className={`tab ${storeSub === c.key ? 'on' : ''}`} onClick={() => { setStoreSub(c.key); reset(); }}>
              {c.label}
            </div>
          ))}
        </div>
      )}

      <Card>
        <ErrorBanner msg={err} />
        <div className="meta" style={{ marginBottom: 12 }}><b>Expected columns:</b> {channel.hint}</div>
        {channel.note && <div className="meta" style={{ marginBottom: 12 }}>{channel.note}</div>}

        {channel.templateBase && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <a className="btn secondary sm" href={`/templates/${channel.templateBase}_template.xlsx`} download>⬇ Download {channel.label} template</a>
            <a className="meta" href={`/templates/${channel.templateBase}_sample.xlsx`} download>or a filled sample</a>
          </div>
        )}
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
              <>
                <div className="banner-ok">
                  ✓ {result.inserted} row(s) created
                  {result.updated ? ` · ${result.updated} existing row(s) updated` : ''}
                  {channel.target === 'users' && result.emailed != null ? ` · ${result.emailed} credential email(s) sent` : ''}
                  {channel.target === 'vendors' && result.emailed != null ? ` · ${result.emailed} welcome email(s) sent` : ''}
                </div>
                {channel.target === 'users' && result.email_failed && result.email_failed.length > 0 && (
                  <div className="banner-error" style={{ marginTop: 8 }}>
                    The accounts were created, but no temporary password reached these{' '}
                    {result.email_failed.length} address{result.email_failed.length === 1 ? '' : 'es'}.
                    They must use “Forgot password” on the sign-in page to get in:
                    {result.email_failed.map((e) => <div key={e}>{e}</div>)}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
