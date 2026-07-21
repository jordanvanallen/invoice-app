import { toIsoDate } from '../ui/date';
import { isValidIsoDate } from '../validation';

export interface ClosedDateRange {
  readonly start: string;
  readonly end: string;
}

export type HistoryRangeResolution =
  | { kind: 'all'; range: null; error: '' }
  | { kind: 'range'; range: ClosedDateRange; error: '' }
  | { kind: 'invalid'; range: null; error: string };

export interface HistoryGroup<T> {
  year: number;
  rows: T[];
}

export function resolveHistoryRange(start: string, end: string): HistoryRangeResolution {
  if (!start && !end) return { kind: 'all', range: null, error: '' };
  if (!start || !end) {
    return { kind: 'invalid', range: null, error: 'Choose both a start and end date.' };
  }
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return { kind: 'invalid', range: null, error: 'Choose valid dates.' };
  }
  if (start > end) {
    return { kind: 'invalid', range: null, error: 'Start date must be on or before end date.' };
  }
  return { kind: 'range', range: Object.freeze({ start, end }), error: '' };
}

export function calendarYearRange(year: number): ClosedDateRange {
  return Object.freeze({ start: `${year}-01-01`, end: `${year}-12-31` });
}

export function historyPresets(now: Date): {
  thisYear: ClosedDateRange;
  lastYear: ClosedDateRange;
  thisQuarter: ClosedDateRange;
} {
  const year = now.getFullYear();
  return {
    thisYear: Object.freeze({ start: `${year}-01-01`, end: toIsoDate(now) }),
    lastYear: calendarYearRange(year - 1),
    thisQuarter: Object.freeze({
      start: toIsoDate(new Date(year, Math.floor(now.getMonth() / 3) * 3, 1)),
      end: toIsoDate(now),
    }),
  };
}

export function matchesHistoryRange(date: string, range: ClosedDateRange | null): boolean {
  return range === null || (date >= range.start && date <= range.end);
}

export function filterHistoryRows<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
  range: ClosedDateRange | null,
): T[] {
  return rows.filter((row) => matchesHistoryRange(dateOf(row), range));
}

export function groupHistoryRows<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
): HistoryGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const year = Number(dateOf(row).slice(0, 4));
    groups.set(year, [...(groups.get(year) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, groupedRows]) => ({ year, rows: groupedRows }));
}

export function sumInvoiceHistory(rows: readonly { totalCents: number; taxCents: number }[]): {
  count: number;
  totalBilledCents: number;
  totalTaxCents: number;
} {
  return rows.reduce<{ count: number; totalBilledCents: number; totalTaxCents: number }>((rollup, row) => ({
    count: rollup.count + 1,
    totalBilledCents: rollup.totalBilledCents + row.totalCents,
    totalTaxCents: rollup.totalTaxCents + row.taxCents,
  }), { count: 0, totalBilledCents: 0, totalTaxCents: 0 });
}

export function sumExpenseHistory(rows: readonly { totalCents: number }[]): {
  count: number;
  totalCents: number;
} {
  return rows.reduce<{ count: number; totalCents: number }>((rollup, row) => ({
    count: rollup.count + 1,
    totalCents: rollup.totalCents + row.totalCents,
  }), { count: 0, totalCents: 0 });
}

export function partitionHistoryRows<T extends { status: string }>(rows: readonly T[]): {
  finalized: T[];
  void: T[];
} {
  return {
    finalized: rows.filter((row) => row.status === 'finalized'),
    void: rows.filter((row) => row.status === 'void'),
  };
}

function displayIsoDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function historyRangeLabel(
  range: ClosedDateRange | null,
  calendarYear?: number,
): string {
  if (range === null) return 'All time';
  if (calendarYear !== undefined
    && range.start === `${calendarYear}-01-01`
    && range.end === `${calendarYear}-12-31`) {
    return `Calendar year ${calendarYear}`;
  }
  return `${displayIsoDate(range.start)} – ${displayIsoDate(range.end)}`;
}

export function createLatestRequestGate(): {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
} {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (requestId: number) => requestId === latest,
  };
}
