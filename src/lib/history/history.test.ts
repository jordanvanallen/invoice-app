import { describe, expect, test } from 'vitest';
import {
  calendarYearRange,
  createHistorySearchLifecycle,
  createLatestRequestGate,
  filterHistoryRows,
  groupHistoryRows,
  historyPresets,
  historyRangeLabel,
  partitionHistoryRows,
  resolveHistoryRange,
  sumExpenseHistory,
  sumInvoiceHistory,
} from './history';

describe('history ranges', () => {
  test('resolves blank dates to All time and valid bounds inclusively', () => {
    expect(resolveHistoryRange('', '')).toEqual({ kind: 'all', range: null, error: '' });
    expect(resolveHistoryRange('2026-07-01', '2026-07-31')).toEqual({
      kind: 'range',
      range: { start: '2026-07-01', end: '2026-07-31' },
      error: '',
    });

    const rows = [
      { date: '2026-06-30' },
      { date: '2026-07-01' },
      { date: '2026-07-31' },
      { date: '2026-08-01' },
    ];
    expect(filterHistoryRows(
      rows,
      (row) => row.date,
      { start: '2026-07-01', end: '2026-07-31' },
    )).toEqual(rows.slice(1, 3));
  });

  test('uses All time as the effective range for incomplete or reversed input', () => {
    expect(resolveHistoryRange('2026-07-01', '')).toMatchObject({ kind: 'invalid', range: null });
    expect(resolveHistoryRange('', '2026-07-31')).toMatchObject({ kind: 'invalid', range: null });
    expect(resolveHistoryRange('2026-08-01', '2026-07-31')).toMatchObject({ kind: 'invalid', range: null });
    expect(resolveHistoryRange('2026-02-30', '2026-03-01')).toMatchObject({ kind: 'invalid', range: null });
  });

  test('formats stable labels and calendar presets without UTC conversion', () => {
    expect(historyRangeLabel(null)).toBe('All time');
    expect(historyRangeLabel(calendarYearRange(2026), 2026)).toBe('Calendar year 2026');
    expect(historyRangeLabel({ start: '2026-07-01', end: '2026-07-31' }))
      .toBe('July 1, 2026 – July 31, 2026');
    expect(historyPresets(new Date(2026, 6, 21)).thisQuarter)
      .toEqual({ start: '2026-07-01', end: '2026-07-21' });
  });
});

describe('history derivation', () => {
  test('groups without mutating and calculates cents-only rollups', () => {
    const invoices = [
      { issueDate: '2026-02-01', totalCents: 11_300, taxCents: 1_300 },
      { issueDate: '2025-12-31', totalCents: 5_650, taxCents: 650 },
    ];

    expect(groupHistoryRows(invoices, (row) => row.issueDate).map((group) => group.year))
      .toEqual([2026, 2025]);
    expect(sumInvoiceHistory(invoices)).toEqual({
      count: 2,
      totalBilledCents: 16_950,
      totalTaxCents: 1_950,
    });
    expect(sumExpenseHistory([{ totalCents: 10_000 }, { totalCents: 25_000 }]))
      .toEqual({ count: 2, totalCents: 35_000 });
    expect(invoices.map((row) => row.issueDate)).toEqual(['2026-02-01', '2025-12-31']);
  });

  test('groups malformed legacy dates into a visible undated bucket', () => {
    const rows = [{ date: '' }, { date: '2026-07-20' }, { date: 'not-a-date' }];
    expect(groupHistoryRows(rows, (row) => row.date)).toEqual([
      { year: 2026, rows: [rows[1]] },
      { year: 0, rows: [rows[0], rows[2]] },
    ]);
  });

  test('splits finalized and void rows while excluding drafts', () => {
    expect(partitionHistoryRows([
      { id: 1, status: 'finalized' as const },
      { id: 2, status: 'void' as const },
      { id: 3, status: 'draft' as const },
    ])).toEqual({
      finalized: [{ id: 1, status: 'finalized' }],
      void: [{ id: 2, status: 'void' }],
    });
  });

  test('allows only the latest asynchronous request to publish', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  test('publishes only the latest search and clears an in-flight request', async () => {
    type Row = { id: number };
    const states: Array<{ status: string; rows: Row[]; error: string }> = [];
    const lifecycle = createHistorySearchLifecycle<Row>((state) => states.push(state));
    let resolveFirst!: (rows: Row[]) => void;
    let resolveSecond!: (rows: Row[]) => void;
    const first = lifecycle.run(() => new Promise<Row[]>((resolve) => { resolveFirst = resolve; }));
    const second = lifecycle.run(() => new Promise<Row[]>((resolve) => { resolveSecond = resolve; }));

    resolveSecond([{ id: 2 }]);
    await second;
    resolveFirst([{ id: 1 }]);
    await first;
    expect(states.at(-1)).toEqual({ status: 'ready', rows: [{ id: 2 }], error: '' });

    let resolveThird!: (rows: Row[]) => void;
    const third = lifecycle.run(() => new Promise<Row[]>((resolve) => { resolveThird = resolve; }));
    lifecycle.clear();
    resolveThird([{ id: 3 }]);
    await third;
    expect(states.at(-1)).toEqual({ status: 'idle', rows: [], error: '' });
  });

  test('publishes a search failure and clears it on reset', async () => {
    const states: Array<{ status: string; rows: never[]; error: string }> = [];
    const lifecycle = createHistorySearchLifecycle<never>((state) => states.push(state));
    await lifecycle.run(async () => { throw new Error('search failed'); });
    expect(states.at(-1)).toEqual({ status: 'error', rows: [], error: 'search failed' });
    lifecycle.clear();
    expect(states.at(-1)).toEqual({ status: 'idle', rows: [], error: '' });
  });
});
