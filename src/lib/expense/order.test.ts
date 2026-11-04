import { describe, expect, test } from 'vitest';
import { orderExpenseItems, sortExpenseItems, sortExpenseItemsBySection } from './order';
import type { ExpenseCategory, ExpenseItem, LegacyExpenseItem } from './types';

/** Pre-section fixture: rows exactly as they existed before categories. */
function legacyItem(description: string, date: string, position = 0): LegacyExpenseItem {
  return { position, date, description, amountCents: 100 };
}

function item(
  description: string,
  date: string,
  category: ExpenseCategory = 'general',
  position = 0,
): ExpenseItem {
  return { position, category, date, description, amountCents: 100 };
}

const legacyRows = () => [
  legacyItem('new', '2026-02-01'),
  legacyItem('same-day first', '2026-01-01'),
  legacyItem('blank', ''),
  legacyItem('same-day second', '2026-01-01'),
  legacyItem('previous year', '2025-12-31'),
];

describe('legacy flat expense ordering (rows without a category)', () => {
  test('sorts oldest to newest, preserves equal dates, and puts blanks last', () => {
    const rows = legacyRows();

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

  test('orders rows defaulted to General/Admin exactly like the pre-section flat sort', () => {
    const migrated = legacyRows().map((row): ExpenseItem => ({ ...row, category: 'general' }));

    expect(orderExpenseItems(migrated).map((row) => row.description))
      .toEqual(sortExpenseItems(legacyRows()).map((row) => row.description));
  });
});

describe('sectioned expense ordering', () => {
  test('groups Vehicle before General/Admin and sorts each section by date', () => {
    const rows = [
      item('office paper', '2026-07-03', 'general'),
      item('fuel late', '2026-07-09', 'vehicle'),
      item('phone', '2026-07-01', 'general'),
      item('vehicle blank', '', 'vehicle'),
      item('fuel early', '2026-07-02', 'vehicle'),
      item('postage same day', '2026-07-03', 'general'),
    ];
    const before = structuredClone(rows);

    expect(sortExpenseItemsBySection(rows).map((row) => `${row.category}:${row.description}`))
      .toEqual([
        'vehicle:fuel early',
        'vehicle:fuel late',
        'vehicle:vehicle blank',
        'general:phone',
        'general:office paper',
        'general:postage same day',
      ]);
    expect(rows).toEqual(before);
  });

  test('normalizes positions on copied rows without mutating input rows', () => {
    const rows = [
      item('later', '2026-03-02', 'general', 8),
      item('earlier', '2026-03-01', 'general', 4),
      item('vehicle', '2026-03-05', 'vehicle', 2),
    ];

    const ordered = orderExpenseItems(rows);

    expect(ordered).toEqual([
      { ...rows[2], position: 0 },
      { ...rows[1], position: 1 },
      { ...rows[0], position: 2 },
    ]);
    expect(ordered[0]).not.toBe(rows[2]);
    expect(rows.map((row) => row.position)).toEqual([8, 4, 2]);
  });

  test('keeps a row with an unknown section last so validation can flag it', () => {
    const rows = [
      item('unknown', '2026-01-01', 'fuel' as ExpenseCategory),
      item('general', '2026-02-01', 'general'),
      item('vehicle', '2026-03-01', 'vehicle'),
    ];

    expect(orderExpenseItems(rows).map((row) => row.description))
      .toEqual(['vehicle', 'general', 'unknown']);
  });
});
