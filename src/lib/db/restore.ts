import type { Db } from './db';
import { MIGRATIONS } from './schema';

/** Highest schema version this build knows how to open. */
export const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

/** Tables that must be present for a file to count as an Invoice Maker database. */
export const REQUIRED_TABLES = [
  'settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items',
] as const;

export const EXPENSE_TABLES = [
  'expense_year_counters', 'expense_reports', 'expense_items',
] as const;

export interface BackupSummary {
  businessName: string;
  invoiceCount: number; // finalized invoices
  latestInvoiceDate: string | null;
  expenseReportCount: number; // finalized expense reports
  latestExpenseReportDate: string | null;
}

export interface BackupCheck {
  ok: boolean;
  reason?: string;
  summary?: BackupSummary;
}

/**
 * Validate that `db` (a candidate backup opened in its own connection) is an
 * intact, app-appropriate Invoice Maker database. Read-only — never mutates.
 * Returns a friendly reason on failure and a content summary on success so the
 * user can confirm it's the right backup before anything is replaced.
 */
export async function validateBackup(db: Db): Promise<BackupCheck> {
  // 1) Intact SQLite file (catches corruption, truncation, non-database files).
  let integ: { integrity_check: string }[];
  try {
    integ = await db.select<{ integrity_check: string }>('PRAGMA integrity_check');
  } catch {
    return { ok: false, reason: 'This file is not a readable database.' };
  }
  if (integ[0]?.integrity_check !== 'ok') {
    return { ok: false, reason: 'This database is corrupted, so it cannot be restored.' };
  }

  // 2) It's actually THIS app's database (rejects some other app's .db).
  let tables: { name: string }[];
  try {
    tables = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  } catch {
    return { ok: false, reason: 'This file is not a readable database.' };
  }
  const names = new Set(tables.map((t) => t.name));
  if (REQUIRED_TABLES.some((t) => !names.has(t))) {
    return { ok: false, reason: "This doesn't look like an Invoice Maker backup — it's missing expected data." };
  }

  // 3) A schema version this build understands (never import a newer schema).
  const verRows = await db.select<{ user_version: number }>('PRAGMA user_version');
  const schemaVersion = verRows[0]?.user_version ?? 0;
  if (schemaVersion > LATEST_SCHEMA_VERSION) {
    return { ok: false, reason: 'This backup is from a newer version of the app. Update Invoice Maker first, then restore.' };
  }
  const hasExpenseSchema = schemaVersion >= 4;
  if (hasExpenseSchema && EXPENSE_TABLES.some((table) => !names.has(table))) {
    return { ok: false, reason: "This doesn't look like an Invoice Maker backup — it's missing expected data." };
  }
  if (schemaVersion >= 5) {
    const approverColumns = new Set((await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('approvers')",
    )).map((row) => row.name));
    const lineColumns = new Set((await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('line_items')",
    )).map((row) => row.name));
    const indexes = await db.select<{ name: string; unique: number; partial: number }>(
      'PRAGMA index_list(approvers)',
    );
    const indexColumns = await db.select<{ name: string }>('PRAGMA index_info(idx_approvers_name_key)');
    const foreignKeys = await db.select<{
      id: number; seq: number; table: string; from: string; to: string;
    }>(
      'PRAGMA foreign_key_list(line_items)',
    );
    const foreignKeyErrors = await db.select('PRAGMA foreign_key_check');
    const hasApproverColumns = ['id', 'name', 'name_key', 'active']
      .every((column) => approverColumns.has(column));
    const hasMileageColumns = [
      'mileage_approver_id', 'mileage_approver_name', 'mileage_approval_date',
    ].every((column) => lineColumns.has(column));
    const hasUniqueNameKeyIndex = indexes.some(
      (index) => index.name === 'idx_approvers_name_key'
        && index.unique === 1
        && index.partial === 0,
    ) && indexColumns.length === 1 && indexColumns[0]?.name === 'name_key';
    const hasApproverForeignKey = foreignKeys.some(
      (foreignKey) => foreignKey.seq === 0
        && foreignKey.table === 'approvers'
        && foreignKey.from === 'mileage_approver_id'
        && foreignKey.to === 'id'
        && foreignKeys.filter((candidate) => candidate.id === foreignKey.id).length === 1,
    );
    if (
      !hasApproverColumns
      || !hasMileageColumns
      || !hasUniqueNameKeyIndex
      || !hasApproverForeignKey
      || foreignKeyErrors.length !== 0
    ) {
      return { ok: false, reason: "This doesn't look like an Invoice Maker backup — it's missing expected data." };
    }
  }

  // Content summary for the user to eyeball before committing.
  const set = await db.select<{ name: string }>('SELECT inspector_name AS name FROM settings WHERE id = 1');
  const cnt = await db.select<{ c: number }>("SELECT COUNT(*) AS c FROM invoices WHERE status = 'finalized'");
  const latest = await db.select<{ d: string | null }>("SELECT MAX(issue_date) AS d FROM invoices WHERE status = 'finalized'");
  const expenseCount = hasExpenseSchema
    ? await db.select<{ c: number }>("SELECT COUNT(*) AS c FROM expense_reports WHERE status = 'finalized'")
    : [{ c: 0 }];
  const latestExpense = hasExpenseSchema
    ? await db.select<{ d: string | null }>("SELECT MAX(report_date) AS d FROM expense_reports WHERE status = 'finalized'")
    : [{ d: null }];
  return {
    ok: true,
    summary: {
      businessName: set[0]?.name?.trim() || '(no business name set)',
      invoiceCount: cnt[0]?.c ?? 0,
      latestInvoiceDate: latest[0]?.d ?? null,
      expenseReportCount: expenseCount[0]?.c ?? 0,
      latestExpenseReportDate: latestExpense[0]?.d ?? null,
    },
  };
}
