import type { LineItem, LineType } from './types';

function compareInspectionNumbers(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}

/** Return a date/inspection-number ordered copy, with blank fields last. */
export function sortRowsByDate<T extends { date: string; inspectionNumber: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aBlank = a.row.date === '';
      const bBlank = b.row.date === '';
      if (aBlank !== bBlank) return aBlank ? 1 : -1;
      return a.row.date.localeCompare(b.row.date)
        || compareInspectionNumbers(a.row.inspectionNumber, b.row.inspectionNumber)
        || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Apply the editor's explicit sort action without mixing its two sections. */
export function sortInvoiceSections<T extends { date: string; inspectionNumber: string }>(
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
