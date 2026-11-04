import { describe, expect, test } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './schema';
import { allocateSeq } from './numbering-repo';
import {
  createExpenseDraft,
  deleteVoidedExpenseReport,
  duplicateExpenseReport,
  expenseYearRollup,
  expenseSummaryForRange,
  finalizeExpenseReport,
  getExpenseStatus,
  latestExpenseDraftId,
  listExpenseYears,
  listFinalizedExpenses,
  listExpensesForYear,
  listVoidedExpenses,
  loadExpenseDraft,
  peekNextExpenseSeq,
  reprintExpenseSnapshot,
  restoreExpenseReport,
  saveExpenseDraft,
  searchExpenses,
  voidExpenseReport,
} from './expense-repo';
import { isSectionedExpenseSnapshot } from '../expense/snapshot';
import type { ExpenseCategory, ExpenseDraft, ExpenseItem, LegacyExpenseSnapshot } from '../expense/types';
import type { Db } from './db';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

const header = (over: Partial<Omit<ExpenseDraft, 'seq' | 'items'>> = {}) => ({
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  ...over,
});

const item = (over: Partial<ExpenseItem> = {}): ExpenseItem => ({
  position: 0,
  category: 'general',
  date: '2026-07-02',
  description: 'Fuel',
  amountCents: 5_000,
  ...over,
});

const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  seq: 1,
  ...header(),
  items: [item()],
  ...over,
});

describe('expense draft persistence and numbering', () => {
  test('creates, saves, and loads an incomplete draft', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, {
      ...draft({ seq: null, reportDate: '', items: [item({ date: '', description: '', amountCents: 0 })] }),
    });

    expect(await loadExpenseDraft(db, id)).toEqual({
      ...draft({ seq: null, reportDate: '', items: [item({ date: '', description: '', amountCents: 0 })] }),
    });
  });

  test('reopens the most recently created expense draft', async () => {
    const db = await freshDb();
    const first = await createExpenseDraft(db, header());
    const second = await createExpenseDraft(db, header());
    expect(await latestExpenseDraftId(db)).toBe(second);
    await db.execute("UPDATE expense_reports SET status = 'void' WHERE id = ?", [second]);
    expect(await latestExpenseDraftId(db)).toBe(first);
  });

  test('keeps invoice and expense counters independent', async () => {
    const db = await freshDb();
    expect(await allocateSeq(db, 2026)).toBe(1);
    expect(await allocateSeq(db, 2026)).toBe(2);
    expect(await peekNextExpenseSeq(db, 2026)).toBe(1);

    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({ seq: 7 }));
    expect(await peekNextExpenseSeq(db, 2026, id)).toBe(1);
    expect(await peekNextExpenseSeq(db, 2026)).toBe(8);
  });

  test.each<[string, ExpenseCategory[]]>([
    ['all vehicle', ['vehicle', 'vehicle']],
    ['all general', ['general', 'general']],
    ['mixed and interleaved', ['general', 'vehicle', 'general', 'vehicle']],
  ])('round-trips each row section exactly as saved (%s)', async (_name, categories) => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    const items = categories.map((category, position) => item({
      position, category, description: `${category} ${position}`, amountCents: 100 + position,
    }));

    await saveExpenseDraft(db, id, draft({ seq: null, items }));

    expect((await loadExpenseDraft(db, id)).items).toEqual(items);
  });

  test('rejects a row outside both sections without touching the saved draft', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({ seq: null, items: [item({ category: 'vehicle' })] }));

    await expect(saveExpenseDraft(db, id, draft({
      seq: null,
      items: [
        item({ position: 0, category: 'general', description: 'Ink' }),
        item({ position: 1, category: 'fuel' as ExpenseCategory, description: 'Bad' }),
      ],
    }))).rejects.toThrow('Expense row 2 is not in the Vehicle or General/Admin section.');

    expect((await loadExpenseDraft(db, id)).items).toEqual([item({ category: 'vehicle' })]);
  });
});

describe('expense finalization', () => {
  test('finalizes a selected sequence transactionally in canonical order', async () => {
    const db = await freshDb();
    await db.execute(
      "UPDATE settings SET inspector_name = 'North Star', inspector_address = '1 Main', inspector_number = 'ON-7' WHERE id = 1",
    );
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({
      seq: 11,
      items: [
        item({ position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 }),
        item({ position: 1, date: '2026-07-02', description: 'Fuel', amountCents: 5_000 }),
      ],
    }));

    const snapshot = await finalizeExpenseReport(db, id);

    expect(snapshot.reportNumber).toBe('11-2026');
    expect(snapshot.items.map((row) => row.description)).toEqual(['Fuel', 'Parking']);
    expect(snapshot.totalCents).toBe(6_250);
    expect(await loadExpenseDraft(db, id)).toMatchObject({
      seq: 11,
      items: [
        { position: 0, description: 'Fuel' },
        { position: 1, description: 'Parking' },
      ],
    });
    expect(await reprintExpenseSnapshot(db, id)).toEqual(snapshot);
    expect(await peekNextExpenseSeq(db, 2026)).toBe(12);
  });

  test('freezes mixed sections with stored subtotals and persists the grouped row order', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({
      seq: 12,
      items: [
        item({ position: 0, category: 'general', date: '2026-07-03', description: 'Ink', amountCents: 1_250 }),
        item({ position: 1, category: 'vehicle', date: '2026-07-09', description: 'Parking', amountCents: 800 }),
        item({ position: 2, category: 'general', date: '2026-07-01', description: 'Phone', amountCents: 4_000 }),
        item({ position: 3, category: 'vehicle', date: '2026-07-02', description: 'Fuel', amountCents: 5_000 }),
      ],
    }));

    const snapshot = await finalizeExpenseReport(db, id);

    expect(snapshot).toMatchObject({
      snapshotVersion: 2,
      vehicleSubtotalCents: 5_800,
      generalSubtotalCents: 5_250,
      totalCents: 11_050,
    });
    const order = ['0:vehicle:Fuel', '1:vehicle:Parking', '2:general:Phone', '3:general:Ink'];
    expect(snapshot.items.map((row) => `${row.position}:${row.category}:${row.description}`)).toEqual(order);
    expect((await loadExpenseDraft(db, id)).items.map((row) => `${row.position}:${row.category}:${row.description}`))
      .toEqual(order);
    expect(await db.select('SELECT total_cents FROM expense_reports WHERE id = ?', [id]))
      .toEqual([{ total_cents: 11_050 }]);

    const reprinted = await reprintExpenseSnapshot(db, id);
    expect(reprinted).toEqual(snapshot);
    expect(isSectionedExpenseSnapshot(reprinted)).toBe(true);
  });

  test('refuses to finalize a row whose stored section is unknown, with no side effects', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({ seq: 13 }));
    // Simulates a damaged database that lacks the schema CHECK on expense_items.category.
    const damagedDb: Db = {
      supportsSqlTransactions: true,
      select: async (sql, params) => {
        const rows = await db.select<Record<string, unknown>>(sql, params);
        return (sql.includes('FROM expense_items')
          ? rows.map((row) => ({ ...row, category: 'fuel' }))
          : rows) as never;
      },
      execute: (sql, params) => db.execute(sql, params),
    };

    await expect(finalizeExpenseReport(damagedDb, id)).rejects.toThrow(/unknown section \("fuel"\)/);

    expect(await getExpenseStatus(db, id)).toBe('draft');
    expect(await db.select('SELECT * FROM expense_year_counters')).toEqual([]);
    expect((await loadExpenseDraft(db, id)).items).toEqual([item()]);
  });

  test('rejects invalid drafts without reserving a number or changing status', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({ seq: 9, items: [item({ amountCents: 0 })] }));

    await expect(finalizeExpenseReport(db, id)).rejects.toThrow(/greater than \$0\.00/i);
    expect(await getExpenseStatus(db, id)).toBe('draft');
    expect(await peekNextExpenseSeq(db, 2026)).toBe(10);
    expect(await db.select('SELECT * FROM expense_year_counters')).toEqual([]);
  });

  test('rejects an out-of-range item without any finalization side effects', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    const originalItems = [
      item({ position: 0, date: '2026-07-10', description: 'Parking' }),
      item({ position: 1, date: '2026-06-30', description: 'Fuel' }),
    ];
    await saveExpenseDraft(db, id, draft({
      seq: 9,
      items: originalItems,
    }));
    const persistedItemsBefore = (await loadExpenseDraft(db, id)).items;

    await expect(finalizeExpenseReport(db, id)).rejects.toThrow(
      'Date is outside the reporting period',
    );

    expect(await db.select(
      'SELECT status, finalized_at, total_cents, snapshot_json FROM expense_reports WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, total_cents: 0, snapshot_json: null,
    }]);
    expect((await loadExpenseDraft(db, id)).items).toEqual(persistedItemsBefore);
    expect(await db.select('SELECT * FROM expense_year_counters')).toEqual([]);
    await expect(reprintExpenseSnapshot(db, id)).rejects.toThrow(/not finalized/i);
  });

  test('rejects a duplicate selected number and leaves both reports intact', async () => {
    const db = await freshDb();
    const first = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, first, draft({ seq: 3 }));
    await finalizeExpenseReport(db, first);
    const second = await createExpenseDraft(db, header());
    await expect(saveExpenseDraft(db, second, draft({ seq: 3 }))).rejects.toThrow(/already used/i);
    expect(await getExpenseStatus(db, second)).toBe('draft');
  });

  test('rolls back reordered rows and counter reservation if final update fails', async () => {
    const db = await freshDb();
    const id = await createExpenseDraft(db, header());
    await saveExpenseDraft(db, id, draft({
      seq: 6,
      items: [
        item({ position: 0, date: '2026-07-10', description: 'Parking' }),
        item({ position: 1, date: '2026-07-02', description: 'Fuel' }),
      ],
    }));
    const failingDb: Db = {
      supportsSqlTransactions: true,
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => {
        if (sql.includes("status = 'finalized'")) throw new Error('simulated write failure');
        return db.execute(sql, params);
      },
    };

    await expect(finalizeExpenseReport(failingDb, id)).rejects.toThrow('simulated write failure');

    expect(await getExpenseStatus(db, id)).toBe('draft');
    expect((await loadExpenseDraft(db, id)).items.map((row) => row.description)).toEqual([
      'Parking', 'Fuel',
    ]);
    expect(await db.select('SELECT * FROM expense_year_counters')).toEqual([]);
  });
});

describe('expense history and lifecycle', () => {
  async function finalized(
    db: Awaited<ReturnType<typeof freshDb>>,
    over: Partial<ExpenseDraft> = {},
  ) {
    const id = await createExpenseDraft(db, header(over));
    await saveExpenseDraft(db, id, draft(over));
    await finalizeExpenseReport(db, id);
    return id;
  }

  test('groups and totals finalized reports while search also discovers cancelled reports', async () => {
    const db = await freshDb();
    await finalized(db, { seq: 1, reportDate: '2025-12-31', year: 2025, items: [item({ description: 'Hotel', amountCents: 9_000 })] });
    await finalized(db, { seq: 1, reportDate: '2026-07-15', year: 2026, items: [item({ description: 'Fuel', amountCents: 5_000 })] });
    const voidedId = await finalized(db, { seq: 2, reportDate: '2026-07-16', year: 2026, items: [item({ description: 'Parking', amountCents: 1_000 })] });
    await voidExpenseReport(db, voidedId);

    expect(await listExpenseYears(db)).toEqual([2026, 2025]);
    expect(await expenseYearRollup(db, 2026)).toEqual({ count: 1, totalCents: 5_000 });
    expect((await listExpensesForYear(db, 2026)).map((report) => report.reportNumber)).toEqual(['1-2026']);
    expect((await searchExpenses(db, 'Fuel')).map((report) => report.reportNumber)).toEqual(['1-2026']);
    expect((await searchExpenses(db, '2-2026')).map((report) => report.status)).toEqual(['void']);
    expect((await listVoidedExpenses(db)).map((report) => report.reportNumber)).toEqual(['2-2026']);
  });

  test('orders active, searched, and cancelled expense history by number ascending within the year', async () => {
    const db = await freshDb();
    const third = await finalized(db, {
      seq: 3, reportDate: '2026-07-17',
      items: [item({ description: 'History order' })],
    });
    const first = await finalized(db, {
      seq: 1, reportDate: '2026-07-01',
      items: [item({ description: 'History order' })],
    });
    const second = await finalized(db, {
      seq: 2, reportDate: '2026-07-10',
      items: [item({ description: 'History order' })],
    });
    const priorYear = await finalized(db, {
      seq: 1, year: 2025, reportDate: '2025-12-31',
      items: [item({ description: 'History order' })],
    });

    expect((await listExpensesForYear(db, 2026)).map((report) => report.reportNumber))
      .toEqual(['1-2026', '2-2026', '3-2026']);
    expect((await listFinalizedExpenses(db)).map((report) => report.reportNumber))
      .toEqual(['1-2026', '2-2026', '3-2026', '1-2025']);
    expect((await searchExpenses(db, 'History order')).map((report) => report.reportNumber))
      .toEqual(['1-2026', '2-2026', '3-2026', '1-2025']);

    await voidExpenseReport(db, first);
    await voidExpenseReport(db, second);
    await voidExpenseReport(db, third);
    await voidExpenseReport(db, priorYear);
    expect((await listVoidedExpenses(db)).map((report) => report.reportNumber))
      .toEqual(['1-2026', '2-2026', '3-2026', '1-2025']);
  });

  test('duplicates every row with its section into a fresh draft', async () => {
    const db = await freshDb();
    const source = await finalized(db, {
      seq: 4,
      items: [
        item({ position: 0, category: 'general', date: '2026-07-05', description: 'Ink', amountCents: 700 }),
        item({ position: 1, category: 'vehicle', date: '2026-07-06', description: 'Fuel', amountCents: 5_000 }),
      ],
    });

    const copy = await duplicateExpenseReport(db, source, header({ reportDate: '2026-08-01' }));

    expect((await loadExpenseDraft(db, copy)).items).toEqual([
      item({ position: 0, category: 'vehicle', date: '2026-07-06', description: 'Fuel', amountCents: 5_000 }),
      item({ position: 1, category: 'general', date: '2026-07-05', description: 'Ink', amountCents: 700 }),
    ]);
  });

  test('duplicates to a fresh editable draft and guards status transitions', async () => {
    const db = await freshDb();
    const source = await finalized(db, { seq: 4, items: [item({ description: 'Meals', amountCents: 2_500 })] });
    const copy = await duplicateExpenseReport(db, source, header({ reportDate: '2026-08-01' }));

    expect(await loadExpenseDraft(db, copy)).toMatchObject({
      seq: null,
      reportDate: '2026-08-01',
      items: [{ description: 'Meals', amountCents: 2_500 }],
    });
    await expect(restoreExpenseReport(db, source)).rejects.toThrow(/finalized/i);
    await voidExpenseReport(db, source);
    await expect(voidExpenseReport(db, source)).rejects.toThrow(/void/i);
    await restoreExpenseReport(db, source);
    expect(await getExpenseStatus(db, source)).toBe('finalized');
  });

  test('refuses to strand an existing unfinished draft during duplication', async () => {
    const db = await freshDb();
    const source = await finalized(db, { seq: 4 });
    const existingDraft = await createExpenseDraft(db, header({ reportDate: '2026-07-20' }));
    await saveExpenseDraft(db, existingDraft, draft({
      seq: 5,
      reportDate: '2026-07-20',
      items: [item({ description: 'Unfinished mileage log' })],
    }));

    await expect(duplicateExpenseReport(db, source, header({ reportDate: '2026-08-01' })))
      .rejects.toThrow(
        'You already have an unfinished expense report. Open Expense Reports to finish it before duplicating.',
      );
    expect(await latestExpenseDraftId(db)).toBe(existingDraft);
    expect((await loadExpenseDraft(db, existingDraft)).items[0].description)
      .toBe('Unfinished mileage log');
  });

  test('permanently deletes only a cancelled report and never rewinds numbering', async () => {
    const db = await freshDb();
    const id = await finalized(db, { seq: 8 });
    await expect(deleteVoidedExpenseReport(db, id)).resolves.toBe(false);
    await voidExpenseReport(db, id);
    await expect(deleteVoidedExpenseReport(db, id)).resolves.toBe(true);
    expect(await getExpenseStatus(db, id)).toBeNull();
    expect(await peekNextExpenseSeq(db, 2026)).toBe(9);
  });

  test('does not report success when a lifecycle status update loses a race', async () => {
    const db = await freshDb();
    const id = await finalized(db, { seq: 9 });
    const noUpdateDb: Db = {
      select: db.select.bind(db),
      execute: async (sql, params) => {
        if (sql.includes("SET status = 'void'")) return { rowsAffected: 0 };
        return db.execute(sql, params);
      },
    };

    await expect(voidExpenseReport(noUpdateDb, id)).rejects.toThrow(/changed before it could be cancelled/i);
    expect(await getExpenseStatus(db, id)).toBe('finalized');
  });

  test('loads every finalized report in one ordered history result with void and draft excluded', async () => {
    const db = await freshDb();
    await finalized(db, {
      seq: 2, year: 2026, reportDate: '2026-07-15',
      items: [item({ description: 'Second report' })],
    });
    await finalized(db, {
      seq: 1, year: 2026, reportDate: '2026-07-10',
      items: [item({ description: 'First report' })],
    });
    const voidId = await finalized(db, {
      seq: 3, year: 2026, reportDate: '2026-07-20',
      items: [item({ description: 'Cancelled report' })],
    });
    await voidExpenseReport(db, voidId);
    await createExpenseDraft(db, header({ reportDate: '2025-01-01', year: 2025 }));

    const rows = await listFinalizedExpenses(db);
    expect(rows.map((report) => report.reportNumber)).toEqual(['1-2026', '2-2026']);
    expect(rows.every((report) => report.status === 'finalized')).toBe(true);
  });

  test('qualifies summaries by report date and includes every stored item from a qualifying report', async () => {
    const db = await freshDb();
    await finalized(db, {
      seq: 4,
      reportDate: '2026-07-15',
      periodStart: '2026-06-01',
      periodEnd: '2026-08-31',
      items: [
        item({ position: 0, date: '2026-08-01', description: 'August parking', amountCents: 2_500 }),
        item({ position: 1, date: '2026-06-30', description: 'June fuel', amountCents: 5_000 }),
      ],
    });
    await finalized(db, {
      seq: 5,
      reportDate: '2026-08-01',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      items: [item({ date: '2026-08-01', description: 'Out-of-range report', amountCents: 9_000 })],
    });

    const summary = await expenseSummaryForRange(db, {
      start: '2026-07-01',
      end: '2026-07-31',
    });
    expect(summary.reports.map((report) => report.reportNumber)).toEqual(['4-2026']);
    expect(summary.items.map((row) => row.description)).toEqual(['June fuel', 'August parking']);
    expect(summary.items.map((row) => row.category)).toEqual(['general', 'general']);
    expect(summary.items.reduce((sum, row) => sum + row.amountCents, 0))
      .toBe(summary.reports.reduce((sum, report) => sum + report.totalCents, 0));
  });

  test('orders tied summary items deterministically and All time excludes void reports', async () => {
    const db = await freshDb();
    const first = await finalized(db, {
      seq: 2,
      reportDate: '2026-07-10',
      items: [
        item({ position: 0, date: '2026-07-02', description: 'Report two first' }),
        item({ position: 1, date: '2026-07-02', description: 'Report two second' }),
      ],
    });
    await finalized(db, {
      seq: 1,
      reportDate: '2026-07-09',
      items: [item({ date: '2026-07-02', description: 'Report one' })],
    });
    await finalized(db, {
      seq: 3,
      reportDate: '2026-07-11',
      items: [
        item({ position: 0, date: '2026-07-02', description: 'Report three first' }),
        item({ position: 1, date: '2026-07-02', description: 'Report three second' }),
      ],
    });
    await voidExpenseReport(db, first);

    const summary = await expenseSummaryForRange(db, null);
    expect(summary.reports.map((report) => report.reportNumber)).toEqual(['1-2026', '3-2026']);
    expect(summary.items.map((row) => row.description)).toEqual([
      'Report one', 'Report three first', 'Report three second',
    ]);
    expect(summary.reports.every((report) => report.status === 'finalized')).toBe(true);
  });

  test('reads each summary item section while keeping the flat date order', async () => {
    const db = await freshDb();
    await finalized(db, {
      seq: 6,
      items: [
        item({ position: 0, category: 'general', date: '2026-07-01', description: 'Phone' }),
        item({ position: 1, category: 'vehicle', date: '2026-07-03', description: 'Fuel' }),
        item({ position: 2, category: 'general', date: '2026-07-02', description: 'Ink' }),
      ],
    });

    const summary = await expenseSummaryForRange(db, null);

    expect(summary.items.map((row) => `${row.itemDate}:${row.category}:${row.description}`)).toEqual([
      '2026-07-01:general:Phone',
      '2026-07-02:general:Ink',
      '2026-07-03:vehicle:Fuel',
    ]);
  });
});

describe('expense reports saved before sections existed (schema v6)', () => {
  async function dbAtSchemaV6() {
    const db = await createSqlJsDb();
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 6)) {
      for (const sql of migration.statements) await db.execute(sql);
    }
    await db.execute('PRAGMA user_version = 6');
    return db;
  }

  const legacy: LegacyExpenseSnapshot = {
    reportNumber: '2-2026', seq: 2, year: 2026, reportDate: '2026-06-30',
    periodStart: '2026-06-01', periodEnd: '2026-06-30',
    inspectorName: 'North Star', inspectorAddress: '1 Main', inspectorNumber: 'ON-7', logoDataUrl: '',
    items: [
      { position: 0, date: '2026-06-02', description: 'Fuel', amountCents: 5_000 },
      { position: 1, date: '2026-06-10', description: 'Printer ink', amountCents: 1_250 },
    ],
    totalCents: 6_250,
  };

  /** Seed rows the way the pre-section app wrote them, then upgrade to the current schema. */
  async function upgradedLegacyDb({ withDraft }: { withDraft: boolean }) {
    const db = await dbAtSchemaV6();
    await db.execute(
      `INSERT INTO expense_reports
         (id, year, seq, status, report_date, period_start, period_end, finalized_at, total_cents, snapshot_json)
       VALUES (1, 2026, 2, 'finalized', '2026-06-30', '2026-06-01', '2026-06-30', '2026-06-30T12:00:00Z', 6250, ?)`,
      [JSON.stringify(legacy)],
    );
    const rows: Array<readonly [number, number, string, string, number]> = [
      [1, 0, '2026-06-02', 'Fuel', 5_000],
      [1, 1, '2026-06-10', 'Printer ink', 1_250],
    ];
    if (withDraft) {
      await db.execute(
        `INSERT INTO expense_reports (id, year, status, report_date, period_start, period_end)
         VALUES (2, 2026, 'draft', '2026-07-15', '2026-07-01', '2026-07-15')`,
      );
      rows.push([2, 0, '2026-07-03', 'Unfinished parking', 900]);
    }
    for (const [reportId, position, date, description, cents] of rows) {
      await db.execute(
        `INSERT INTO expense_items (expense_report_id, position, date, description, amount_cents)
         VALUES (?, ?, ?, ?, ?)`,
        [reportId, position, date, description, cents],
      );
    }
    await runMigrations(db);
    return db;
  }

  test('upgrade keeps legacy snapshots flat while their rows default to General/Admin', async () => {
    const db = await upgradedLegacyDb({ withDraft: true });

    const reprinted = await reprintExpenseSnapshot(db, 1);
    expect(reprinted).toEqual(legacy);
    expect(isSectionedExpenseSnapshot(reprinted)).toBe(false);
    expect((await loadExpenseDraft(db, 2)).items).toEqual([item({
      date: '2026-07-03', description: 'Unfinished parking', amountCents: 900,
    })]);
    expect(await expenseYearRollup(db, 2026)).toEqual({ count: 1, totalCents: 6_250 });
  });

  test('a duplicated legacy report starts with every row in General/Admin and finalizes sectioned', async () => {
    const db = await upgradedLegacyDb({ withDraft: false });

    const copy = await duplicateExpenseReport(db, 1, header({
      reportDate: '2026-06-30', periodStart: '2026-06-01', periodEnd: '2026-06-30',
    }));
    expect((await loadExpenseDraft(db, copy)).items.map((row) => row.category))
      .toEqual(['general', 'general']);

    await saveExpenseDraft(db, copy, { ...(await loadExpenseDraft(db, copy)), seq: 3 });
    const snapshot = await finalizeExpenseReport(db, copy);
    expect(snapshot).toMatchObject({
      snapshotVersion: 2, vehicleSubtotalCents: 0, generalSubtotalCents: 6_250, totalCents: 6_250,
    });
    expect(await reprintExpenseSnapshot(db, 1)).toEqual(legacy);
  });
});
