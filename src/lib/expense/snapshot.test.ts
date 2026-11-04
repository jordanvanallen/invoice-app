import { describe, expect, test } from 'vitest';
import {
  buildExpenseSnapshot,
  expenseSnapshotSection,
  isSectionedExpenseSnapshot,
  parseExpenseSnapshot,
} from './snapshot';
import type { ExpenseCategory, ExpenseDraft, LegacyExpenseSnapshot } from './types';
import type { Settings } from '../types';

const settings = (): Settings => ({
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
});

const draft = (items: ExpenseDraft['items']): ExpenseDraft => ({
  seq: 7,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  items,
});

/** Exactly what pre-section app versions stored in expense_reports.snapshot_json. */
const legacySnapshot: LegacyExpenseSnapshot = {
  reportNumber: '3-2026',
  seq: 3,
  year: 2026,
  reportDate: '2026-06-30',
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  inspectorName: 'North Star Inspections',
  inspectorAddress: '1 Main Street',
  inspectorNumber: 'ON-123',
  logoDataUrl: '',
  items: [
    { position: 0, date: '2026-06-02', description: 'Fuel', amountCents: 5_000 },
    { position: 1, date: '2026-06-10', description: 'Printer ink', amountCents: 1_250 },
  ],
  totalCents: 6_250,
};

describe('buildExpenseSnapshot', () => {
  test('freezes identity, sectioned canonical rows, and stored subtotals', () => {
    const source = draft([
      { position: 0, category: 'general', date: '2026-07-10', description: 'Postage', amountCents: 1_250 },
      { position: 1, category: 'vehicle', date: '2026-07-12', description: 'Parking', amountCents: 800 },
      { position: 2, category: 'vehicle', date: '2026-07-02', description: 'Fuel 10', amountCents: 5_000 },
      { position: 3, category: 'vehicle', date: '2026-07-02', description: 'Fuel 2', amountCents: 2_000 },
    ]);
    const liveSettings = settings();

    const snapshot = buildExpenseSnapshot(source, liveSettings, 7);

    expect(snapshot).toEqual({
      snapshotVersion: 2,
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
        { position: 0, category: 'vehicle', date: '2026-07-02', description: 'Fuel 2', amountCents: 2_000 },
        { position: 1, category: 'vehicle', date: '2026-07-02', description: 'Fuel 10', amountCents: 5_000 },
        { position: 2, category: 'vehicle', date: '2026-07-12', description: 'Parking', amountCents: 800 },
        { position: 3, category: 'general', date: '2026-07-10', description: 'Postage', amountCents: 1_250 },
      ],
      vehicleSubtotalCents: 7_800,
      generalSubtotalCents: 1_250,
      totalCents: 9_050,
    });
    expect(isSectionedExpenseSnapshot(snapshot)).toBe(true);
    expect(snapshot.items[0]).not.toBe(source.items[3]);

    source.items[2].description = 'Changed later';
    source.items[2].category = 'general';
    source.items.push({ position: 4, category: 'vehicle', date: '2026-07-03', description: 'Late', amountCents: 1 });
    liveSettings.inspectorName = 'Changed later';
    expect(snapshot.items.map((row) => `${row.category}:${row.description}`)).toEqual([
      'vehicle:Fuel 2', 'vehicle:Fuel 10', 'vehicle:Parking', 'general:Postage',
    ]);
    expect(snapshot.inspectorName).toBe('North Star Inspections');
    expect(snapshot.totalCents).toBe(9_050);
  });

  test.each<[string, ExpenseCategory[], [number, number]]>([
    ['only vehicle', ['vehicle', 'vehicle'], [3_000, 0]],
    ['only general', ['general'], [0, 1_000]],
    ['both empty', [], [0, 0]],
  ])('keeps an empty section at zero (%s)', (_name, categories, [vehicle, general]) => {
    const snapshot = buildExpenseSnapshot(draft(categories.map((category, position) => ({
      position, category, date: '2026-07-02', description: category, amountCents: category === 'vehicle' ? 1_500 : 1_000,
    }))), settings(), 7);

    expect(snapshot.vehicleSubtotalCents).toBe(vehicle);
    expect(snapshot.generalSubtotalCents).toBe(general);
    expect(snapshot.totalCents).toBe(vehicle + general);
    expect(expenseSnapshotSection(snapshot, 'vehicle').items).toHaveLength(
      categories.filter((category) => category === 'vehicle').length,
    );
  });

  test('refuses to freeze a row that is in neither section', () => {
    expect(() => buildExpenseSnapshot(draft([
      { position: 0, category: 'fuel' as ExpenseCategory, date: '2026-07-02', description: 'Fuel', amountCents: 100 },
    ]), settings(), 7)).toThrow(/Vehicle or General\/Admin/);
  });
});

describe('stored expense snapshots', () => {
  test('passes a legacy snapshot through untouched, so it stays a flat report', () => {
    const parsed = parseExpenseSnapshot(JSON.stringify(legacySnapshot));

    expect(parsed).toEqual(legacySnapshot);
    expect(isSectionedExpenseSnapshot(parsed)).toBe(false);
    expect(parsed).not.toHaveProperty('snapshotVersion');
    expect(parsed).not.toHaveProperty('vehicleSubtotalCents');
    expect(parsed.items.every((row) => !('category' in row))).toBe(true);
  });

  test('round-trips a sectioned snapshot and exposes each section with its stored subtotal', () => {
    const snapshot = buildExpenseSnapshot(draft([
      { position: 0, category: 'general', date: '2026-07-10', description: 'Postage', amountCents: 1_250 },
      { position: 1, category: 'vehicle', date: '2026-07-02', description: 'Fuel', amountCents: 5_000 },
    ]), settings(), 7);

    const parsed = parseExpenseSnapshot(JSON.stringify(snapshot));

    expect(parsed).toEqual(snapshot);
    if (!isSectionedExpenseSnapshot(parsed)) throw new Error('expected a sectioned snapshot');
    expect(expenseSnapshotSection(parsed, 'vehicle')).toEqual({
      items: [snapshot.items[0]], subtotalCents: 5_000,
    });
    expect(expenseSnapshotSection(parsed, 'general')).toEqual({
      items: [snapshot.items[1]], subtotalCents: 1_250,
    });
  });

  test('refuses snapshots it cannot print faithfully', () => {
    const good = buildExpenseSnapshot(draft([
      { position: 0, category: 'vehicle', date: '2026-07-02', description: 'Fuel', amountCents: 5_000 },
      { position: 1, category: 'general', date: '2026-07-03', description: 'Ink', amountCents: 700 },
    ]), settings(), 7);
    const damaged = /saved copy is damaged/;

    expect(() => parseExpenseSnapshot(JSON.stringify({ ...good, snapshotVersion: 3 })))
      .toThrow(/newer version of the app/);
    expect(() => parseExpenseSnapshot(JSON.stringify({
      ...good, items: [{ ...good.items[0], category: 'fuel' }, good.items[1]],
    }))).toThrow(damaged);
    expect(() => parseExpenseSnapshot(JSON.stringify({ ...good, vehicleSubtotalCents: 4_999 })))
      .toThrow(damaged);
    expect(() => parseExpenseSnapshot(JSON.stringify({ ...good, totalCents: 5_000 })))
      .toThrow(damaged);
    expect(() => parseExpenseSnapshot(JSON.stringify({
      ...good, items: [{ ...good.items[0], amountCents: 50.5 }, good.items[1]],
    }))).toThrow(damaged);
    expect(() => parseExpenseSnapshot('null')).toThrow(damaged);
    expect(() => parseExpenseSnapshot('[]')).toThrow(damaged);
  });
});
