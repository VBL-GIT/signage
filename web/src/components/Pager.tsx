import { Button } from './ui';

/** Numbered pager: Prev, a window of page numbers around the current page
 * (with leading/trailing ellipses when there are more pages than fit), Next. */
export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const btn = (n: number) => (
    <button
      key={n}
      className={`page-btn ${n === page ? 'on' : ''}`}
      onClick={() => onChange(n)}
      disabled={n === page}
    >
      {n}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
      <Button variant="secondary" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>‹ Prev</Button>
      {start > 1 && <>{btn(1)}{start > 2 && <span className="muted">…</span>}</>}
      {nums.map(btn)}
      {end < totalPages && <>{end < totalPages - 1 && <span className="muted">…</span>}{btn(totalPages)}</>}
      <Button variant="secondary" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>Next ›</Button>
    </div>
  );
}
