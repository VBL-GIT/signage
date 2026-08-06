export interface Coords {
  lat: number;
  long: number;
}

/** Great-circle distance between two lat/long points, in metres. */
export function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000; // earth radius (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLong = toRad(b.long - a.long);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLong / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Human-readable distance: metres under 1 km, otherwise kilometres. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
