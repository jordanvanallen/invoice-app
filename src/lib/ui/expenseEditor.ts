import type { Settings } from '../types';
import { formatCents, parseDollars } from '../money';
import { EXPENSE_CATEGORIES, isExpenseCategory } from '../expense/category';
import { sortExpenseItems } from '../expense/order';
import {
  EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE,
  expenseFinalizeBlockers,
} from '../expense/validation';
import { buildExpenseSnapshot } from '../expense/snapshot';
import type {
  ExpenseBlocker,
  ExpenseBlockerField,
  ExpenseCategory,
  ExpenseDraft,
  ExpenseItem,
  SectionedExpenseSnapshot,
} from '../expense/types';

/** What the user is typing in one expense row. Its section is where it lives, not a field. */
export interface ExpenseEditorRow {
  uid: string;
  date: string;
  description: string;
  /** Raw typed text so the field never reformats mid-keystroke; cents are derived. */
  amountText: string;
}

/** Editor rows by section. Membership is structural, so a row cannot disagree with its section. */
export type ExpenseEditorSections = Record<ExpenseCategory, ExpenseEditorRow[]>;

export interface RemovedExpenseRow {
  row: ExpenseEditorRow;
  category: ExpenseCategory;
  index: number;
}

export type ExpenseRowField = 'date' | 'description' | 'amount' | 'move';

export interface ExpenseBlockerTarget {
  id: string;
  message: string;
}

let rowCounter = 0;

/** Unique for the app session: ids never collide across sections and follow a moved row. */
export function nextExpenseRowUid(): string {
  return `expense-item-${++rowCounter}`;
}

export function expenseRowFieldId(uid: string, field: ExpenseRowField): string {
  return `${uid}-${field}`;
}

export function expenseAddButtonId(category: ExpenseCategory): string {
  return `expense-add-${category}`;
}

export function expenseUndoButtonId(category: ExpenseCategory): string {
  return `expense-undo-${category}`;
}

/** Typed dollars as integer cents; blank or unparseable text is 0, which finalization blocks. */
export function expenseAmountCents(text: string): number {
  if (!text.trim()) return 0;
  try { return parseDollars(text); } catch { return 0; }
}

export function emptyExpenseEditorSections(): ExpenseEditorSections {
  return { vehicle: [], general: [] };
}

export function newExpenseEditorRow(date: string): ExpenseEditorRow {
  return { uid: nextExpenseRowUid(), date, description: '', amountText: '' };
}

/** Split saved rows into their sections, keeping saved order within each section. */
export function expenseEditorSections(items: readonly ExpenseItem[]): ExpenseEditorSections {
  const sections = emptyExpenseEditorSections();
  for (const item of items) {
    if (!isExpenseCategory(item.category)) {
      throw new Error(`Expense row ${item.position + 1} is not in the Vehicle or General/Admin section.`);
    }
    sections[item.category].push({
      uid: nextExpenseRowUid(),
      date: item.date,
      description: item.description,
      amountText: item.amountCents > 0 ? formatCents(item.amountCents) : '',
    });
  }
  return sections;
}

/** Canonical draft order: every vehicle row, then every general row. */
export function expenseDraftItems(sections: ExpenseEditorSections): ExpenseItem[] {
  return EXPENSE_CATEGORIES
    .flatMap((category) => sections[category].map((row) => ({ category, row })))
    .map(({ category, row }, position) => ({
      position,
      category,
      date: row.date,
      description: row.description,
      amountCents: expenseAmountCents(row.amountText),
    }));
}

/** Row uids in `expenseDraftItems` order, so blocker item indexes resolve to rows. */
export function expenseEditorRowUids(sections: ExpenseEditorSections): string[] {
  return EXPENSE_CATEGORIES.flatMap((category) => sections[category].map((row) => row.uid));
}

function locateRow(
  sections: ExpenseEditorSections,
  uid: string,
): { category: ExpenseCategory; index: number } | null {
  for (const category of EXPENSE_CATEGORIES) {
    const index = sections[category].findIndex((row) => row.uid === uid);
    if (index !== -1) return { category, index };
  }
  return null;
}

/** Append a row to the end of one section. A uid already present is ignored. */
export function appendExpenseEditorRow(
  sections: ExpenseEditorSections,
  category: ExpenseCategory,
  row: ExpenseEditorRow,
): ExpenseEditorSections {
  if (locateRow(sections, row.uid)) return sections;
  return { ...sections, [category]: [...sections[category], row] };
}

/** Move a row, keeping its uid and contents, to the end of the other section. */
export function moveExpenseEditorRow(
  sections: ExpenseEditorSections,
  uid: string,
  target: ExpenseCategory,
): ExpenseEditorSections {
  const found = locateRow(sections, uid);
  if (!found || found.category === target) return sections;
  const row = sections[found.category][found.index];
  return {
    ...sections,
    [found.category]: sections[found.category].filter((entry) => entry.uid !== uid),
    [target]: [...sections[target], row],
  };
}

export function removeExpenseEditorRow(
  sections: ExpenseEditorSections,
  uid: string,
): { sections: ExpenseEditorSections; removed: RemovedExpenseRow } | null {
  const found = locateRow(sections, uid);
  if (!found) return null;
  return {
    sections: {
      ...sections,
      [found.category]: sections[found.category].filter((entry) => entry.uid !== uid),
    },
    removed: { row: sections[found.category][found.index], ...found },
  };
}

/** Put a removed row back where it was in its section, or at the end if that section shrank. */
export function restoreExpenseEditorRow(
  sections: ExpenseEditorSections,
  removed: RemovedExpenseRow,
): ExpenseEditorSections {
  if (locateRow(sections, removed.row.uid)) return sections;
  const rows = [...sections[removed.category]];
  rows.splice(Math.min(removed.index, rows.length), 0, removed.row);
  return { ...sections, [removed.category]: rows };
}

/** Sort each section by date, then description (blanks last), into new arrays, never mixing sections. */
export function sortExpenseEditorSections(sections: ExpenseEditorSections): ExpenseEditorSections {
  return { vehicle: sortExpenseItems(sections.vehicle), general: sortExpenseItems(sections.general) };
}

/** Count unique expense rows with at least one finalization blocker. */
export function expenseBlockingRowCount(blockers: readonly ExpenseBlocker[]): number {
  return new Set(blockers.flatMap((blocker) =>
    blocker.itemIndex === null ? [] : [blocker.itemIndex]
  )).size;
}

/** Build the sorted Preview snapshot without changing the editor's row order. */
export function prepareExpensePreview(
  draft: ExpenseDraft,
  settings: Settings,
  seq: number,
): SectionedExpenseSnapshot {
  return buildExpenseSnapshot({ ...draft, seq }, settings, seq);
}

const ROW_FIELDS: Partial<Record<ExpenseBlockerField, ExpenseRowField>> = {
  date: 'date',
  description: 'description',
  amountCents: 'amount',
  category: 'move',
};

const HEADER_FIELD_IDS: Partial<Record<ExpenseBlockerField, string>> = {
  sequence: 'expense-sequence',
  reportDate: 'expense-report-date',
  periodStart: 'expense-period-start',
  periodEnd: 'expense-period-end',
  items: expenseAddButtonId(EXPENSE_CATEGORIES[0]),
};

/**
 * The element to focus for the first finalization blocker. `rowUids` must be in
 * `draft.items` order (see `expenseEditorRowUids`); a mismatch is a bug, not a
 * reason to focus the wrong row.
 */
export function firstExpenseBlockerTarget(
  draft: ExpenseDraft,
  rowUids: readonly string[],
): ExpenseBlockerTarget | null {
  if (rowUids.length !== draft.items.length) {
    throw new Error('Expense rows and their ids are out of sync.');
  }
  const blocker = expenseFinalizeBlockers(draft)[0];
  if (!blocker) return null;
  if (blocker.itemIndex !== null) {
    const field = ROW_FIELDS[blocker.field] ?? 'date';
    return { id: expenseRowFieldId(rowUids[blocker.itemIndex], field), message: blocker.message };
  }
  return {
    id: HEADER_FIELD_IDS[blocker.field] ?? expenseAddButtonId(EXPENSE_CATEGORIES[0]),
    message: blocker.message,
  };
}

function rowWarningMessage(blocker: ExpenseBlocker): string {
  if (blocker.field === 'description') return 'Enter a description';
  if (blocker.field === 'amountCents') return 'Enter an amount greater than $0.00';
  if (blocker.field === 'category') return 'Move this row to the Vehicle or General/Admin section';
  if (blocker.field === 'date') {
    if (blocker.message === EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE) {
      return EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE;
    }
    return blocker.message.startsWith('Choose a valid date')
      ? 'Choose a valid date'
      : 'Choose a date';
  }
  return blocker.message;
}

/** Concise display messages for every row blocker, keyed by row uid in draft item order. */
export function expenseRowWarningsByUid(
  blockers: readonly ExpenseBlocker[],
  rowUids: readonly string[],
): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  for (const blocker of blockers) {
    if (blocker.itemIndex === null) continue;
    const uid = rowUids[blocker.itemIndex];
    if (uid === undefined) continue;
    warnings.set(uid, [...(warnings.get(uid) ?? []), rowWarningMessage(blocker)]);
  }
  return warnings;
}
