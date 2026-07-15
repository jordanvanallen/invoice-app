import type { Settings } from '../types';
import { orderExpenseItems } from './order';
import type { ExpenseDraft, ExpenseSnapshot } from './types';
import { expenseTotal } from './validation';

export function buildExpenseSnapshot(
  draft: ExpenseDraft,
  settings: Settings,
  seq: number,
): ExpenseSnapshot {
  const items = orderExpenseItems(draft.items);
  return {
    reportNumber: `${seq}-${draft.year}`,
    seq,
    year: draft.year,
    reportDate: draft.reportDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    inspectorName: settings.inspectorName,
    inspectorAddress: settings.inspectorAddress,
    inspectorNumber: settings.inspectorNumber,
    logoDataUrl: settings.logoDataUrl,
    items,
    totalCents: expenseTotal(items),
  };
}
