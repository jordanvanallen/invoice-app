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
    feeCents: 3800,
  };
}

describe('sortRowsByDate', () => {
  test('sorts oldest to newest, keeps equal dates stable, and puts blanks last', () => {
    const rows = [
      line('same-1', '2026-07-12'),
      line('blank-1', ''),
      line('newest', '2026-07-14'),
      line('same-2', '2026-07-12'),
      line('oldest', '2026-07-10'),
      line('blank-2', ''),
    ];

    const sorted = sortRowsByDate(rows);

    expect(sorted.map((row) => row.inspectionNumber)).toEqual([
      'oldest', 'same-1', 'same-2', 'newest', 'blank-1', 'blank-2',
    ]);
    expect(rows.map((row) => row.inspectionNumber)).toEqual([
      'same-1', 'blank-1', 'newest', 'same-2', 'oldest', 'blank-2',
    ]);
    expect(sorted).not.toBe(rows);
  });
});

describe('orderInvoiceLines', () => {
  test('orders completed and no-show sections independently and rewrites positions', () => {
    const lines = [
      line('completed-new', '2026-07-14', 'completed', 8),
      line('noshow-new', '2026-07-13', 'noshow', 3),
      line('completed-old', '2026-07-10', 'completed', 6),
      line('noshow-old', '2026-07-09', 'noshow', 2),
    ];

    const ordered = orderInvoiceLines(lines);

    expect(ordered.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(ordered.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(lines.map((row) => row.position)).toEqual([8, 3, 6, 2]);
    expect(ordered[0]).not.toBe(lines[2]);
  });
});

describe('sortInvoiceSections', () => {
  test('sorts completed and no-show rows independently without mutating either list', () => {
    const completed = [
      line('completed-new', '2026-07-14'),
      line('completed-old', '2026-07-10'),
    ];
    const noshow = [
      line('noshow-new', '2026-07-13', 'noshow'),
      line('noshow-old', '2026-07-09', 'noshow'),
    ];

    const sorted = sortInvoiceSections(completed, noshow);

    expect(sorted.completed.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new',
    ]);
    expect(sorted.noshow.map((row) => row.inspectionNumber)).toEqual([
      'noshow-old', 'noshow-new',
    ]);
    expect(completed.map((row) => row.inspectionNumber)).toEqual([
      'completed-new', 'completed-old',
    ]);
    expect(noshow.map((row) => row.inspectionNumber)).toEqual([
      'noshow-new', 'noshow-old',
    ]);
  });
});
