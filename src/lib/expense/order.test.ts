import { describe, expect, test } from 'vitest';
import { orderExpenseItems, sortExpenseItems } from './order';
import type { ExpenseItem } from './types';

function item(description: string, date: string, position = 0): ExpenseItem {
  return { position, date, description, amountCents: 100 };
}

describe('expense item ordering', () => {
  test('sorts oldest to newest, preserves equal dates, and puts blanks last', () => {
    const rows = [
      item('new', '2026-02-01'),
      item('same-day first', '2026-01-01'),
      item('blank', ''),
      item('same-day second', '2026-01-01'),
      item('previous year', '2025-12-31'),
    ];

    expect(sortExpenseItems(rows).map((row) => row.description)).toEqual([
      'previous year',
      'same-day first',
      'same-day second',
      'new',
      'blank',
    ]);
    expect(rows.map((row) => row.description)).toEqual([
      'new', 'same-day first', 'blank', 'same-day second', 'previous year',
    ]);
  });

  test('normalizes positions on copied rows without mutating input rows', () => {
    const rows = [item('later', '2026-03-02', 8), item('earlier', '2026-03-01', 4)];

    const ordered = orderExpenseItems(rows);

    expect(ordered).toEqual([
      { ...rows[1], position: 0 },
      { ...rows[0], position: 1 },
    ]);
    expect(ordered[0]).not.toBe(rows[1]);
    expect(rows.map((row) => row.position)).toEqual([8, 4]);
  });
});
