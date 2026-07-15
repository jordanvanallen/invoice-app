import type { ExpenseBlocker, ExpenseDraft, ExpenseItem } from './types';

export function expenseTotal(items: readonly ExpenseItem[]): number {
  return items.reduce((sum, item) => sum + item.amountCents, 0);
}

export function expenseFinalizeBlockers(draft: ExpenseDraft): ExpenseBlocker[] {
  const blockers: ExpenseBlocker[] = [];
  if (!Number.isInteger(draft.seq) || (draft.seq ?? 0) <= 0) {
    blockers.push({
      field: 'sequence', itemIndex: null,
      message: 'Enter a positive expense report number.',
    });
  }
  if (!draft.reportDate) {
    blockers.push({ field: 'reportDate', itemIndex: null, message: 'Choose a report date.' });
  }
  if (!draft.periodStart) {
    blockers.push({
      field: 'periodStart', itemIndex: null,
      message: 'Choose a reporting period start date.',
    });
  }
  if (!draft.periodEnd) {
    blockers.push({
      field: 'periodEnd', itemIndex: null,
      message: 'Choose a reporting period end date.',
    });
  } else if (draft.periodStart && draft.periodStart > draft.periodEnd) {
    blockers.push({
      field: 'periodEnd', itemIndex: null,
      message: 'The reporting period end must be on or after its start.',
    });
  }
  if (draft.items.length === 0) {
    blockers.push({ field: 'items', itemIndex: null, message: 'Add at least one expense.' });
  }
  draft.items.forEach((item, itemIndex) => {
    if (!item.date) {
      blockers.push({
        field: 'date', itemIndex,
        message: `Choose a date for expense ${itemIndex + 1}.`,
      });
    }
    if (!item.description.trim()) {
      blockers.push({
        field: 'description', itemIndex,
        message: `Enter a description for expense ${itemIndex + 1}.`,
      });
    }
    if (!Number.isInteger(item.amountCents) || item.amountCents <= 0) {
      blockers.push({
        field: 'amountCents', itemIndex,
        message: `Enter an amount greater than $0.00 for expense ${itemIndex + 1}.`,
      });
    }
  });
  return blockers;
}
