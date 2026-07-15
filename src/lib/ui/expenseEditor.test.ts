import { describe, expect, test } from 'vitest';
import { firstExpenseBlockerTarget, prepareExpensePreview } from './expenseEditor';
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
