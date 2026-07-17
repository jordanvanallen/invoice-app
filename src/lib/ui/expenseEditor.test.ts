import { describe, expect, test } from 'vitest';
import {
  expenseBlockingRowCount,
  expenseRowWarnings,
  firstExpenseBlockerTarget,
  prepareExpensePreview,
} from './expenseEditor';
import { expenseFinalizeBlockers } from '../expense/validation';
import type { ExpenseDraft } from '../expense/types';
import type { Settings } from '../types';

const settings: Settings = {
  inspectorName: 'North Star', inspectorAddress: '1 Main', inspectorNumber: 'ON-7',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: '',
};

describe('expense editor helpers', () => {
  test('prepares a chronological Preview without moving editor rows', () => {
    const draft: ExpenseDraft = {
      seq: 4, year: 2026, reportDate: '2026-07-15',
      periodStart: '2026-07-01', periodEnd: '2026-07-15',
      items: [
        { position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
        { position: 1, date: '2026-07-02', description: 'Fuel', amountCents: 5_000 },
      ],
    };

    const preview = prepareExpensePreview(draft, settings, 4);

    expect(preview.items.map((row) => row.description)).toEqual(['Fuel', 'Parking']);
    expect(draft.items.map((row) => row.description)).toEqual(['Parking', 'Fuel']);
  });

  test('keeps Preview available while targeting an out-of-range second row', () => {
    const rangeDraft: ExpenseDraft = {
      seq: 4,
      year: 2026,
      reportDate: '2026-07-15',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-15',
      items: [
        { position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
        { position: 1, date: '2026-07-16', description: 'Fuel', amountCents: 5_000 },
      ],
    };

    const blockers = expenseFinalizeBlockers(rangeDraft);
    expect(firstExpenseBlockerTarget(rangeDraft)).toEqual({
      id: 'expense-row-1-date',
      message: 'Date is outside the reporting period',
    });
    expect(expenseRowWarnings(blockers, 0)).toEqual([]);
    expect(expenseRowWarnings(blockers, 1)).toEqual(['Date is outside the reporting period']);
    expect(expenseRowWarnings(blockers, 2)).toEqual([]);

    const preview = prepareExpensePreview(rangeDraft, settings, 4);
    expect(preview.items.map((entry) => entry.description)).toEqual(['Parking', 'Fuel']);
    expect(rangeDraft.items.map((entry) => entry.description)).toEqual(['Parking', 'Fuel']);
  });

  test('returns every row blocker in validation order with concise display copy', () => {
    const rangeDraft: ExpenseDraft = {
      seq: 4, year: 2026, reportDate: '2026-07-15',
      periodStart: '2026-07-01', periodEnd: '2026-07-15',
      items: [
        { position: 0, date: '2026-06-30', description: '', amountCents: 0 },
        { position: 1, date: '2026-07-16', description: 'Parking', amountCents: 1_250 },
        { position: 2, date: '', description: 'Meals', amountCents: 2_000 },
      ],
    };
    const blockers = expenseFinalizeBlockers(rangeDraft);

    expect(expenseRowWarnings(blockers, 0)).toEqual([
      'Date is outside the reporting period',
      'Enter a description',
      'Enter an amount greater than $0.00',
    ]);
    expect(expenseRowWarnings(blockers, 1)).toEqual([
      'Date is outside the reporting period',
    ]);
    expect(expenseRowWarnings(blockers, 2)).toEqual(['Choose a date']);
    expect(expenseBlockingRowCount(blockers)).toBe(3);
  });

  test('shows a blank description warning on its affected row', () => {
    const descriptionDraft: ExpenseDraft = {
      seq: 4, year: 2026, reportDate: '2026-07-15',
      periodStart: '2026-07-01', periodEnd: '2026-07-15',
      items: [
        { position: 0, date: '2026-07-10', description: 'Fuel', amountCents: 5_000 },
        { position: 1, date: '2026-07-15', description: '', amountCents: 250 },
      ],
    };
    const blockers = expenseFinalizeBlockers(descriptionDraft);

    expect(expenseRowWarnings(blockers, 0)).toEqual([]);
    expect(expenseRowWarnings(blockers, 1)).toEqual(['Enter a description']);
    expect(expenseBlockingRowCount(blockers)).toBe(1);
  });

  test('points to the first header or row field that blocks finalization', () => {
    const draft: ExpenseDraft = {
      seq: 4, year: 2026, reportDate: '', periodStart: '', periodEnd: '',
      items: [{ position: 0, date: '', description: '', amountCents: 0 }],
    };
    expect(firstExpenseBlockerTarget(draft)).toEqual({
      id: 'expense-report-date', message: 'Choose a report date.',
    });
    expect(firstExpenseBlockerTarget({
      ...draft, reportDate: '2026-07-15', periodStart: '2026-07-01', periodEnd: '2026-07-15',
    })).toEqual({ id: 'expense-row-0-date', message: 'Choose a date for expense 1.' });
  });
});
