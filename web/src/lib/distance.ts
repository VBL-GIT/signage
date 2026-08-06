export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(Number(meters))) return '—';
  const m = Number(meters);
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

interface Stroke { points: { x: number; y: number }[] }
export function parseStrokes(annotation?: string | null): Stroke[] | null {
  if (!annotation) return null;
  try {
    const d = JSON.parse(annotation);
    if (d && Array.isArray(d.strokes)) return d.strokes as Stroke[];
  } catch { /* ignore */ }
  return null;
}
