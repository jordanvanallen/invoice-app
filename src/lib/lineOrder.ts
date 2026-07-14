import type { LineItem, LineType } from './types';

/** Return a chronological copy without disturbing equal-date row order. */
export function sortRowsByDate<T extends { date: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (!a.row.date && !b.row.date) return a.index - b.index;
      if (!a.row.date) return 1;
      if (!b.row.date) return -1;
      return a.row.date.localeCompare(b.row.date) || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Apply the editor's explicit sort action without mixing its two sections. */
export function sortInvoiceSections<T extends { date: string }>(
  completed: readonly T[],
  noshow: readonly T[],
): { completed: T[]; noshow: T[] } {
  return {
    completed: sortRowsByDate(completed),
    noshow: sortRowsByDate(noshow),
  };
}

/** Keep invoice sections separate, sort each one, and assign canonical positions. */
export function orderInvoiceLines(lines: readonly LineItem[]): LineItem[] {
  const sectionOrder: LineType[] = ['completed', 'noshow'];
  const ordered = sectionOrder.flatMap((type) =>
    sortRowsByDate(lines.filter((line) => line.type === type)),
  );
  return ordered.map((line, position) => ({ ...line, position }));
}
