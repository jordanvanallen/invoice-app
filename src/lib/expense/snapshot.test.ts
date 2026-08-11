import { describe, expect, test } from 'vitest';
import { buildExpenseSnapshot } from './snapshot';
import type { ExpenseDraft } from './types';
import type { Settings } from '../types';

const settings: Settings = {
  inspectorName: 'North Star Inspections',
  inspectorAddress: '1 Main Street',
  inspectorNumber: 'ON-123',
  gstHstRegistrationNumber: 'tax-id',
  billToName: 'unused',
  billToAddress: 'unused',
  registered: true,
  taxRateBp: 1300,
  defaultCompletedFeeCents: 3800,
  defaultNoshowFeeCents: 2500,
  paymentEmail: 'unused@example.com',
  footerNotes: 'unused',
  logoDataUrl: 'data:image/png;base64,abc',
};

describe('buildExpenseSnapshot', () => {
  test('freezes business identity and canonical rows with the exact total', () => {
    const draft: ExpenseDraft = {
      seq: 7,
      year: 2026,
      reportDate: '2026-07-15',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-15',
      items: [
        { position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
        { position: 1, date: '2026-07-02', description: 'Fuel 10', amountCents: 5_000 },
        { position: 2, date: '2026-07-02', description: 'Fuel 2', amountCents: 2_000 },
      ],
    };

    const snapshot = buildExpenseSnapshot(draft, settings, 7);

    expect(snapshot).toEqual({
      reportNumber: '7-2026',
      seq: 7,
      year: 2026,
      reportDate: '2026-07-15',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-15',
      inspectorName: 'North Star Inspections',
      inspectorAddress: '1 Main Street',
      inspectorNumber: 'ON-123',
      logoDataUrl: 'data:image/png;base64,abc',
      items: [
        { position: 0, date: '2026-07-02', description: 'Fuel 2', amountCents: 2_000 },
        { position: 1, date: '2026-07-02', description: 'Fuel 10', amountCents: 5_000 },
        { position: 2, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
      ],
      totalCents: 8_250,
    });
    expect(snapshot.items[0]).not.toBe(draft.items[2]);

    draft.items[2].description = 'Changed later';
    settings.inspectorName = 'Changed later';
    expect(snapshot.items[0].description).toBe('Fuel 2');
    expect(snapshot.inspectorName).toBe('North Star Inspections');
  });
});
