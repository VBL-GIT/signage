import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStores, downloadStoresReport } from '../api';
import type { Store } from '../types';
import { Spinner } from '../components/ui';
import { DownloadReportButton } from '../components/DownloadReportButton';

export function Stores() {
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => { getStores().then(setStores).catch(() => setStores([])); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores ?? [];
    return (stores ?? []).filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.address ?? '').toLowerCase().includes(q) ||
      (s.uid ?? '').toLowerCase().includes(q) ||
      (s.customer_code ?? '').toLowerCase().includes(q) ||
      (s.vendor_name ?? '').toLowerCase().includes(q));
  }, [stores, query]);

  if (!stores) return <Spinner />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1>Stores</h1>
        <DownloadReportButton label="Download report" filenamePrefix="stores-report" fetcher={downloadStoresReport} />
      </div>
      <p className="meta">Click a store to create the tasks to be done there.</p>
      <input placeholder="Search name, UID, Customer Code, address or vendor…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 480, marginBottom: 14 }} />
      <div className="row-list">
        {filtered.map((s) => (
          <div key={s.id} className="list-row" onClick={() => navigate(`/stores/${s.id}`)}>
            <div>
              <div style={{ fontWeight: 700 }}>{s.name} {s.uid && <span className="muted">· {s.uid}</span>}</div>
              <div className="meta">
                {s.customer_code ? `${s.customer_code} · ` : ''}{s.address} · {s.pincode}
                {s.outlet_status ? ` · ${s.outlet_status}` : ''}
              </div>
            </div>
            <div className="meta">{s.vendor_name ? `Vendor: ${s.vendor_name}` : <span style={{ color: 'var(--danger)' }}>No vendor</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
