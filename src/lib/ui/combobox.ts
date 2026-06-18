/** A pickable option in a fuzzy combobox: either an existing entry or an "add new". */
export interface ComboOption {
  kind: 'entry' | 'add';
  /** Present when kind === 'entry'. */
  id?: number;
  label: string;
}

export interface ComboResult {
  options: ComboOption[];
  /** id of an exact (case-insensitive) name match, or null. */
  exactId: number | null;
}

/**
 * Compute combobox options for a query against a catalog (clients/locations).
 * - Empty query → all entries, no add-row.
 * - Non-empty → case-insensitive substring matches; an "+ Add" row is pinned
 *   FIRST only when the query has no exact (case-insensitive) match.
 * - `exactId` lets the caller auto-bind a silently-exact match.
 */
export function comboboxOptions<T extends { id: number; name: string }>(
  entries: T[],
  query: string,
): ComboResult {
  const q = query.trim().toLowerCase();
  const exact = entries.find((e) => e.name.toLowerCase() === q);
  const matched = q === '' ? entries : entries.filter((e) => e.name.toLowerCase().includes(q));
  const options: ComboOption[] = matched.map((e) => ({ kind: 'entry', id: e.id, label: e.name }));
  if (q !== '' && !exact) {
    options.unshift({ kind: 'add', label: query.trim() });
  }
  return { options, exactId: exact ? exact.id : null };
}
