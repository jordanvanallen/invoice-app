import type { Settings } from '../types';
import {
  EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE,
  expenseFinalizeBlockers,
} from '../expense/validation';
import { buildExpenseSnapshot } from '../expense/snapshot';
import type { ExpenseBlocker, ExpenseDraft, ExpenseSnapshot } from '../expense/types';

export interface ExpenseBlockerTarget {
  id: string;
  message: string;
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
): ExpenseSnapshot {
  return buildExpenseSnapshot({ ...draft, seq }, settings, seq);
}

export function firstExpenseBlockerTarget(draft: ExpenseDraft): ExpenseBlockerTarget | null {
  const blocker = expenseFinalizeBlockers(draft)[0];
  if (!blocker) return null;
  if (blocker.itemIndex !== null) {
    const field = blocker.field === 'amountCents' ? 'amount' : blocker.field;
    return { id: `expense-row-${blocker.itemIndex}-${field}`, message: blocker.message };
  }
  const ids: Record<string, string> = {
    sequence: 'expense-sequence',
    reportDate: 'expense-report-date',
    periodStart: 'expense-period-start',
    periodEnd: 'expense-period-end',
    items: 'expense-add-row',
  };
  return { id: ids[blocker.field] ?? 'expense-add-row', message: blocker.message };
}

/** Select the shared out-of-range warning for one displayed expense row. */
export function expenseRowDateRangeWarning(
  blockers: readonly ExpenseBlocker[],
  itemIndex: number,
): string | null {
  return blockers.find((blocker) =>
    blocker.field === 'date'
      && blocker.itemIndex === itemIndex
      && blocker.message === EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE
  )?.message ?? null;
}
