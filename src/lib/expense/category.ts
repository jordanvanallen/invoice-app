import type { Cents } from '../types';
import type { ExpenseCategory } from './types';

/** Section order everywhere: editor, canonical row order, view, and PDF. */
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = Object.freeze(['vehicle', 'general']);

export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = Object.freeze({
  vehicle: 'Vehicle expenses',
  general: 'General/Admin expenses',
});

/** Singular row noun used in validation messages and accessible row labels. */
export const EXPENSE_CATEGORY_ROW_NOUNS: Readonly<Record<ExpenseCategory, string>> = Object.freeze({
  vehicle: 'Vehicle expense',
  general: 'General/Admin expense',
});

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return value === 'vehicle' || value === 'general';
}

export interface ExpenseSubtotals {
  vehicleSubtotalCents: Cents;
  generalSubtotalCents: Cents;
  totalCents: Cents;
}

/**
 * Integer-cent subtotals per section and their grand total. Throws on a row
 * without a known section so money can never silently fall out of both totals.
 */
export function expenseSubtotals(
  items: readonly { category: unknown; amountCents: Cents }[],
): ExpenseSubtotals {
  const subtotals: Record<ExpenseCategory, Cents> = { vehicle: 0, general: 0 };
  items.forEach((item, index) => {
    if (!isExpenseCategory(item.category)) {
      throw new Error(`Expense row ${index + 1} is not in the Vehicle or General/Admin section.`);
    }
    subtotals[item.category] += item.amountCents;
  });
  return {
    vehicleSubtotalCents: subtotals.vehicle,
    generalSubtotalCents: subtotals.general,
    totalCents: subtotals.vehicle + subtotals.general,
  };
}

/** One section's subtotal from live subtotals or a sectioned snapshot (same field names). */
export function expenseSubtotalFor(
  subtotals: Pick<ExpenseSubtotals, 'vehicleSubtotalCents' | 'generalSubtotalCents'>,
  category: ExpenseCategory,
): Cents {
  return category === 'vehicle' ? subtotals.vehicleSubtotalCents : subtotals.generalSubtotalCents;
}
