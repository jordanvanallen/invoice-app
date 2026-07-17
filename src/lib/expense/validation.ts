import type { ExpenseBlocker, ExpenseDraft, ExpenseItem } from './types';
import { isDateOutsidePeriod, isValidIsoDate } from '../validation';

export const EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE = 'Date is outside the reporting period';

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
  const reportDateValid = isValidIsoDate(draft.reportDate);
  if (!draft.reportDate.trim()) {
    blockers.push({ field: 'reportDate', itemIndex: null, message: 'Choose a report date.' });
  } else if (!reportDateValid) {
    blockers.push({ field: 'reportDate', itemIndex: null, message: 'Choose a valid report date.' });
  }

  const periodStartValid = isValidIsoDate(draft.periodStart);
  const periodEndValid = isValidIsoDate(draft.periodEnd);

  if (!draft.periodStart.trim()) {
    blockers.push({
      field: 'periodStart', itemIndex: null,
      message: 'Choose a reporting period start date.',
    });
  } else if (!periodStartValid) {
    blockers.push({
      field: 'periodStart', itemIndex: null,
      message: 'Choose a valid reporting period start date.',
    });
  }
  if (!draft.periodEnd.trim()) {
    blockers.push({
      field: 'periodEnd', itemIndex: null,
      message: 'Choose a reporting period end date.',
    });
  } else if (!periodEndValid) {
    blockers.push({
      field: 'periodEnd', itemIndex: null,
      message: 'Choose a valid reporting period end date.',
    });
  } else if (periodStartValid && draft.periodStart > draft.periodEnd) {
    blockers.push({
      field: 'periodEnd', itemIndex: null,
      message: 'The reporting period end must be on or after its start.',
    });
  }

  const periodAllowsRows = periodStartValid
    && periodEndValid
    && draft.periodStart <= draft.periodEnd;

  if (draft.items.length === 0) {
    blockers.push({ field: 'items', itemIndex: null, message: 'Add at least one expense.' });
  }
  draft.items.forEach((item, itemIndex) => {
    if (!item.date.trim()) {
      blockers.push({
        field: 'date', itemIndex,
        message: `Choose a date for expense ${itemIndex + 1}.`,
      });
    } else if (!isValidIsoDate(item.date)) {
      blockers.push({
        field: 'date', itemIndex,
        message: `Choose a valid date for expense ${itemIndex + 1}.`,
      });
    } else if (periodAllowsRows && isDateOutsidePeriod(
      item.date, draft.periodStart, draft.periodEnd,
    )) {
      blockers.push({
        field: 'date', itemIndex,
        message: EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE,
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
