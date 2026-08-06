import { useState } from 'react';
import { Button, ErrorBanner } from './ui';
import { saveBlob } from '../lib/download';
import { apiError } from '../api/client';

interface Props {
  label: string;
  filenamePrefix: string;
  fetcher: () => Promise<Blob>;
}

/** Button that downloads a backend-generated .csv report, with its own busy/error state. */
export function DownloadReportButton({ label, filenamePrefix, fetcher }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setErr(null); setBusy(true);
    try {
      const blob = await fetcher();
      saveBlob(blob, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : `⬇ ${label}`}
      </Button>
      {err && <div style={{ marginTop: 6 }}><ErrorBanner msg={err} /></div>}
    </div>
  );
}
