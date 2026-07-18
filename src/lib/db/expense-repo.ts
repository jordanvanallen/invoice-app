import type { Db, DbStatement } from './db';
import { executeStatementsAtomically } from './db';
import { getSettings } from './settings-repo';
import { buildExpenseSnapshot } from '../expense/snapshot';
import { orderExpenseItems } from '../expense/order';
import { expenseFinalizeBlockers } from '../expense/validation';
import type {
  ExpenseDraft,
  ExpenseItem,
  ExpenseListItem,
  ExpenseRollup,
  ExpenseSnapshot,
  ExpenseStatus,
} from '../expense/types';

export type ExpenseDraftHeader = Omit<ExpenseDraft, 'seq' | 'items'>;

function deriveExpenseYear(reportDate: string, fallbackYear: number): number {
  const yearText = reportDate.slice(0, 4);
  return /^\d{4}$/.test(yearText) ? Number(yearText) : fallbackYear;
}

export async function createExpenseDraft(db: Db, header: ExpenseDraftHeader): Promise<number> {
  const result = await db.execute(
    `INSERT INTO expense_reports
       (year, status, report_date, period_start, period_end)
     VALUES (?, 'draft', ?, ?, ?)`,
    [header.year, header.reportDate, header.periodStart, header.periodEnd],
  );
  return result.lastInsertId as number;
}

interface ExpenseItemRow {
  position: number;
  date: string;
  description: string;
  amount_cents: number;
}

export async function loadExpenseDraft(db: Db, reportId: number): Promise<ExpenseDraft> {
  const [head] = await db.select<{
    year: number;
    seq: number | null;
    report_date: string;
    period_start: string;
    period_end: string;
  }>(
    `SELECT year, seq, report_date, period_start, period_end
       FROM expense_reports WHERE id = ?`,
    [reportId],
  );
  if (!head) throw new Error(`Expense report ${reportId} does not exist.`);
  const rows = await db.select<ExpenseItemRow>(
    `SELECT position, date, description, amount_cents
       FROM expense_items
      WHERE expense_report_id = ?
      ORDER BY position, id`,
    [reportId],
  );
  return {
    seq: head.seq,
    year: head.year,
    reportDate: head.report_date,
    periodStart: head.period_start,
    periodEnd: head.period_end,
    items: rows.map((row) => ({
      position: row.position,
      date: row.date,
      description: row.description,
      amountCents: row.amount_cents,
    })),
  };
}

export async function takenExpenseSequences(
  db: Db,
  year: number,
  excludeId?: number,
): Promise<number[]> {
  const params: unknown[] = [year];
  const exclude = excludeId === undefined ? '' : ' AND id != ?';
  if (excludeId !== undefined) params.push(excludeId);
  const rows = await db.select<{ seq: number }>(
    `SELECT seq FROM expense_reports
      WHERE year = ? AND seq IS NOT NULL${exclude}
      ORDER BY seq`,
    params,
  );
  return rows.map((row) => row.seq);
}

function validateSelectedExpenseSeq(seq: number, taken: number[]): void {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error('Expense report number must be a positive integer.');
  }
  if (taken.includes(seq)) {
    throw new Error(`Expense report number ${seq} is already used this year.`);
  }
}

function replaceExpenseItemStatements(
  reportId: number,
  items: readonly ExpenseItem[],
): DbStatement[] {
  return [
    { sql: 'DELETE FROM expense_items WHERE expense_report_id = ?', params: [reportId] },
    ...items.map((item) => ({
      sql: `INSERT INTO expense_items
              (expense_report_id, position, date, description, amount_cents)
            VALUES (?, ?, ?, ?, ?)`,
      params: [reportId, item.position, item.date, item.description, item.amountCents],
    })),
  ];
}

function requireDraftStatement(reportId: number): DbStatement {
  return {
    sql: `UPDATE expense_reports
             SET status = CASE WHEN status = 'draft' THEN 'draft' ELSE '__invalid__' END
           WHERE id = ?`,
    params: [reportId],
  };
}

export async function saveExpenseDraft(
  db: Db,
  reportId: number,
  draft: ExpenseDraft,
): Promise<void> {
  const status = await getExpenseStatus(db, reportId);
  if (status !== 'draft') {
    throw new Error(`Expense report ${reportId} is not an editable draft.`);
  }
  const year = deriveExpenseYear(draft.reportDate, draft.year);
  if (draft.seq !== null) {
    validateSelectedExpenseSeq(draft.seq, await takenExpenseSequences(db, year, reportId));
  }
  await executeStatementsAtomically(db, [
    requireDraftStatement(reportId),
    {
      sql: `UPDATE expense_reports SET
              seq = ?, year = ?, report_date = ?, period_start = ?, period_end = ?
            WHERE id = ? AND status = 'draft'`,
      params: [draft.seq, year, draft.reportDate, draft.periodStart, draft.periodEnd, reportId],
    },
    ...replaceExpenseItemStatements(reportId, draft.items),
  ]);
}

export async function latestExpenseDraftId(db: Db): Promise<number | null> {
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM expense_reports WHERE status = 'draft' ORDER BY id DESC LIMIT 1",
  );
  return rows[0]?.id ?? null;
}

export async function peekNextExpenseSeq(
  db: Db,
  year: number,
  excludeReportId?: number,
): Promise<number> {
  const params: unknown[] = [year];
  const exclude = excludeReportId === undefined ? '' : ' AND id != ?';
  if (excludeReportId !== undefined) params.push(excludeReportId);
  const [used] = await db.select<{ max_seq: number | null }>(
    `SELECT MAX(seq) AS max_seq FROM expense_reports
      WHERE year = ? AND seq IS NOT NULL${exclude}`,
    params,
  );
  const [counter] = await db.select<{ last_seq: number }>(
    'SELECT last_seq FROM expense_year_counters WHERE year = ?',
    [year],
  );
  return Math.max(used?.max_seq ?? 0, counter?.last_seq ?? 0) + 1;
}

export async function finalizeExpenseReport(db: Db, reportId: number): Promise<ExpenseSnapshot> {
  const status = await getExpenseStatus(db, reportId);
  if (status !== 'draft') throw new Error(`Expense report ${reportId} is not a draft.`);
  const loaded = await loadExpenseDraft(db, reportId);
  const draft = {
    ...loaded,
    year: deriveExpenseYear(loaded.reportDate, loaded.year),
  };
  const blockers = expenseFinalizeBlockers(draft);
  if (blockers.length) throw new Error(blockers[0].message);
  const seq = draft.seq as number;
  const settings = await getSettings(db);
  validateSelectedExpenseSeq(seq, await takenExpenseSequences(db, draft.year, reportId));
  const orderedItems = orderExpenseItems(draft.items);
  const normalized = { ...draft, seq, items: orderedItems };
  const snapshot = buildExpenseSnapshot(normalized, settings, seq);
  await executeStatementsAtomically(db, [
    requireDraftStatement(reportId),
    ...replaceExpenseItemStatements(reportId, orderedItems),
    {
      sql: `INSERT INTO expense_year_counters (year, last_seq) VALUES (?, ?)
            ON CONFLICT(year) DO UPDATE SET last_seq =
              CASE WHEN last_seq < excluded.last_seq THEN excluded.last_seq ELSE last_seq END`,
      params: [draft.year, seq],
    },
    {
      sql: `UPDATE expense_reports SET
              seq = ?, year = ?, status = 'finalized', finalized_at = ?,
              total_cents = ?, snapshot_json = ?
            WHERE id = ? AND status = 'draft'`,
      params: [
        seq,
        draft.year,
        new Date().toISOString(),
        snapshot.totalCents,
        JSON.stringify(snapshot),
        reportId,
      ],
    },
  ]);
  return snapshot;
}

export async function reprintExpenseSnapshot(db: Db, reportId: number): Promise<ExpenseSnapshot> {
  const [row] = await db.select<{ snapshot_json: string | null }>(
    'SELECT snapshot_json FROM expense_reports WHERE id = ?',
    [reportId],
  );
  if (!row?.snapshot_json) throw new Error(`Expense report ${reportId} is not finalized.`);
  return JSON.parse(row.snapshot_json) as ExpenseSnapshot;
}

function toExpenseListItem(row: {
  id: number;
  year: number;
  seq: number;
  report_date: string;
  total_cents: number;
  status: ExpenseStatus;
}): ExpenseListItem {
  return {
    id: row.id,
    reportNumber: `${row.seq}-${row.year}`,
    reportDate: row.report_date,
    totalCents: row.total_cents,
    status: row.status,
  };
}

type ExpenseListRow = Parameters<typeof toExpenseListItem>[0];

export async function listExpenseYears(db: Db): Promise<number[]> {
  const rows = await db.select<{ year: number }>(
    `SELECT DISTINCT CAST(substr(report_date, 1, 4) AS INTEGER) AS year
       FROM expense_reports
      WHERE status = 'finalized' AND report_date != ''
      ORDER BY year DESC`,
  );
  return rows.map((row) => row.year);
}

export async function expenseYearRollup(db: Db, year: number): Promise<ExpenseRollup> {
  const [row] = await db.select<{ count: number; total: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total
       FROM expense_reports
      WHERE status = 'finalized'
        AND CAST(substr(report_date, 1, 4) AS INTEGER) = ?`,
    [year],
  );
  return { count: row.count, totalCents: row.total };
}

export async function listExpensesForYear(db: Db, year: number): Promise<ExpenseListItem[]> {
  const rows = await db.select<ExpenseListRow>(
    `SELECT id, year, seq, report_date, total_cents, status
       FROM expense_reports
      WHERE status = 'finalized'
        AND CAST(substr(report_date, 1, 4) AS INTEGER) = ?
      ORDER BY report_date DESC, seq DESC`,
    [year],
  );
  return rows.map(toExpenseListItem);
}

export async function searchExpenses(db: Db, query: string): Promise<ExpenseListItem[]> {
  const value = query.trim();
  if (!value) return [];
  const like = `%${value}%`;
  const rows = await db.select<ExpenseListRow>(
    `SELECT DISTINCT er.id, er.year, er.seq, er.report_date, er.total_cents, er.status
       FROM expense_reports er
       LEFT JOIN expense_items ei ON ei.expense_report_id = er.id
      WHERE er.status = 'finalized' AND (
            er.report_date LIKE ?
         OR (er.seq || '-' || er.year) LIKE ?
         OR ei.description LIKE ?)
      ORDER BY er.report_date DESC, er.seq DESC`,
    [like, like, like],
  );
  return rows.map(toExpenseListItem);
}

export async function listVoidedExpenses(db: Db): Promise<ExpenseListItem[]> {
  const rows = await db.select<ExpenseListRow>(
    `SELECT id, year, seq, report_date, total_cents, status
       FROM expense_reports WHERE status = 'void'
      ORDER BY report_date DESC, seq DESC`,
  );
  return rows.map(toExpenseListItem);
}

export async function duplicateExpenseReport(
  db: Db,
  sourceId: number,
  header: ExpenseDraftHeader,
): Promise<number> {
  const status = await getExpenseStatus(db, sourceId);
  if (status !== 'finalized' && status !== 'void') {
    throw new Error('Only finalized or cancelled expense reports can be duplicated.');
  }
  if (await latestExpenseDraftId(db) !== null) {
    throw new Error(
      'You already have an unfinished expense report. Open Expense Reports to finish or discard it before duplicating.',
    );
  }
  const source = await loadExpenseDraft(db, sourceId);
  const [next] = await db.select<{ id: number }>(
    'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM expense_reports',
  );
  const newId = next.id;
  await executeStatementsAtomically(db, [
    {
      sql: `INSERT INTO expense_reports
              (id, year, status, report_date, period_start, period_end)
            VALUES (?, ?, 'draft', ?, ?, ?)`,
      params: [newId, header.year, header.reportDate, header.periodStart, header.periodEnd],
    },
    ...replaceExpenseItemStatements(
      newId,
      source.items.map((sourceItem, position) => ({ ...sourceItem, position })),
    ).slice(1),
  ]);
  return newId;
}

/** Permanently discard only an editable draft, including its rows. */
export async function deleteExpenseDraft(db: Db, id: number): Promise<boolean> {
  if (await getExpenseStatus(db, id) !== 'draft') return false;
  await executeStatementsAtomically(db, [
    requireDraftStatement(id),
    { sql: 'DELETE FROM expense_items WHERE expense_report_id = ?', params: [id] },
    { sql: "DELETE FROM expense_reports WHERE id = ? AND status = 'draft'", params: [id] },
  ]);
  return true;
}

export async function getExpenseStatus(db: Db, id: number): Promise<ExpenseStatus | null> {
  const [row] = await db.select<{ status: ExpenseStatus }>(
    'SELECT status FROM expense_reports WHERE id = ?',
    [id],
  );
  return row?.status ?? null;
}

export async function voidExpenseReport(db: Db, id: number): Promise<void> {
  const status = await getExpenseStatus(db, id);
  if (status !== 'finalized') {
    throw new Error(`Expense report ${id} is ${status ?? 'missing'}, not finalized.`);
  }
  const result = await db.execute(
    "UPDATE expense_reports SET status = 'void' WHERE id = ? AND status = 'finalized'",
    [id],
  );
  if (result.rowsAffected !== 1) {
    throw new Error(`Expense report ${id} changed before it could be cancelled. Please refresh and try again.`);
  }
}

export async function restoreExpenseReport(db: Db, id: number): Promise<void> {
  const status = await getExpenseStatus(db, id);
  if (status !== 'void') {
    throw new Error(`Expense report ${id} is ${status ?? 'missing'}, not void.`);
  }
  const result = await db.execute(
    "UPDATE expense_reports SET status = 'finalized' WHERE id = ? AND status = 'void'",
    [id],
  );
  if (result.rowsAffected !== 1) {
    throw new Error(`Expense report ${id} changed before it could be restored. Please refresh and try again.`);
  }
}

export async function deleteVoidedExpenseReport(db: Db, id: number): Promise<boolean> {
  const result = await db.execute(
    "DELETE FROM expense_reports WHERE id = ? AND status = 'void'",
    [id],
  );
  return result.rowsAffected > 0;
}
