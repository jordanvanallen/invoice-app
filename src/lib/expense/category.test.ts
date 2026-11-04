import { describe, expect, test } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  expenseSubtotalFor,
  expenseSubtotals,
  isExpenseCategory,
} from './category';

describe('expense sections', () => {
  test('lists Vehicle first with the report labels', () => {
    expect(EXPENSE_CATEGORIES).toEqual(['vehicle', 'general']);
    expect(EXPENSE_CATEGORY_LABELS).toEqual({
      vehicle: 'Vehicle expenses',
      general: 'General/Admin expenses',
    });
  });

  test('accepts only the two persisted section values', () => {
    expect(isExpenseCategory('vehicle')).toBe(true);
    expect(isExpenseCategory('general')).toBe(true);
    for (const value of ['Vehicle', 'admin', '', null, undefined, 0]) {
      expect(isExpenseCategory(value)).toBe(false);
    }
  });

  test('sums integer cents per section and in total', () => {
    const subtotals = expenseSubtotals([
      { category: 'vehicle', amountCents: 5_001 },
      { category: 'general', amountCents: 1_999 },
      { category: 'vehicle', amountCents: 99 },
    ]);

    expect(subtotals).toEqual({
      vehicleSubtotalCents: 5_100,
      generalSubtotalCents: 1_999,
      totalCents: 7_099,
    });
    expect(expenseSubtotalFor(subtotals, 'vehicle')).toBe(5_100);
    expect(expenseSubtotalFor(subtotals, 'general')).toBe(1_999);
  });

  test('returns zero subtotals when one or both sections are empty', () => {
    expect(expenseSubtotals([])).toEqual({
      vehicleSubtotalCents: 0, generalSubtotalCents: 0, totalCents: 0,
    });
    expect(expenseSubtotals([{ category: 'general', amountCents: 250 }])).toEqual({
      vehicleSubtotalCents: 0, generalSubtotalCents: 250, totalCents: 250,
    });
  });

  test('refuses a row outside both sections instead of dropping its money', () => {
    expect(() => expenseSubtotals([
      { category: 'vehicle', amountCents: 100 },
      { category: 'fuel', amountCents: 200 },
    ])).toThrow('Expense row 2 is not in the Vehicle or General/Admin section.');
  });
});
