import { describe, expect, test } from 'vitest';
import {
  MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE,
  mileageFinalizeBlockers,
  mileageTotalKm,
  tripDistanceKm,
} from './validation';
import type { MileageDraft, MileageTrip } from './types';

const trip = (over: Partial<MileageTrip> = {}): MileageTrip => ({
  position: 0,
  date: '2026-07-02',
  from: 'Home office',
  to: 'Maplewood lot',
  purpose: 'Lease return inspections',
  startOdometerKm: 48_200,
  endOdometerKm: 48_250,
  ...over,
});

const draft = (over: Partial<MileageDraft> = {}): MileageDraft => ({
  seq: null,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  vehicle: '2019 Ford F-150 · ABC 123',
  trips: [trip()],
  ...over,
});

describe('trip distance and total', () => {
  test('computes whole-kilometre distances only for strictly increasing readings', () => {
    expect(tripDistanceKm({ startOdometerKm: 0, endOdometerKm: 1 })).toBe(1);
    expect(tripDistanceKm({ startOdometerKm: 48_200, endOdometerKm: 48_250 })).toBe(50);
    expect(tripDistanceKm({ startOdometerKm: 100, endOdometerKm: 100 })).toBeNull();
    expect(tripDistanceKm({ startOdometerKm: 100, endOdometerKm: 99 })).toBeNull();
    expect(tripDistanceKm({ startOdometerKm: null, endOdometerKm: 99 })).toBeNull();
    expect(tripDistanceKm({ startOdometerKm: 1.5, endOdometerKm: 99 })).toBeNull();
  });

  test('sums measured trips, skips incomplete ones, and refuses an unsafe sum', () => {
    expect(mileageTotalKm([])).toBe(0);
    expect(mileageTotalKm([
      { startOdometerKm: 0, endOdometerKm: 10 },
      { startOdometerKm: null, endOdometerKm: 50 },
      { startOdometerKm: 10, endOdometerKm: 35 },
    ])).toBe(35);
    expect(mileageTotalKm([
      { startOdometerKm: 0, endOdometerKm: Number.MAX_SAFE_INTEGER },
      { startOdometerKm: 0, endOdometerKm: 1 },
    ])).toBeNull();
  });
});

describe('mileageFinalizeBlockers', () => {
  test('accepts a complete report, including a real zero start reading', () => {
    expect(mileageFinalizeBlockers(draft())).toEqual([]);
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ startOdometerKm: 0, endOdometerKm: 12 })],
    }))).toEqual([]);
  });

  test('treats blank readings as missing but reports them separately from invalid stored values', () => {
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ startOdometerKm: null, endOdometerKm: 12.5 })],
    }))).toEqual([
      { field: 'startOdometerKm', tripIndex: 0, message: 'Enter the start odometer for trip 1.' },
      {
        field: 'endOdometerKm', tripIndex: 0,
        message: 'Enter the end odometer for trip 1 in whole kilometres.',
      },
    ]);
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ startOdometerKm: -1, endOdometerKm: Number.MAX_SAFE_INTEGER + 1 })],
    })).map((blocker) => blocker.message)).toEqual([
      'Enter the start odometer for trip 1 in whole kilometres.',
      'Enter the end odometer for trip 1 in whole kilometres.',
    ]);
  });

  test('requires the end reading to be strictly greater than the start', () => {
    const message = 'The end odometer for trip 1 must be greater than its start.';
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ startOdometerKm: 500, endOdometerKm: 500 })],
    }))).toEqual([{ field: 'endOdometerKm', tripIndex: 0, message }]);
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ startOdometerKm: 500, endOdometerKm: 400 })],
    }))).toEqual([{ field: 'endOdometerKm', tripIndex: 0, message }]);
  });

  test('blocks a total that cannot be represented exactly', () => {
    expect(mileageFinalizeBlockers(draft({
      trips: [
        trip({ startOdometerKm: 0, endOdometerKm: Number.MAX_SAFE_INTEGER }),
        trip({ position: 1, startOdometerKm: 0, endOdometerKm: 1 }),
      ],
    }))).toEqual([{
      field: 'totalKm', tripIndex: null,
      message: 'The total distance is too large to record. Check the odometer readings.',
    }]);
  });

  test('requires vehicle, from, to, and purpose text that is not just whitespace', () => {
    expect(mileageFinalizeBlockers(draft({
      vehicle: '   ',
      trips: [trip({ from: '', to: ' ', purpose: '\t' })],
    }))).toEqual([
      { field: 'vehicle', tripIndex: null, message: 'Enter the vehicle.' },
      { field: 'from', tripIndex: 0, message: 'Enter where trip 1 started.' },
      { field: 'to', tripIndex: 0, message: 'Enter where trip 1 ended.' },
      { field: 'purpose', tripIndex: 0, message: 'Enter the purpose of trip 1.' },
    ]);
  });

  test('accepts trips on both inclusive period boundaries and blocks one day outside', () => {
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ date: '2026-07-01' }), trip({ position: 1, date: '2026-07-15' })],
    }))).toEqual([]);
    expect(mileageFinalizeBlockers(draft({
      trips: [trip({ date: '2026-06-30' }), trip({ position: 1, date: '2026-07-16' })],
    }))).toEqual([
      { field: 'date', tripIndex: 0, message: MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE },
      { field: 'date', tripIndex: 1, message: MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE },
    ]);
  });

  test('validates header and trip dates as real calendar dates', () => {
    expect(mileageFinalizeBlockers(draft({
      reportDate: '2026-02-30',
      periodStart: '2026-7-01',
      periodEnd: 'not-a-date',
      trips: [trip({ date: '2026-13-01' })],
    }))).toEqual([
      { field: 'reportDate', tripIndex: null, message: 'Choose a valid report date.' },
      { field: 'periodStart', tripIndex: null, message: 'Choose a valid reporting period start date.' },
      { field: 'periodEnd', tripIndex: null, message: 'Choose a valid reporting period end date.' },
      { field: 'date', tripIndex: 0, message: 'Choose a valid date for trip 1.' },
    ]);
    expect(mileageFinalizeBlockers(draft({ reportDate: '', trips: [trip({ date: '  ' })] }))).toEqual([
      { field: 'reportDate', tripIndex: null, message: 'Choose a report date.' },
      { field: 'date', tripIndex: 0, message: 'Choose a date for trip 1.' },
    ]);
  });

  test('requires an ordered period and defers range checks until the period is usable', () => {
    expect(mileageFinalizeBlockers(draft({
      periodStart: '2026-08-01',
      periodEnd: '2026-07-01',
      trips: [trip({ date: '2026-06-01' })],
    }))).toEqual([{
      field: 'periodEnd', tripIndex: null,
      message: 'The reporting period end must be on or after its start.',
    }]);
    expect(mileageFinalizeBlockers(draft({ periodEnd: '', trips: [trip({ date: '2026-06-01' })] })))
      .toEqual([{ field: 'periodEnd', tripIndex: null, message: 'Choose a reporting period end date.' }]);
  });

  test('requires at least one trip and reports rows in display order', () => {
    expect(mileageFinalizeBlockers(draft({ trips: [] }))).toEqual([
      { field: 'trips', tripIndex: null, message: 'Add at least one trip.' },
    ]);
    expect(mileageFinalizeBlockers(draft({
      trips: [trip(), trip({ position: 1, purpose: '', startOdometerKm: null })],
    }))).toEqual([
      { field: 'purpose', tripIndex: 1, message: 'Enter the purpose of trip 2.' },
      { field: 'startOdometerKm', tripIndex: 1, message: 'Enter the start odometer for trip 2.' },
    ]);
  });
});
