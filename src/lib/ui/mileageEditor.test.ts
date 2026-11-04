import { describe, expect, test } from 'vitest';
import {
  MILEAGE_PREVIEW_HINT,
  blankMileageRow,
  canPreviewMileage,
  firstMileageBlockerTarget,
  mileageBlockingRowCount,
  mileageEditorBlockers,
  mileageRowDistanceKm,
  mileageRowWarnings,
  mileageRowsToTrips,
  normalizeOdometerText,
  prepareMileagePreview,
  sortMileageEditorRows,
  toMileageEditorRow,
  type MileageEditorRow,
} from './mileageEditor';
import { groupMileageHistory, sumMileageHistory } from './mileageHistory';
import type { MileageDraft } from '../mileage/types';
import type { Settings } from '../types';

const settings: Settings = {
  inspectorName: 'North Star', inspectorAddress: '1 Main', inspectorNumber: 'ON-7',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: '',
};

const row = (over: Partial<MileageEditorRow> = {}): MileageEditorRow => ({
  ...blankMileageRow('2026-07-02'),
  from: 'Home', to: 'Lot', purpose: 'Inspections', startText: '48,200', endText: '48,250',
  ...over,
});

const draftFor = (rows: MileageEditorRow[]): MileageDraft => ({
  seq: null, year: 2026, reportDate: '2026-07-15',
  periodStart: '2026-07-01', periodEnd: '2026-07-15', vehicle: 'Ford F-150',
  trips: mileageRowsToTrips(rows),
});

describe('mileage editor rows', () => {
  test('gives every row a unique persistent string key', () => {
    const rows = [blankMileageRow(''), blankMileageRow(''), toMileageEditorRow(mileageRowsToTrips([row()])[0])];
    expect(new Set(rows.map((entry) => entry.uid)).size).toBe(3);
    expect(rows.every((entry) => typeof entry.uid === 'string' && entry.uid.startsWith('mileage-trip-'))).toBe(true);
  });

  test('persists blank and malformed text as null but keeps a typed zero as 0', () => {
    expect(mileageRowsToTrips([
      row({ startText: '', endText: '0' }),
      row({ startText: '12.5', endText: '-3' }),
      row({ startText: '0', endText: '1,250' }),
    ]).map((trip) => [trip.position, trip.startOdometerKm, trip.endOdometerKm])).toEqual([
      [0, null, 0],
      [1, null, null],
      [2, 0, 1_250],
    ]);
  });

  test('round-trips stored readings, including zero, back into editable text', () => {
    const [trip] = mileageRowsToTrips([row({ startText: '0', endText: '48250' })]);
    expect(toMileageEditorRow(trip)).toMatchObject({ startText: '0', endText: '48,250' });
    expect(toMileageEditorRow({ ...trip, startOdometerKm: null })).toMatchObject({ startText: '' });
  });

  test('computes a row distance only for valid increasing readings', () => {
    expect(mileageRowDistanceKm(row())).toBe(50);
    expect(mileageRowDistanceKm(row({ startText: '0', endText: '7' }))).toBe(7);
    expect(mileageRowDistanceKm(row({ endText: '48,200' }))).toBeNull();
    expect(mileageRowDistanceKm(row({ endText: '48250.4' }))).toBeNull();
  });

  test('reformats only valid readings on blur', () => {
    expect(normalizeOdometerText(' 48250 ')).toBe('48,250');
    expect(normalizeOdometerText('000')).toBe('0');
    expect(normalizeOdometerText('48250.4')).toBe('48250.4');
    expect(normalizeOdometerText('')).toBe('');
  });

  test('sorts visible rows into the same order Preview uses', () => {
    const rows = [
      row({ date: '2026-07-09', purpose: 'late', startText: '900', endText: '950' }),
      row({ date: '', purpose: 'undated' }),
      row({ date: '2026-07-09', purpose: 'early', startText: '700', endText: '760' }),
      row({ date: '2026-07-03', purpose: 'first', startText: '500', endText: '512' }),
    ];
    const sorted = sortMileageEditorRows(rows);
    const preview = prepareMileagePreview(draftFor(rows.filter((entry) => entry.date)), settings, 3);

    expect(sorted.map((entry) => entry.purpose)).toEqual(['first', 'early', 'late', 'undated']);
    expect(sorted[0]).toBe(rows[3]);
    expect(preview.trips.map((trip) => trip.purpose)).toEqual(['first', 'early', 'late']);
    expect(preview.totalKm).toBe(12 + 60 + 50);
    expect(rows.map((entry) => entry.purpose)).toEqual(['late', 'undated', 'early', 'first']);
  });
});

describe('mileage editor blockers', () => {
  test('explains malformed odometer text precisely instead of calling it missing', () => {
    const rows = [row({ startText: '12.5', endText: 'abc' })];
    const blockers = mileageEditorBlockers(draftFor(rows), rows);

    expect(blockers.map((blocker) => [blocker.message, blocker.rowMessage])).toEqual([
      ['Trip 1 start odometer: whole kilometres only, no decimals.', 'Start odometer: whole kilometres only, no decimals'],
      ['Trip 1 end odometer: digits only, like 48,250.', 'End odometer: digits only, like 48,250'],
    ]);
  });

  test('uses concise row warnings for blank, inverted, and out-of-period trips', () => {
    const rows = [
      row(),
      row({ date: '2026-06-30', from: ' ', startText: '', endText: '10' }),
      row({ to: '', purpose: '', startText: '500', endText: '500' }),
      row({ date: '2026-02-30' }),
    ];
    const blockers = mileageEditorBlockers(draftFor(rows), rows);

    expect(mileageRowWarnings(blockers, 0)).toEqual([]);
    expect(mileageRowWarnings(blockers, 1)).toEqual([
      'Date is outside the reporting period',
      'Enter where the trip started',
      'Enter the start odometer',
    ]);
    expect(mileageRowWarnings(blockers, 2)).toEqual([
      'Enter where the trip ended',
      'Enter the trip purpose',
      'End odometer must be greater than the start',
    ]);
    expect(mileageRowWarnings(blockers, 3)).toEqual(['Choose a valid date']);
    expect(mileageBlockingRowCount(blockers)).toBe(3);
    expect(firstMileageBlockerTarget(blockers)).toEqual({
      id: 'mileage-trip-1-date', message: 'Date is outside the reporting period',
    });
  });

  test('targets header fields first and allows Preview only when every distance is measurable', () => {
    const rows = [row({ purpose: '' })];
    const headerBlockers = mileageEditorBlockers({ ...draftFor(rows), vehicle: '' }, rows);
    expect(firstMileageBlockerTarget(headerBlockers)).toEqual({ id: 'mileage-vehicle', message: 'Enter the vehicle.' });
    expect(canPreviewMileage(headerBlockers)).toBe(true);

    const missingReading = [row({ endText: '' })];
    expect(canPreviewMileage(mileageEditorBlockers(draftFor(missingReading), missingReading))).toBe(false);
    expect(canPreviewMileage(mileageEditorBlockers(draftFor([]), []))).toBe(false);
    expect(firstMileageBlockerTarget(mileageEditorBlockers(draftFor([]), [])))
      .toEqual({ id: 'mileage-add-trip', message: 'Add at least one trip.' });
    expect(firstMileageBlockerTarget([])).toBeNull();
    expect(MILEAGE_PREVIEW_HINT).toMatch(/odometer/);
  });
});

describe('mileage history rollups', () => {
  test('groups by report-date year and totals whole kilometres', () => {
    const groups = groupMileageHistory([
      { id: 1, reportNumber: '1-2026', reportDate: '2026-07-15', vehicle: 'A', totalKm: 120, status: 'finalized' },
      { id: 2, reportNumber: '2-2026', reportDate: '2026-08-15', vehicle: 'A', totalKm: 30, status: 'finalized' },
      { id: 3, reportNumber: '1-2025', reportDate: '2025-12-31', vehicle: 'B', totalKm: 7, status: 'finalized' },
    ]);
    expect(groups.map((group) => [group.year, group.reports.map((report) => report.id), group.rollup]))
      .toEqual([
        [2026, [1, 2], { count: 2, totalKm: 150 }],
        [2025, [3], { count: 1, totalKm: 7 }],
      ]);
    expect(sumMileageHistory([])).toEqual({ count: 0, totalKm: 0 });
  });
});
