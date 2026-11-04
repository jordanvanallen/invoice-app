import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './schema';
import { runInTransaction, type Db, type DbResult, type DbStatement } from './db';

function withoutSqlTransactions(db: Db): Db {
  return {
    async execute(sql: string, params: unknown[] = []): Promise<DbResult> {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        throw new Error(`raw transaction command is not supported: ${sql}`);
      }
      return db.execute(sql, params);
    },
    select: db.select.bind(db),
  };
}

type TestDb = Awaited<ReturnType<typeof createSqlJsDb>>;

const VERSION_7 = MIGRATIONS.find((migration) => migration.version === 7)!;

async function tableNames(db: TestDb): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

/** Apply exactly the shipped migrations up to `version`, as an older build would have. */
async function migrateThrough(db: TestDb, version: number) {
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= version)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
}

async function userVersion(db: Db): Promise<number> {
  return (await db.select<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
}

/** Every row of every table (including sqlite_sequence), keyed by table name. */
async function dumpTables(db: TestDb): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const name of await tableNames(db)) {
    dump[name] = await db.select(`SELECT * FROM "${name}" ORDER BY rowid`);
  }
  return dump;
}

async function schemaObjects(db: TestDb) {
  return db.select('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name');
}

/** Mirrors the production adapter: every migration arrives as one native atomic batch. */
function withAtomicBatch(inner: TestDb, onBatch: () => void = () => {}): Db {
  return {
    execute: inner.execute.bind(inner),
    select: inner.select.bind(inner),
    async executeTransaction(statements: DbStatement[]) {
      onBatch();
      const results: DbResult[] = [];
      await runInTransaction(inner, async () => {
        for (const statement of statements) {
          const result = await inner.execute(statement.sql, statement.params ?? []);
          if (
            statement.expectedRowsAffected !== undefined &&
            result.rowsAffected !== statement.expectedRowsAffected
          ) {
            throw new Error(
              `Expected ${statement.expectedRowsAffected} row(s) affected; affected ${result.rowsAffected}.`,
            );
          }
          results.push(result);
        }
      });
      return results;
    },
  };
}

/** A version-6 database holding every kind of record a real user has before v7. */
async function populatedVersion6(): Promise<TestDb> {
  const db = await createSqlJsDb();
  await migrateThrough(db, 6);
  for (const sql of [
    "UPDATE settings SET inspector_name = 'Jane Tester', logo_data_url = 'data:image/png;base64,AAAA' WHERE id = 1",
    "INSERT INTO clients (id, name, name_key) VALUES (1, 'Globex', 'globex')",
    "INSERT INTO locations (id, name) VALUES (1, 'North Yard')",
    "INSERT INTO approvers (id, name, name_key) VALUES (1, 'Pat Approver', 'pat approver')",
    'INSERT INTO year_counters (year, last_seq) VALUES (2026, 8)',
    `INSERT INTO invoices
       (id, year, seq, status, issue_date, period_start, period_end, finalized_at,
        subtotal_cents, tax_cents, total_cents, snapshot_json, draft_revision)
     VALUES
       (1, 2026, 8, 'finalized', '2026-07-13', '2026-07-06', '2026-07-12', '2026-07-13T10:00:00Z',
        3800, 494, 4294, '{"invoiceNumber":"8-2026"}', 0),
       (2, 2026, NULL, 'draft', '2026-07-20', '2026-07-13', '2026-07-19', NULL, 0, 0, 0, NULL, 3)`,
    `INSERT INTO line_items
       (id, invoice_id, type, position, inspection_number, client_id, client_name, location_id,
        location, date, vin8, mileage_cents, fee_cents, mileage_approver_id, mileage_approver_name,
        mileage_approval_date)
     VALUES
       (1, 1, 'completed', 0, '12345678', 1, 'Globex', 1, 'North Yard', '2026-07-07', 'ABCD1234',
        1250, 3800, 1, 'Pat Approver', '2026-07-08'),
       (2, 1, 'noshow', 0, '', 1, 'Globex', 1, 'North Yard', '2026-07-08', '', 0, 2500, NULL, '', '')`,
    'INSERT INTO expense_year_counters (year, last_seq) VALUES (2026, 2)',
    `INSERT INTO expense_reports
       (id, year, seq, status, report_date, period_start, period_end, finalized_at, total_cents,
        snapshot_json)
     VALUES
       (1, 2026, 1, 'finalized', '2026-07-01', '2026-06-01', '2026-06-30', '2026-07-01T09:00:00Z',
        7099, '{"reportNumber":"1-2026","items":[{"description":"Fuel","amountCents":4500}]}'),
       (2, 2026, 2, 'void', '2026-07-02', '', '', '2026-07-02T09:00:00Z', 1000,
        '{"reportNumber":"2-2026"}'),
       (3, 2026, NULL, 'draft', '2026-07-03', '', '', NULL, 0, NULL)`,
    `INSERT INTO expense_items (id, expense_report_id, position, date, description, amount_cents)
     VALUES (1, 1, 0, '2026-06-05', 'Fuel', 4500), (2, 1, 1, '2026-06-06', 'Printer paper', 2599),
            (3, 2, 0, '2026-06-07', 'Parking', 1000), (4, 3, 0, '', 'Unfinished draft row', 0)`,
  ]) {
    await db.execute(sql);
  }
  return db;
}

describe('runMigrations', () => {
  test('creates all tables and sets user_version', async () => {
    const db = await createSqlJsDb();
    const version = await runMigrations(db);
    expect(version).toBe(7);
    const names = await tableNames(db);
    for (const t of ['settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items']) {
      expect(names).toContain(t);
    }
    for (const t of ['expense_year_counters', 'expense_reports', 'expense_items']) {
      expect(names).toContain(t);
    }
    expect(names).toContain('approvers');
    for (const t of ['mileage_year_counters', 'mileage_reports', 'mileage_trips']) {
      expect(names).toContain(t);
    }
    const uv = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(uv[0].user_version).toBe(7);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
    // v2 added the logo column
    const cols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('settings')");
    expect(cols.map((c) => c.name)).toContain('logo_data_url');
    const clientCols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('clients')");
    expect(clientCols.map((c) => c.name)).toContain('name_key');
    const invoiceCols = await db.select<{
      name: string; type: string; notnull: number; dflt_value: string | null;
    }>("SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('invoices')");
    expect(invoiceCols).toContainEqual({
      name: 'draft_revision', type: 'INTEGER', notnull: 1, dflt_value: '0',
    });
    const lineItemCols = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('line_items')",
    );
    expect(lineItemCols.map((row) => row.name)).toEqual(expect.arrayContaining([
      'mileage_approver_id', 'mileage_approver_name', 'mileage_approval_date',
    ]));
    const indexes = await db.select<{ name: string; unique: number }>('PRAGMA index_list(approvers)');
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'idx_approvers_name_key', unique: 1 }),
    ]));
    const fks = await db.select<{ table: string; from: string; to: string }>(
      'PRAGMA foreign_key_list(line_items)',
    );
    expect(fks).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'approvers', from: 'mileage_approver_id', to: 'id' }),
    ]));
  });

  test('migrates a version-4 database without changing existing invoice or line-item data', async () => {
    const db = await createSqlJsDb();
    await migrateThrough(db, 4);
    await db.execute(
      "INSERT INTO invoices (id, year, seq, status, issue_date) VALUES (1, 2026, 9, 'finalized', '2026-07-01')",
    );
    await db.execute(
      `INSERT INTO line_items
         (id, invoice_id, type, position, inspection_number, client_name, location,
          date, vin8, mileage_cents, fee_cents)
       VALUES (1, 1, 'completed', 3, '87654321', 'Existing Client', 'Existing Location',
               '2026-06-30', 'ABCD1234', 1250, 3800)`,
    );

    await expect(runMigrations(db)).resolves.toBe(7);

    expect(await db.select('SELECT year, seq, issue_date FROM invoices')).toEqual([
      { year: 2026, seq: 9, issue_date: '2026-07-01' },
    ]);
    expect(await db.select('SELECT id, draft_revision FROM invoices')).toEqual([
      { id: 1, draft_revision: 0 },
    ]);
    expect(await db.select(`SELECT invoice_id, position, inspection_number, mileage_cents,
      fee_cents, mileage_approver_id, mileage_approver_name, mileage_approval_date
      FROM line_items`)).toEqual([{
      invoice_id: 1,
      position: 3,
      inspection_number: '87654321',
      mileage_cents: 1250,
      fee_cents: 3800,
      mileage_approver_id: null,
      mileage_approver_name: '',
      mileage_approval_date: '',
    }]);
  });

  test('migrates populated version-5 invoices to revision zero without changing data', async () => {
    const db = await createSqlJsDb();
    await migrateThrough(db, 5);
    await db.execute(
      `INSERT INTO invoices
         (id, year, seq, status, issue_date, period_start, period_end, total_cents)
       VALUES (1, 2026, NULL, 'draft', '2026-07-20', '2026-07-13', '2026-07-19', 0)`,
    );
    await db.execute(
      `INSERT INTO invoices
         (id, year, seq, status, issue_date, period_start, period_end, total_cents)
       VALUES (2, 2026, 8, 'finalized', '2026-07-13', '2026-07-06', '2026-07-12', 4294)`,
    );

    await expect(runMigrations(db)).resolves.toBe(7);

    expect(await db.select(
      `SELECT id, year, seq, status, issue_date, period_start, period_end,
              total_cents, draft_revision
         FROM invoices ORDER BY id`,
    )).toEqual([
      {
        id: 1, year: 2026, seq: null, status: 'draft', issue_date: '2026-07-20',
        period_start: '2026-07-13', period_end: '2026-07-19', total_cents: 0,
        draft_revision: 0,
      },
      {
        id: 2, year: 2026, seq: 8, status: 'finalized', issue_date: '2026-07-13',
        period_start: '2026-07-06', period_end: '2026-07-12', total_cents: 4294,
        draft_revision: 0,
      },
    ]);
  });

  test('backfills client name keys and enforces case-insensitive uniqueness', async () => {
    const db = await createSqlJsDb();
    await migrateThrough(db, 2);
    await db.execute("INSERT INTO clients (name) VALUES ('Globex Finance Group')");
    await db.execute("INSERT INTO clients (name) VALUES ('globex finance group')");

    await runMigrations(db);

    const rows = await db.select<{ name: string; name_key: string }>('SELECT name, name_key FROM clients ORDER BY id');
    expect(rows[0]).toEqual({ name: 'Globex Finance Group', name_key: 'globex finance group' });
    expect(rows[1].name_key).toMatch(/^globex finance group#/);

    await expect(
      db.execute("INSERT INTO clients (name, name_key) VALUES ('GLOBEX FINANCE GROUP', 'globex finance group')"),
    ).rejects.toThrow();
  });

  test('is idempotent — running twice does not error or duplicate', async () => {
    const db = await createSqlJsDb();
    await runMigrations(db);
    const schema = await schemaObjects(db);
    await expect(runMigrations(db)).resolves.toBe(7);
    const s = await db.select<{ c: number }>('SELECT COUNT(*) AS c FROM settings');
    expect(s[0].c).toBe(1);
    expect(await schemaObjects(db)).toEqual(schema);
  });

  test('runs on adapters that do not support raw transaction commands', async () => {
    const db = withoutSqlTransactions(await createSqlJsDb());
    await expect(runMigrations(db)).resolves.toBe(7);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
  });

  test('uses the adapter atomic batch for every production migration', async () => {
    const inner = await createSqlJsDb();
    let batches = 0;
    const db = withAtomicBatch(inner, () => { batches += 1; });

    await runMigrations(db);

    expect(batches).toBe(MIGRATIONS.length);
    expect(await userVersion(inner)).toBe(7);
  });
});

describe('version 7: expense categories and car mileage reports', () => {
  test('creates the exact expense category and mileage schema contract', async () => {
    const db = await createSqlJsDb();
    await runMigrations(db);
    const columns = (table: string) => db.select(
      `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`,
    );
    const col = (name: string, type: string, notnull: number, dflt_value: string | null, pk = 0) =>
      ({ name, type, notnull, dflt_value, pk });

    expect(await columns('expense_items')).toContainEqual(col('category', 'TEXT', 1, "'general'"));
    expect(await columns('mileage_year_counters')).toEqual([
      col('year', 'INTEGER', 0, null, 1),
      col('last_seq', 'INTEGER', 1, null),
    ]);
    expect(await columns('mileage_reports')).toEqual([
      col('id', 'INTEGER', 0, null, 1),
      col('year', 'INTEGER', 1, null),
      col('seq', 'INTEGER', 0, null),
      col('status', 'TEXT', 1, "'draft'"),
      col('report_date', 'TEXT', 1, "''"),
      col('period_start', 'TEXT', 1, "''"),
      col('period_end', 'TEXT', 1, "''"),
      col('vehicle', 'TEXT', 1, "''"),
      col('finalized_at', 'TEXT', 0, null),
      col('total_km', 'INTEGER', 1, '0'),
      col('snapshot_json', 'TEXT', 0, null),
    ]);
    expect(await columns('mileage_trips')).toEqual([
      col('id', 'INTEGER', 0, null, 1),
      col('mileage_report_id', 'INTEGER', 1, null),
      col('position', 'INTEGER', 1, '0'),
      col('date', 'TEXT', 1, "''"),
      col('from_place', 'TEXT', 1, "''"),
      col('to_place', 'TEXT', 1, "''"),
      col('purpose', 'TEXT', 1, "''"),
      col('start_odometer_km', 'INTEGER', 0, null),
      col('end_odometer_km', 'INTEGER', 0, null),
    ]);

    const indexColumns = async (index: string) => (await db.select<{ name: string }>(
      `SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`,
    )).map((row) => row.name);
    expect(await indexColumns('idx_mileage_reports_year_status')).toEqual(['year', 'status', 'report_date']);
    expect(await indexColumns('idx_mileage_trips_report')).toEqual(['mileage_report_id', 'position']);
    const reportIndexes = await db.select<{ name: string; unique: number; origin: string }>(
      'PRAGMA index_list(mileage_reports)',
    );
    const uniqueConstraint = reportIndexes.find((index) => index.origin === 'u');
    expect(uniqueConstraint?.unique).toBe(1);
    expect(await indexColumns(uniqueConstraint!.name)).toEqual(['year', 'seq']);
    expect(await db.select('PRAGMA foreign_key_list(mileage_trips)')).toEqual([
      expect.objectContaining({
        table: 'mileage_reports', from: 'mileage_report_id', to: 'id', on_delete: 'CASCADE',
      }),
    ]);
  });

  test('upgrades a populated version-6 database without changing any existing record', async () => {
    const db = await populatedVersion6();
    const before = await dumpTables(db);

    await expect(runMigrations(db)).resolves.toBe(7);

    const after = await dumpTables(db);
    for (const [table, rows] of Object.entries(before)) {
      if (table === 'expense_items') continue;
      expect(after[table], table).toEqual(rows);
    }
    // Existing expense rows keep every value and land in General; finalized
    // snapshots (what reprints use) are untouched above.
    expect(after.expense_items).toEqual(
      before.expense_items.map((row) => ({ ...(row as object), category: 'general' })),
    );
    expect(after.mileage_year_counters).toEqual([]);
    expect(after.mileage_reports).toEqual([]);
    expect(after.mileage_trips).toEqual([]);
  });

  test('enforces vehicle and general as the only expense categories after the upgrade', async () => {
    const db = await populatedVersion6();
    await runMigrations(db);

    await db.execute(
      "INSERT INTO expense_items (id, expense_report_id, description) VALUES (10, 3, 'Defaulted')",
    );
    await db.execute(
      "INSERT INTO expense_items (id, expense_report_id, description, category) VALUES (11, 3, 'Oil change', 'vehicle')",
    );
    expect(await db.select('SELECT id, category FROM expense_items WHERE id >= 10 ORDER BY id')).toEqual([
      { id: 10, category: 'general' },
      { id: 11, category: 'vehicle' },
    ]);
    await db.execute("UPDATE expense_items SET category = 'vehicle' WHERE id = 4");

    for (const sql of [
      "INSERT INTO expense_items (expense_report_id, category) VALUES (3, 'fuel')",
      "INSERT INTO expense_items (expense_report_id, category) VALUES (3, 'Vehicle')",
      "INSERT INTO expense_items (expense_report_id, category) VALUES (3, '')",
      'INSERT INTO expense_items (expense_report_id, category) VALUES (3, NULL)',
      "UPDATE expense_items SET category = 'other' WHERE id = 1",
    ]) {
      await expect(db.execute(sql), sql).rejects.toThrow(/constraint/i);
    }
    expect(await db.select('SELECT category FROM expense_items WHERE id = 1')).toEqual([{ category: 'general' }]);
  });

  test('enforces mileage numbering, whole-kilometre, and cascade rules', async () => {
    const db = await populatedVersion6();
    await runMigrations(db);

    for (const sql of [
      'INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 1)',
      `INSERT INTO mileage_reports (id, year, seq, status, report_date, vehicle, total_km)
       VALUES (1, 2026, 1, 'finalized', '2026-07-31', 'Blue Civic', 120)`,
      // Drafts share a year with no number yet; sequences repeat across years.
      "INSERT INTO mileage_reports (id, year) VALUES (2, 2026)",
      "INSERT INTO mileage_reports (id, year) VALUES (3, 2026)",
      "INSERT INTO mileage_reports (id, year, seq, status) VALUES (4, 2027, 1, 'finalized')",
      // Blank odometers are NULL, zero is a real reading, and drafts may be inverted mid-entry.
      'INSERT INTO mileage_trips (id, mileage_report_id, position) VALUES (1, 2, 0)',
      'INSERT INTO mileage_trips (id, mileage_report_id, position, start_odometer_km, end_odometer_km) VALUES (2, 2, 1, 0, 0)',
      'INSERT INTO mileage_trips (id, mileage_report_id, position, start_odometer_km, end_odometer_km) VALUES (3, 2, 2, 900, 850)',
      'INSERT INTO mileage_trips (id, mileage_report_id, position, start_odometer_km, end_odometer_km) VALUES (4, 1, 0, 1000, 1120)',
    ]) {
      await db.execute(sql);
    }
    expect(await db.select('SELECT id, start_odometer_km, end_odometer_km FROM mileage_trips WHERE id <= 2 ORDER BY id')).toEqual([
      { id: 1, start_odometer_km: null, end_odometer_km: null },
      { id: 2, start_odometer_km: 0, end_odometer_km: 0 },
    ]);
    expect(await db.select("SELECT status, report_date, vehicle, total_km, seq FROM mileage_reports WHERE id = 2")).toEqual([
      { status: 'draft', report_date: '', vehicle: '', total_km: 0, seq: null },
    ]);

    for (const sql of [
      'INSERT INTO mileage_year_counters (year, last_seq) VALUES (2028, 0)',
      'INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 2)',
      "INSERT INTO mileage_reports (year, seq, status) VALUES (2026, 1, 'finalized')",
      "INSERT INTO mileage_reports (year, seq) VALUES (2026, 0)",
      "INSERT INTO mileage_reports (year, status) VALUES (2026, 'archived')",
      'INSERT INTO mileage_reports (year, total_km) VALUES (2026, -1)',
      'INSERT INTO mileage_reports (year, vehicle) VALUES (2026, NULL)',
      'INSERT INTO mileage_reports (seq) VALUES (5)',
      'INSERT INTO mileage_trips (mileage_report_id, start_odometer_km) VALUES (2, -1)',
      'INSERT INTO mileage_trips (mileage_report_id, end_odometer_km) VALUES (2, -1)',
      'INSERT INTO mileage_trips (mileage_report_id) VALUES (999)',
      'INSERT INTO mileage_trips (mileage_report_id) VALUES (NULL)',
    ]) {
      await expect(db.execute(sql), sql).rejects.toThrow(/constraint/i);
    }

    await db.execute('DELETE FROM mileage_reports WHERE id = 2');
    expect(await db.select('SELECT id FROM mileage_trips ORDER BY id')).toEqual([{ id: 4 }]);
  });

  test.each([
    ['raw SQL transaction', (db: TestDb): Db => db],
    ['native-style atomic batch', (db: TestDb): Db => withAtomicBatch(db)],
  ])('rolls back every version-7 change when its last statement fails (%s)', async (_label, adapt) => {
    // A pre-existing object named like the LAST v7 statement lets every earlier
    // v7 statement succeed before the failure, proving the whole batch reverts.
    expect(VERSION_7.statements.at(-1)).toMatch(/^CREATE INDEX idx_mileage_trips_report\b/);
    const db = await populatedVersion6();
    await db.execute('CREATE INDEX idx_mileage_trips_report ON expense_items(position)');
    const rows = await dumpTables(db);
    const schema = await schemaObjects(db);

    await expect(runMigrations(adapt(db))).rejects.toThrow(/already exists/i);

    expect(await userVersion(db)).toBe(6);
    expect(await schemaObjects(db)).toEqual(schema);
    expect(await dumpTables(db)).toEqual(rows);

    // With the conflict removed, the same upgrade completes on the next launch.
    await db.execute('DROP INDEX idx_mileage_trips_report');
    await expect(runMigrations(adapt(db))).resolves.toBe(7);
  });
});
