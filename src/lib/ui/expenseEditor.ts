import type { Settings } from '../types';
import { expenseFinalizeBlockers } from '../expense/validation';
import { buildExpenseSnapshot } from '../expense/snapshot';
import type { ExpenseDraft, ExpenseSnapshot } from '../expense/types';

export interface ExpenseBlockerTarget {
  id: string;
  message: string;
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
