import { describe, expect, test } from 'vitest';
import { orderMileageTrips } from './order';
import { buildMileageSnapshot, deriveMileageYear } from './snapshot';
import type { MileageDraft, MileageTrip } from './types';
import type { Settings } from '../types';

const settings: Settings = {
  inspectorName: 'North Star Inspections', inspectorAddress: '1 Main Street', inspectorNumber: 'ON-7',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: 'data:image/png;base64,logo',
};

const trip = (over: Partial<MileageTrip> = {}): MileageTrip => ({
  position: 0, date: '2026-07-02', from: 'Home', to: 'Lot', purpose: 'Inspections',
  startOdometerKm: 100, endOdometerKm: 150, ...over,
});

const draft = (trips: MileageTrip[]): MileageDraft => ({
  seq: null, year: 2025, reportDate: '2026-07-15',
  periodStart: '2026-07-01', periodEnd: '2026-07-15', vehicle: '  Ford F-150  ', trips,
});

describe('mileage trip ordering', () => {
  test('orders by date, then same-day start odometer, with blanks last and stable ties', () => {
    const ordered = orderMileageTrips([
      trip({ position: 0, date: '', purpose: 'undated' }),
      trip({ position: 1, date: '2026-07-03', startOdometerKm: 900, purpose: 'later same day' }),
      trip({ position: 2, date: '2026-07-03', startOdometerKm: null, purpose: 'no reading' }),
      trip({ position: 3, date: '2026-07-03', startOdometerKm: 500, purpose: 'earlier same day' }),
      trip({ position: 4, date: '2026-07-01', startOdometerKm: 10, purpose: 'first tie' }),
      trip({ position: 5, date: '2026-07-01', startOdometerKm: 10, purpose: 'second tie' }),
    ]);

    expect(ordered.map((row) => row.purpose)).toEqual([
      'first tie', 'second tie', 'earlier same day', 'later same day', 'no reading', 'undated',
    ]);
    expect(ordered.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('returns fresh rows without mutating the editor order', () => {
    const input = [trip({ date: '2026-07-09' }), trip({ position: 1, date: '2026-07-02' })];
    const ordered = orderMileageTrips(input);
    expect(input.map((row) => row.date)).toEqual(['2026-07-09', '2026-07-02']);
    expect(ordered[0]).not.toBe(input[1]);
  });
});

describe('buildMileageSnapshot', () => {
  test('freezes sorted trips, distances, trimmed text, identity, and the report-date year', () => {
    const snapshot = buildMileageSnapshot(draft([
      trip({ date: '2026-07-10', from: ' Depot ', startOdometerKm: 300, endOdometerKm: 342 }),
      trip({ position: 1, date: '2026-07-02', startOdometerKm: 0, endOdometerKm: 25 }),
    ]), settings, 4);

    expect(snapshot).toEqual({
      reportNumber: '4-2026',
      seq: 4,
      year: 2026,
      reportDate: '2026-07-15',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-15',
      vehicle: 'Ford F-150',
      inspectorName: 'North Star Inspections',
      inspectorAddress: '1 Main Street',
      inspectorNumber: 'ON-7',
      logoDataUrl: 'data:image/png;base64,logo',
      trips: [
        {
          position: 0, date: '2026-07-02', from: 'Home', to: 'Lot', purpose: 'Inspections',
          startOdometerKm: 0, endOdometerKm: 25, distanceKm: 25,
        },
        {
          position: 1, date: '2026-07-10', from: 'Depot', to: 'Lot', purpose: 'Inspections',
          startOdometerKm: 300, endOdometerKm: 342, distanceKm: 42,
        },
      ],
      totalKm: 67,
    });
  });

  test('refuses to freeze a trip without a positive measured distance', () => {
    expect(() => buildMileageSnapshot(draft([trip({ endOdometerKm: null })]), settings, 1))
      .toThrow(/start and end odometer/);
    expect(() => buildMileageSnapshot(draft([trip({ startOdometerKm: 5, endOdometerKm: 5 })]), settings, 1))
      .toThrow(/end greater than start/);
  });

  test('derives the numbering year only from a valid report date', () => {
    expect(deriveMileageYear('2027-01-03', 2026)).toBe(2027);
    expect(deriveMileageYear('', 2026)).toBe(2026);
    expect(deriveMileageYear('2027-02-30', 2026)).toBe(2026);
  });
});
