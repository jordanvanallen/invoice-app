import { EXPENSE_CATEGORIES } from './category';
import type { ExpenseCategory, ExpenseItem } from './types';

function compareExpenseDates(a: { date: string }, b: { date: string }): number {
  const aBlank = a.date === '';
  const bBlank = b.date === '';
  if (aBlank !== bBlank) return aBlank ? 1 : -1;
  return a.date.localeCompare(b.date);
}

/**
 * Return a stable chronological copy without mutating the input. Section-blind:
 * this is the order inside one section and the order of legacy flat reports.
 */
export function sortExpenseItems<T extends { date: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareExpenseDates(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** Unknown sections rank last so validation can still flag the row instead of losing it. */
function sectionRank(category: unknown): number {
  const rank = EXPENSE_CATEGORIES.indexOf(category as ExpenseCategory);
  return rank === -1 ? EXPENSE_CATEGORIES.length : rank;
}

/**
 * Return a stable copy grouped Vehicle first, then General/Admin, with each
 * section chronological. When every row is 'general' (all rows saved before
 * sections existed) the result is exactly `sortExpenseItems` order.
 */
export function sortExpenseItemsBySection<T extends { date: string; category: ExpenseCategory }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => sectionRank(a.item.category) - sectionRank(b.item.category)
      || compareExpenseDates(a.item, b.item)
      || a.index - b.index)
    .map(({ item }) => item);
}

/** Canonical persisted order with fresh row objects and sequential positions. */
export function orderExpenseItems(items: readonly ExpenseItem[]): ExpenseItem[] {
  return sortExpenseItemsBySection(items).map((item, position) => ({ ...item, position }));
}
