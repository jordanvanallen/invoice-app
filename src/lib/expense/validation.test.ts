import { describe, expect, test } from 'vitest';
import { expenseFinalizeBlockers, expenseTotal } from './validation';
import type { ExpenseDraft, ExpenseItem } from './types';

const row = (over: Partial<ExpenseItem> = {}): ExpenseItem => ({
  position: 0,
  date: '2026-07-01',
  description: 'Fuel',
  amountCents: 5_000,
  ...over,
});

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  seq: 1,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  items: [row()],
  ...over,
});

describe('expense validation', () => {
  test('sums integer cents and returns zero for no rows', () => {
    expect(expenseTotal([row({ amountCents: 125 }), row({ amountCents: 375 })])).toBe(500);
    expect(expenseTotal([])).toBe(0);
  });

  test('accepts a complete finalizable draft', () => {
    expect(expenseFinalizeBlockers(draft())).toEqual([]);
  });

  test('returns plain-language header and row blockers in focus order', () => {
    expect(expenseFinalizeBlockers(draft({
      seq: 0,
      reportDate: '',
      periodStart: '2026-08-01',
      periodEnd: '2026-07-01',
      items: [row({ date: '', description: '  ', amountCents: 0 })],
    }))).toEqual([
      { field: 'sequence', itemIndex: null, message: 'Enter a positive expense report number.' },
      { field: 'reportDate', itemIndex: null, message: 'Choose a report date.' },
      { field: 'periodEnd', itemIndex: null, message: 'The reporting period end must be on or after its start.' },
      { field: 'date', itemIndex: 0, message: 'Choose a date for expense 1.' },
      { field: 'description', itemIndex: 0, message: 'Enter a description for expense 1.' },
      { field: 'amountCents', itemIndex: 0, message: 'Enter an amount greater than $0.00 for expense 1.' },
    ]);
  });

  test('requires at least one row', () => {
    expect(expenseFinalizeBlockers(draft({ items: [] }))).toEqual([
      { field: 'items', itemIndex: null, message: 'Add at least one expense.' },
    ]);
  });
});
