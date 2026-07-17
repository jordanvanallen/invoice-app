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

  test('blocks dates before and after the reporting period in displayed row order', () => {
    expect(expenseFinalizeBlockers(draft({
      items: [
        row({ position: 0, date: '2026-06-30', description: '', amountCents: 0 }),
        row({ position: 1, date: '2026-07-16' }),
      ],
    }))).toEqual([
      { field: 'date', itemIndex: 0, message: 'Date is outside the reporting period' },
      { field: 'description', itemIndex: 0, message: 'Enter a description for expense 1.' },
      { field: 'amountCents', itemIndex: 0, message: 'Enter an amount greater than $0.00 for expense 1.' },
      { field: 'date', itemIndex: 1, message: 'Date is outside the reporting period' },
    ]);
  });

  test('accepts dates equal to both inclusive reporting-period boundaries', () => {
    expect(expenseFinalizeBlockers(draft({
      items: [row({ date: '2026-07-01' }), row({ position: 1, date: '2026-07-15' })],
    }))).toEqual([]);
  });

  test('validates header dates before row range and emits one date blocker per field', () => {
    expect(expenseFinalizeBlockers(draft({
      reportDate: '2026-02-30',
      periodStart: '2026-7-01',
      periodEnd: 'not-a-date',
      items: [row({ date: '2026-07-30' })],
    }))).toEqual([
      { field: 'reportDate', itemIndex: null, message: 'Choose a valid report date.' },
      { field: 'periodStart', itemIndex: null, message: 'Choose a valid reporting period start date.' },
      { field: 'periodEnd', itemIndex: null, message: 'Choose a valid reporting period end date.' },
    ]);

    expect(expenseFinalizeBlockers(draft({ items: [row({ date: '   ' })] }))).toEqual([
      { field: 'date', itemIndex: 0, message: 'Choose a date for expense 1.' },
    ]);
    expect(expenseFinalizeBlockers(draft({ items: [row({ date: '2026-02-30' })] }))).toEqual([
      { field: 'date', itemIndex: 0, message: 'Choose a valid date for expense 1.' },
    ]);
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

  test('defers row-range blockers until the reporting period is complete and ordered', () => {
    const outsideRow = [row({ date: '2026-06-30' })];

    expect(expenseFinalizeBlockers(draft({ periodStart: '', items: outsideRow }))).toEqual([
      { field: 'periodStart', itemIndex: null, message: 'Choose a reporting period start date.' },
    ]);
    expect(expenseFinalizeBlockers(draft({ periodEnd: '', items: outsideRow }))).toEqual([
      { field: 'periodEnd', itemIndex: null, message: 'Choose a reporting period end date.' },
    ]);
    expect(expenseFinalizeBlockers(draft({
      periodStart: '2026-08-01', periodEnd: '2026-07-01', items: outsideRow,
    }))).toEqual([
      { field: 'periodEnd', itemIndex: null, message: 'The reporting period end must be on or after its start.' },
    ]);
  });

  test('requires at least one row', () => {
    expect(expenseFinalizeBlockers(draft({ items: [] }))).toEqual([
      { field: 'items', itemIndex: null, message: 'Add at least one expense.' },
    ]);
  });
});
