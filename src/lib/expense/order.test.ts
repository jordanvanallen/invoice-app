import { describe, expect, test } from 'vitest';
import { orderExpenseItems, sortExpenseItems } from './order';
import type { ExpenseItem } from './types';

function item(description: string, date: string, position = 0): ExpenseItem {
  return { position, date, description, amountCents: 100 };
}

describe('expense item ordering', () => {
  test('sorts by date then natural description and puts blanks last', () => {
    const rows = [
      item('new', '2026-02-01'),
      item('Fuel 10', '2026-01-01'),
      item('blank', ''),
      item('Fuel 2', '2026-01-01'),
      item('', '2026-01-01'),
      item('previous year', '2025-12-31'),
    ];

    expect(sortExpenseItems(rows).map((row) => row.description)).toEqual([
      'previous year',
      'Fuel 2',
      'Fuel 10',
      '',
      'new',
      'blank',
    ]);
    expect(rows.map((row) => row.description)).toEqual([
      'new', 'Fuel 10', 'blank', 'Fuel 2', '', 'previous year',
    ]);
  });

  test('keeps rows stable when both date and description match', () => {
    const first = item('Fuel', '2026-01-01', 1);
    const second = item('fuel', '2026-01-01', 2);

    expect(sortExpenseItems([first, second])).toEqual([first, second]);
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
