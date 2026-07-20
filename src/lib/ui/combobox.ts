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

export interface ComboboxPopupStateInput {
  inputId: string;
  open: boolean;
  optionCount: number;
  highlight: number;
}

export interface ComboboxPopupState {
  visible: boolean;
  controlsId: string | undefined;
  activeDescendantId: string | undefined;
  activeIndex: number | null;
}

export interface ComboboxInputEditState {
  text: string;
  selectedId: null;
  open: true;
  highlight: 0;
}

/** Apply one raw-input transition completely before notifying its observer. */
export function applyComboboxInputEdit(
  text: string,
  apply: (state: ComboboxInputEditState) => void,
  onEdited: () => void,
): void {
  apply({ text, selectedId: null, open: true, highlight: 0 });
  onEdited();
}

/** Keep the combobox's exposed ARIA state aligned with popup nodes in the DOM. */
export function comboboxPopupState({
  inputId,
  open,
  optionCount,
  highlight,
}: ComboboxPopupStateInput): ComboboxPopupState {
  const visible = open && optionCount > 0;
  const activeIndex = visible && highlight >= 0 && highlight < optionCount ? highlight : null;
  return {
    visible,
    controlsId: visible ? `${inputId}-listbox` : undefined,
    activeDescendantId: activeIndex === null ? undefined : `${inputId}-option-${activeIndex}`,
    activeIndex,
  };
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
