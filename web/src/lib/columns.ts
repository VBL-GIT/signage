/**
 * Column names are matched on SPELLING ONLY — case and punctuation are ignored,
 * everywhere a column name is read. The templates are all-caps (STATE_CD), the
 * API's own field names are not, and a customer-master export spells the same
 * column three different ways depending on who produced it. Mirrors
 * columnLookup in backend/src/services/validation.ts, so the console and the
 * importer agree on what counts as the same column.
 */
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Read one column out of a store's source_metadata (or any row-shaped object)
 * without caring how its key was cased.
 *
 * New imports store their keys canonically all-caps, but stores imported before
 * that still carry whatever the source sheet used (State_CD, "state cd"), and
 * those must keep displaying rather than silently reading as blank.
 */
export function columnValue(row: unknown, ...names: string[]): string {
  if (!row || typeof row !== 'object') return '';
  const byNormalised = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    const n = norm(k);
    if (!byNormalised.has(n)) byNormalised.set(n, v);
  }
  for (const name of names) {
    const v = byNormalised.get(norm(name));
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
