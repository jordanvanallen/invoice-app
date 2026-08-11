import { describe, expect, test } from 'vitest';
import { orderInvoiceLines, sortInvoiceSections, sortRowsByDate } from './lineOrder';
import type { LineItem, LineType } from './types';

function line(
  inspectionNumber: string,
  date: string,
  type: LineType = 'completed',
  position = 0,
): LineItem {
  return {
    type,
    position,
    inspectionNumber,
    clientId: null,
    clientName: 'Test Client',
    locationId: null,
    location: 'Test Location',
    date,
    vin8: '12345678',
    mileageCents: 0,
    mileageApproverId: null,
    mileageApproverName: '',
    mileageApprovalDate: '',
    feeCents: 3800,
  };
}

describe('sortRowsByDate', () => {
  test('sorts by date then natural inspection number and puts blanks last', () => {
    const rows = [
      line('INSP-10', '2026-07-12'),
      line('blank-2', ''),
      line('newest', '2026-07-14'),
      line('INSP-2', '2026-07-12'),
      line('', '2026-07-12'),
      line('oldest', '2026-07-10'),
      line('blank-1', ''),
    ];

    const sorted = sortRowsByDate(rows);

    expect(sorted.map((row) => row.inspectionNumber)).toEqual([
      'oldest', 'INSP-2', 'INSP-10', '', 'newest', 'blank-1', 'blank-2',
    ]);
    expect(rows.map((row) => row.inspectionNumber)).toEqual([
      'INSP-10', 'blank-2', 'newest', 'INSP-2', '', 'oldest', 'blank-1',
    ]);
    expect(sorted).not.toBe(rows);
  });

  test('keeps rows stable when both date and inspection number match', () => {
    const first = line('SAME', '2026-07-12', 'completed', 1);
    const second = line('same', '2026-07-12', 'completed', 2);

    expect(sortRowsByDate([first, second])).toEqual([first, second]);
  });

  test('sorts chronologically across month and year boundaries', () => {
    const rows = [
      line('october', '2026-10-01'),
      line('new-year', '2026-01-01'),
      line('previous-year', '2025-12-31'),
      line('february', '2026-02-01'),
    ];

    const sorted = sortRowsByDate(rows);

    expect(sorted.map((row) => row.inspectionNumber)).toEqual([
      'previous-year', 'new-year', 'february', 'october',
    ]);
  });
});

describe('orderInvoiceLines', () => {
  test('orders completed and no-show sections independently and rewrites positions', () => {
    const lines = [
      line('completed-10', '2026-07-14', 'completed', 8),
      line('noshow-new', '2026-07-13', 'noshow', 3),
      line('completed-old', '2026-07-10', 'completed', 6),
      line('noshow-old', '2026-07-09', 'noshow', 2),
      line('completed-2', '2026-07-14', 'completed', 9),
    ];

    const ordered = orderInvoiceLines(lines);

    expect(ordered.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-2', 'completed-10', 'noshow-old', 'noshow-new',
    ]);
    expect(ordered.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
    expect(lines.map((row) => row.position)).toEqual([8, 3, 6, 2, 9]);
    expect(ordered[0]).not.toBe(lines[2]);
  });
});

describe('sortInvoiceSections', () => {
  test('sorts completed and no-show rows independently without mutating either list', () => {
    const completed = [
      line('completed-10', '2026-07-14'),
      line('completed-old', '2026-07-10'),
      line('completed-2', '2026-07-14'),
    ];
    const noshow = [
      line('noshow-new', '2026-07-13', 'noshow'),
      line('noshow-old', '2026-07-09', 'noshow'),
    ];

    const sorted = sortInvoiceSections(completed, noshow);

    expect(sorted.completed.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-2', 'completed-10',
    ]);
    expect(sorted.noshow.map((row) => row.inspectionNumber)).toEqual([
      'noshow-old', 'noshow-new',
    ]);
    expect(completed.map((row) => row.inspectionNumber)).toEqual([
      'completed-10', 'completed-old', 'completed-2',
    ]);
    expect(noshow.map((row) => row.inspectionNumber)).toEqual([
      'noshow-new', 'noshow-old',
    ]);
  });
});
