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

export const MILEAGE_TABLES = [
  'mileage_year_counters', 'mileage_reports', 'mileage_trips',
] as const;

const MALFORMED_REASON = "This doesn't look like an Invoice Maker backup — it's missing expected data.";

export interface BackupSummary {
  businessName: string;
  invoiceCount: number; // finalized invoices
  latestInvoiceDate: string | null;
  expenseReportCount: number; // finalized expense reports
  latestExpenseReportDate: string | null;
  mileageReportCount: number; // finalized mileage reports
  latestMileageReportDate: string | null;
}

export interface BackupCheck {
  ok: boolean;
  reason?: string;
  summary?: BackupSummary;
}

/** Schema objects that migrations newer than some version will create. Names are lower-cased. */
export interface PendingMigrationObjects {
  /** Tables and indexes created by CREATE statements. */
  names: string[];
  /** Columns added to existing tables by ALTER TABLE … ADD COLUMN. */
  columns: Array<{ table: string; column: string }>;
}

const CREATES_OBJECT = /^\s*CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\s+(\w+)/i;
const ADDS_COLUMN = /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i;

/**
 * Objects the shipped migrations newer than `version` will create. A backup that
 * already contains any of them would make that migration fail with a duplicate
 * table/index/column on the next launch, leaving the app unable to open its data.
 */
export function pendingMigrationObjects(version: number): PendingMigrationObjects {
  const pending: PendingMigrationObjects = { names: [], columns: [] };
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    for (const statement of migration.statements) {
      const created = CREATES_OBJECT.exec(statement);
      if (created) pending.names.push(created[1].toLowerCase());
      const added = ADDS_COLUMN.exec(statement);
      if (added) pending.columns.push({ table: added[1].toLowerCase(), column: added[2].toLowerCase() });
    }
  }
  return pending;
}

interface ColumnShape {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const columnShape = (
  name: string, type: string, notnull: number, dflt_value: string | null, pk = 0,
): ColumnShape => ({ name, type, notnull, dflt_value, pk });

/**
 * Column shapes version 7 introduced. Defaults are compared as SQLite reports
 * them (`'general'`, `''`, `0`). Extra columns are tolerated so later additive
 * migrations keep validating; missing or reshaped ones are not.
 */
const V7_COLUMNS: Record<string, ColumnShape[]> = {
  expense_items: [columnShape('category', 'TEXT', 1, "'general'")],
  mileage_year_counters: [
    columnShape('year', 'INTEGER', 0, null, 1),
    columnShape('last_seq', 'INTEGER', 1, null),
  ],
  mileage_reports: [
    columnShape('id', 'INTEGER', 0, null, 1),
    columnShape('year', 'INTEGER', 1, null),
    columnShape('seq', 'INTEGER', 0, null),
    columnShape('status', 'TEXT', 1, "'draft'"),
    columnShape('report_date', 'TEXT', 1, "''"),
    columnShape('period_start', 'TEXT', 1, "''"),
    columnShape('period_end', 'TEXT', 1, "''"),
    columnShape('vehicle', 'TEXT', 1, "''"),
    columnShape('finalized_at', 'TEXT', 0, null),
    columnShape('total_km', 'INTEGER', 1, '0'),
    columnShape('snapshot_json', 'TEXT', 0, null),
  ],
  mileage_trips: [
    columnShape('id', 'INTEGER', 0, null, 1),
    columnShape('mileage_report_id', 'INTEGER', 1, null),
    columnShape('position', 'INTEGER', 1, '0'),
    columnShape('date', 'TEXT', 1, "''"),
    columnShape('from_place', 'TEXT', 1, "''"),
    columnShape('to_place', 'TEXT', 1, "''"),
    columnShape('purpose', 'TEXT', 1, "''"),
    columnShape('start_odometer_km', 'INTEGER', 0, null),
    columnShape('end_odometer_km', 'INTEGER', 0, null),
  ],
};

/**
 * PRAGMA table_info cannot see CHECK constraints, so the stored rows are checked
 * against them instead: each query counts rows the v7 constraints would reject.
 * Kilometres must be whole integers; blank odometers are NULL.
 */
const V7_INVALID_ROW_COUNTS = [
  `SELECT COUNT(*) AS c FROM expense_items
    WHERE category IS NULL OR category NOT IN ('vehicle','general')`,
  `SELECT COUNT(*) AS c FROM mileage_year_counters
    WHERE typeof(last_seq) <> 'integer' OR last_seq <= 0`,
  `SELECT COUNT(*) AS c FROM mileage_reports
    WHERE typeof(year) <> 'integer'
       OR (seq IS NOT NULL AND (typeof(seq) <> 'integer' OR seq <= 0))
       OR status IS NULL OR status NOT IN ('draft','finalized','void')
       OR typeof(total_km) <> 'integer' OR total_km < 0`,
  `SELECT COUNT(*) AS c FROM mileage_trips
    WHERE (start_odometer_km IS NOT NULL
           AND (typeof(start_odometer_km) <> 'integer' OR start_odometer_km < 0))
       OR (end_odometer_km IS NOT NULL
           AND (typeof(end_odometer_km) <> 'integer' OR end_odometer_km < 0))`,
];

async function hasColumns(db: Db, table: string, expected: ColumnShape[]): Promise<boolean> {
  const actual = await db.select<ColumnShape>(
    'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)',
    [table],
  );
  const byName = new Map(actual.map((row) => [row.name, row]));
  return expected.every((want) => {
    const got = byName.get(want.name);
    return got !== undefined
      && got.type === want.type
      && got.notnull === want.notnull
      && got.dflt_value === want.dflt_value
      && got.pk === want.pk;
  });
}

interface IndexShape {
  name: string;
  unique: number;
  partial: number;
  columns: string[];
}

async function indexShapes(db: Db, table: string): Promise<IndexShape[]> {
  const rows = await db.select<{
    index_name: string; is_unique: number; partial: number; column_name: string | null;
  }>(
    `SELECT il.name AS index_name, il."unique" AS is_unique, il.partial AS partial,
            ii.name AS column_name
       FROM pragma_index_list(?) AS il, pragma_index_info(il.name) AS ii
      ORDER BY il.name, ii.seqno`,
    [table],
  );
  const shapes = new Map<string, IndexShape>();
  for (const row of rows) {
    const shape = shapes.get(row.index_name)
      ?? { name: row.index_name, unique: row.is_unique, partial: row.partial, columns: [] };
    shape.columns.push(row.column_name ?? '');
    shapes.set(row.index_name, shape);
  }
  return [...shapes.values()];
}

const isFullIndexOn = (shape: IndexShape, unique: number, columns: string[]) =>
  shape.unique === unique && shape.partial === 0 && shape.columns.join() === columns.join();

/**
 * Version 7 objects the app relies on: the expense category column, the three
 * mileage tables, the unique (year, seq) numbering guarantee, the lookup
 * indexes, trips cascading with their report, and rows the CHECKs would accept.
 */
async function hasVersion7Schema(db: Db, tables: Set<string>): Promise<boolean> {
  if (MILEAGE_TABLES.some((table) => !tables.has(table))) return false;
  for (const [table, expected] of Object.entries(V7_COLUMNS)) {
    if (!(await hasColumns(db, table, expected))) return false;
  }

  const reportIndexes = await indexShapes(db, 'mileage_reports');
  const tripIndexes = await indexShapes(db, 'mileage_trips');
  const hasUniqueYearSeq = reportIndexes.some((index) => isFullIndexOn(index, 1, ['year', 'seq']));
  const hasReportLookup = reportIndexes.some((index) => index.name === 'idx_mileage_reports_year_status'
    && isFullIndexOn(index, 0, ['year', 'status', 'report_date']));
  const hasTripLookup = tripIndexes.some((index) => index.name === 'idx_mileage_trips_report'
    && isFullIndexOn(index, 0, ['mileage_report_id', 'position']));
  if (!hasUniqueYearSeq || !hasReportLookup || !hasTripLookup) return false;

  const foreignKeys = await db.select<{
    id: number; seq: number; table: string; from: string; to: string; on_delete: string;
  }>('PRAGMA foreign_key_list(mileage_trips)');
  const hasCascadingReportKey = foreignKeys.some(
    (foreignKey) => foreignKey.seq === 0
      && foreignKey.table === 'mileage_reports'
      && foreignKey.from === 'mileage_report_id'
      && foreignKey.to === 'id'
      && foreignKey.on_delete === 'CASCADE'
      && foreignKeys.filter((candidate) => candidate.id === foreignKey.id).length === 1,
  );
  if (!hasCascadingReportKey) return false;

  for (const sql of V7_INVALID_ROW_COUNTS) {
    const rows = await db.select<{ c: number }>(sql);
    if ((rows[0]?.c ?? 0) !== 0) return false;
  }
  return true;
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
  let objects: { type: string; name: string }[];
  try {
    objects = await db.select<{ type: string; name: string }>('SELECT type, name FROM sqlite_master');
  } catch {
    return { ok: false, reason: 'This file is not a readable database.' };
  }
  const names = new Set(objects.filter((o) => o.type === 'table').map((o) => o.name));
  if (REQUIRED_TABLES.some((t) => !names.has(t))) {
    return { ok: false, reason: MALFORMED_REASON };
  }

  // 3) A schema version this build understands (never import a newer schema).
  const verRows = await db.select<{ user_version: number }>('PRAGMA user_version');
  const schemaVersion = verRows[0]?.user_version ?? 0;
  if (schemaVersion > LATEST_SCHEMA_VERSION) {
    return { ok: false, reason: 'This backup is from a newer version of the app. Update Invoice Maker first, then restore.' };
  }

  // 4) Nothing a pending migration creates may already exist (SQLite names are
  //    case-insensitive), or the upgrade on the next launch would fail.
  const pending = pendingMigrationObjects(schemaVersion);
  const objectNames = new Set(objects.map((o) => o.name.toLowerCase()));
  if (pending.names.some((name) => objectNames.has(name))) {
    return { ok: false, reason: MALFORMED_REASON };
  }
  for (const { table, column } of pending.columns) {
    const existing = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table]);
    if (existing.some((row) => row.name.toLowerCase() === column)) {
      return { ok: false, reason: MALFORMED_REASON };
    }
  }

  // 5) Everything the claimed version created is present and usable.
  const hasExpenseSchema = schemaVersion >= 4;
  if (hasExpenseSchema && EXPENSE_TABLES.some((table) => !names.has(table))) {
    return { ok: false, reason: MALFORMED_REASON };
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
      return { ok: false, reason: MALFORMED_REASON };
    }
  }
  if (schemaVersion >= 6) {
    const invoiceColumns = await db.select<{
      name: string; type: string; notnull: number; dflt_value: string | null;
    }>("SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('invoices')");
    const revisionColumn = invoiceColumns.find((column) => column.name === 'draft_revision');
    if (
      revisionColumn?.type !== 'INTEGER'
      || revisionColumn.notnull !== 1
      || revisionColumn.dflt_value !== '0'
    ) {
      return { ok: false, reason: MALFORMED_REASON };
    }
  }
  const hasMileageSchema = schemaVersion >= 7;
  if (hasMileageSchema && !(await hasVersion7Schema(db, names))) {
    return { ok: false, reason: MALFORMED_REASON };
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
  const mileageCount = hasMileageSchema
    ? await db.select<{ c: number }>("SELECT COUNT(*) AS c FROM mileage_reports WHERE status = 'finalized'")
    : [{ c: 0 }];
  const latestMileage = hasMileageSchema
    ? await db.select<{ d: string | null }>("SELECT MAX(report_date) AS d FROM mileage_reports WHERE status = 'finalized'")
    : [{ d: null }];
  return {
    ok: true,
    summary: {
      businessName: set[0]?.name?.trim() || '(no business name set)',
      invoiceCount: cnt[0]?.c ?? 0,
      latestInvoiceDate: latest[0]?.d ?? null,
      expenseReportCount: expenseCount[0]?.c ?? 0,
      latestExpenseReportDate: latestExpense[0]?.d ?? null,
      mileageReportCount: mileageCount[0]?.c ?? 0,
      latestMileageReportDate: latestMileage[0]?.d ?? null,
    },
  };
}
