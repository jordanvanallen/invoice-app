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

export interface ComboboxKeyState {
  open: boolean;
  highlight: number;
  optionCount: number;
  pending: boolean;
}

export interface ComboboxKeyResult {
  open: boolean;
  highlight: number;
  commitIndex: number | null;
  preventDefault: boolean;
  suppressBlurCommit: boolean;
}

export function comboboxKeyAction(state: ComboboxKeyState, key: string): ComboboxKeyResult {
  const unchanged = {
    open: state.open,
    highlight: state.highlight,
    commitIndex: null,
    preventDefault: false,
    suppressBlurCommit: false,
  };

  if (!state.open && (key === 'ArrowDown' || key === 'ArrowUp')) {
    return { ...unchanged, open: true };
  }
  if (key === 'ArrowDown') {
    return {
      ...unchanged,
      highlight: state.optionCount > 0
        ? Math.min(state.highlight + 1, state.optionCount - 1)
        : 0,
      preventDefault: true,
    };
  }
  if (key === 'ArrowUp') {
    return { ...unchanged, highlight: Math.max(0, state.highlight - 1), preventDefault: true };
  }
  if (key === 'Enter' && state.open && state.highlight >= 0 && state.highlight < state.optionCount) {
    return {
      ...unchanged,
      commitIndex: state.pending ? null : state.highlight,
      preventDefault: true,
    };
  }
  if (key === 'Tab') {
    return { ...unchanged, open: false, suppressBlurCommit: true };
  }
  if (key === 'Escape') {
    return { ...unchanged, open: false };
  }
  return unchanged;
}

export interface ComboboxBlurStateInput {
  selectedId: number | null;
  text: string;
  exactMatch: { id: number; name: string } | undefined;
  suppressCommit: boolean;
}

export interface ComboboxBlurState {
  selectedId: number | null;
  text: string;
  open: false;
  suppressBlurCommit: false;
}

interface ComboboxAddActionInput {
  pending: boolean;
  noun: string;
  label: string;
  add: (label: string) => Promise<ComboboxAddNewResult>;
}

export interface ComboboxAddedEntry {
  id: number;
  name: string;
  status?: string;
}

/** Number remains supported for existing callers that have no canonical name to return. */
export type ComboboxAddNewResult = number | ComboboxAddedEntry;

export type ComboboxAddActionResult =
  | { status: 'ignored' }
  | { status: 'added'; id: number; name: string; message: string }
  | { status: 'failed'; message: string };

export async function runComboboxAddAction(
  input: ComboboxAddActionInput,
): Promise<ComboboxAddActionResult> {
  if (input.pending) return { status: 'ignored' };
  try {
    const added = await input.add(input.label);
    const entry = typeof added === 'number'
      ? { id: added, name: input.label }
      : added;
    return {
      status: 'added',
      id: entry.id,
      name: entry.name,
      message: entry.status || `Added ${input.noun} "${entry.name}".`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim() : '';
    return {
      status: 'failed',
      message: `Couldn't add this ${input.noun}${detail ? `: ${detail}` : '.'}`,
    };
  }
}

export interface AddAndRefreshComboboxEntryInput<T extends { id: number; name: string }> {
  noun: string;
  label: string;
  add: (label: string) => Promise<number>;
  refresh: () => Promise<T[]>;
}

export interface AddAndRefreshComboboxEntryResult<T extends { id: number; name: string }> {
  entries: T[] | null;
  result: ComboboxAddedEntry;
}

/** Persist first, then resolve the canonical catalog name without losing partial success. */
export async function addAndRefreshComboboxEntry<T extends { id: number; name: string }>(
  input: AddAndRefreshComboboxEntryInput<T>,
): Promise<AddAndRefreshComboboxEntryResult<T>> {
  const id = await input.add(input.label);
  try {
    const entries = await input.refresh();
    const canonical = entries.find((entry) => entry.id === id);
    return {
      entries,
      result: canonical
        ? { id: canonical.id, name: canonical.name }
        : { id, name: input.label },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim() : '';
    return {
      entries: null,
      result: {
        id,
        name: input.label,
        status: `Added ${input.noun} "${input.label}", but couldn't refresh the ${input.noun} list${detail ? `: ${detail}` : '.'}`,
      },
    };
  }
}

export function comboboxBlurState(input: ComboboxBlurStateInput): ComboboxBlurState {
  const exactMatch = !input.suppressCommit && input.selectedId === null
    ? input.exactMatch
    : undefined;
  return {
    selectedId: exactMatch?.id ?? input.selectedId,
    text: exactMatch?.name ?? input.text,
    open: false,
    suppressBlurCommit: false,
  };
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
