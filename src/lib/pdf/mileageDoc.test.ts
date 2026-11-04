import { describe, expect, test } from 'vitest';
import { buildMileageDoc } from './mileageDoc';
import type { MileageSnapshot, MileageSnapshotTrip } from '../mileage/types';

export const mileageTrip = (over: Partial<MileageSnapshotTrip> = {}): MileageSnapshotTrip => ({
  position: 0,
  date: '2026-07-02',
  from: 'Home office',
  to: 'Maplewood lot',
  purpose: 'Lease return inspections',
  startOdometerKm: 0,
  endOdometerKm: 25,
  distanceKm: 25,
  ...over,
});

export const mileageSnapshot = (over: Partial<MileageSnapshot> = {}): MileageSnapshot => ({
  reportNumber: '3-2026',
  seq: 3,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  vehicle: '2019 Ford F-150 · ABC 123',
  inspectorName: 'North Star Inspections',
  inspectorAddress: '1 Main Street',
  inspectorNumber: 'ON-7',
  logoDataUrl: '',
  trips: [
    mileageTrip(),
    mileageTrip({
      position: 1, date: '2026-07-10', from: 'Maplewood lot', to: 'Pioneer Motors',
      purpose: 'No-show follow-up', startOdometerKm: 48_200, endOdometerKm: 49_442, distanceKm: 1_242,
    }),
  ],
  totalKm: 1_267,
  ...over,
});

describe('buildMileageDoc', () => {
  test('includes frozen identity, vehicle, report details, every trip column, and the total', () => {
    const serialized = JSON.stringify(buildMileageDoc(mileageSnapshot()));

    for (const text of [
      'CAR MILEAGE REPORT', '#3-2026', 'Report date 2026-07-15', 'Period 2026-07-01 - 2026-07-15',
      'North Star Inspections', '1 Main Street', 'Inspector # ON-7',
      'VEHICLE', '2019 Ford F-150 · ABC 123', '2 trips',
      'Start (km)', 'End (km)', 'Distance', 'Pioneer Motors', 'No-show follow-up',
      '48,200', '49,442', '1,242 km', '25 km', 'TOTAL DISTANCE', '1,267 km',
    ]) {
      expect(serialized, text).toContain(text);
    }
    expect(serialized.indexOf('Lease return inspections')).toBeLessThan(serialized.indexOf('No-show follow-up'));
    expect(serialized).not.toContain('$');
  });

  test('prints a zero start reading as 0 rather than blank', () => {
    const doc = buildMileageDoc(mileageSnapshot()) as {
      content: Array<{ table?: { body: Array<Array<{ text: string }>> } }>;
    };
    const table = doc.content.find((block) => block.table)?.table;
    expect(table?.body[1].map((cell) => cell.text)).toEqual([
      '2026-07-02', 'Home office', 'Maplewood lot', 'Lease return inspections', '0', '25', '25 km',
    ]);
    expect(table?.body).toHaveLength(3);
  });

  test('labels every page footer with the report number and vehicle', () => {
    const doc = buildMileageDoc(mileageSnapshot({ trips: [mileageTrip()], totalKm: 25 })) as {
      footer: (page: number, count: number) => unknown;
    };
    const footer = JSON.stringify(doc.footer(2, 3));
    expect(footer).toContain('Mileage report #3-2026 · 2019 Ford F-150 · ABC 123');
    expect(footer).toContain('Page 2 of 3');
    expect(JSON.stringify(buildMileageDoc(mileageSnapshot({ trips: [mileageTrip()] })))).toContain('1 trip');
  });

  test('embeds the frozen logo only when one exists', () => {
    const logo = 'data:image/png;base64,mileage-logo';
    expect(JSON.stringify(buildMileageDoc(mileageSnapshot({ logoDataUrl: logo })))).toContain(logo);
    expect(JSON.stringify(buildMileageDoc(mileageSnapshot()))).not.toContain('"image"');
  });
});
