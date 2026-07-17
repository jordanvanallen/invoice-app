import { describe, expect, test } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { allocateSeq } from './numbering-repo';
import {
  createExpenseDraft,
  deleteVoidedExpenseReport,
  duplicateExpenseReport,
  expenseYearRollup,
  finalizeExpenseReport,
  getExpenseStatus,
  latestExpenseDraftId,
  listExpenseYears,
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
import type { ExpenseDraft, ExpenseItem } from '../expense/types';
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
    await saveExpenseDraft(db, id, draft({
      seq: 9,
      items: [
        item({ position: 0, date: '2026-07-10', description: 'Parking' }),
        item({ position: 1, date: '2026-07-16', description: 'Fuel' }),
      ],
    }));

    await expect(finalizeExpenseReport(db, id)).rejects.toThrow(
      'Expense 2 date must be between Jul 1, 2026 and Jul 15, 2026.',
    );

    expect(await db.select(
      'SELECT status, finalized_at, total_cents, snapshot_json FROM expense_reports WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, total_cents: 0, snapshot_json: null,
    }]);
    expect((await loadExpenseDraft(db, id)).items.map((entry) => entry.description)).toEqual([
      'Parking', 'Fuel',
    ]);
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

  test('groups, totals, and searches only finalized reports', async () => {
    const db = await freshDb();
    await finalized(db, { seq: 1, reportDate: '2025-12-31', year: 2025, items: [item({ description: 'Hotel', amountCents: 9_000 })] });
    await finalized(db, { seq: 1, reportDate: '2026-07-15', year: 2026, items: [item({ description: 'Fuel', amountCents: 5_000 })] });
    const voidedId = await finalized(db, { seq: 2, reportDate: '2026-07-16', year: 2026, items: [item({ description: 'Parking', amountCents: 1_000 })] });
    await voidExpenseReport(db, voidedId);

    expect(await listExpenseYears(db)).toEqual([2026, 2025]);
    expect(await expenseYearRollup(db, 2026)).toEqual({ count: 1, totalCents: 5_000 });
    expect((await listExpensesForYear(db, 2026)).map((report) => report.reportNumber)).toEqual(['1-2026']);
    expect((await searchExpenses(db, 'Fuel')).map((report) => report.reportNumber)).toEqual(['1-2026']);
    expect((await searchExpenses(db, '2-2026'))).toEqual([]);
    expect((await listVoidedExpenses(db)).map((report) => report.reportNumber)).toEqual(['2-2026']);
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
});
