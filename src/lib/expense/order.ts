import type { ExpenseItem } from './types';

/** Return a stable chronological copy without mutating the input. */
export function sortExpenseItems<T extends { date: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aBlank = a.item.date === '';
      const bBlank = b.item.date === '';
      if (aBlank !== bBlank) return aBlank ? 1 : -1;
      const byDate = a.item.date.localeCompare(b.item.date);
      return byDate || a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Canonical persisted order with fresh row objects and sequential positions. */
export function orderExpenseItems(items: readonly ExpenseItem[]): ExpenseItem[] {
  return sortExpenseItems(items).map((item, position) => ({ ...item, position }));
}
