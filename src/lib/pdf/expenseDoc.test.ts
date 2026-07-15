import { describe, expect, test } from 'vitest';
import { buildExpenseDoc } from './expenseDoc';
import type { ExpenseSnapshot } from '../expense/types';

const snapshot = (logoDataUrl = ''): ExpenseSnapshot => ({
  reportNumber: '7-2026',
  seq: 7,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  inspectorName: 'North Star Inspections',
  inspectorAddress: '1 Main Street',
  inspectorNumber: 'ON-7',
  logoDataUrl,
  items: [
    { position: 0, date: '2026-07-02', description: 'Fuel', amountCents: 5_000 },
    { position: 1, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
  ],
  totalCents: 6_250,
});

describe('buildExpenseDoc', () => {
  test('includes frozen identity, report details, rows, amounts, and total', () => {
    const serialized = JSON.stringify(buildExpenseDoc(snapshot()));

    expect(serialized).toContain('EXPENSE REPORT');
    expect(serialized).toContain('North Star Inspections');
    expect(serialized).toContain('1 Main Street');
    expect(serialized).toContain('Inspector # ON-7');
    expect(serialized).toContain('#7-2026');
    expect(serialized).toContain('Report date 2026-07-15');
    expect(serialized).toContain('Period 2026-07-01 - 2026-07-15');
    expect(serialized.indexOf('Fuel')).toBeLessThan(serialized.indexOf('Parking'));
    expect(serialized).toContain('$50.00');
    expect(serialized).toContain('$12.50');
    expect(serialized).toContain('$62.50');
  });

  test('embeds the frozen logo only when one exists', () => {
    const logo = 'data:image/png;base64,expense-logo';
    expect(JSON.stringify(buildExpenseDoc(snapshot(logo)))).toContain(logo);
    expect(JSON.stringify(buildExpenseDoc(snapshot()))).not.toContain('"image"');
  });
});
