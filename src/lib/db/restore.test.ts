import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { validateBackup, pendingMigrationObjects, LATEST_SCHEMA_VERSION } from './restore';
import { MIGRATIONS } from './schema';

type TestDb = Awaited<ReturnType<typeof createSqlJsDb>>;

const MALFORMED = /missing expected data/i;
const VERSION_7 = MIGRATIONS.find((migration) => migration.version === 7)!;

async function goodDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

/** A genuine database at `version`: exactly the shipped migrations up to it. */
async function migratedThrough(version: number) {
  const db = await createSqlJsDb();
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= version)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
  return db;
}

/**
 * A version-6 database upgraded with a hand-altered copy of the v7 statements and
 * stamped as v7. `alter` returns the statement to run, or null to skip it; the
 * fixture fails loudly if no statement changed so a case can never go vacuous.
 */
async function alteredVersion7(alter: (sql: string) => string | null) {
  const db = await migratedThrough(6);
  let altered = false;
  for (const statement of VERSION_7.statements) {
    const replacement = alter(statement);
    if (replacement !== statement) altered = true;
    if (replacement !== null) await db.execute(replacement);
  }
  if (!altered) throw new Error('fixture did not alter any version-7 statement');
  await db.execute('PRAGMA user_version = 7');
  return db;
}

/** Version 7 with every v7 CHECK removed, as PRAGMA table_info cannot tell the difference. */
const withoutV7Checks = (sql: string) => sql.replace(/\s+CHECK \((?:[^()]|\([^()]*\))*\)/g, '');

async function userVersion(db: TestDb) {
  return (await db.select<{ user_version: number }>('PRAGMA user_version'))[0].user_version;
}

async function expectMalformed(db: TestDb) {
  const check = await validateBackup(db);
  expect(check.ok).toBe(false);
  expect(check.reason).toMatch(MALFORMED);
}

describe('validateBackup', () => {
  test('accepts a real Invoice Maker database and summarizes it', async () => {
    const db = await goodDb();
    await db.execute("UPDATE settings SET inspector_name = 'Jane Tester' WHERE id = 1");
    await db.execute(
      "INSERT INTO invoices (year, seq, status, issue_date) VALUES (2026, 1, 'finalized', '2026-06-10')",
    );
    await db.execute(
      "INSERT INTO invoices (year, status, issue_date) VALUES (2026, 'draft', '2026-06-12')",
    );
    await db.execute(
      "INSERT INTO expense_reports (year, seq, status, report_date) VALUES (2026, 2, 'finalized', '2026-06-11')",
    );
    await db.execute(
      "INSERT INTO expense_reports (year, status, report_date) VALUES (2026, 'draft', '2026-06-12')",
    );
    await db.execute(
      "INSERT INTO mileage_reports (year, seq, status, report_date) VALUES (2026, 1, 'finalized', '2026-06-08')",
    );
    await db.execute(
      "INSERT INTO mileage_reports (year, seq, status, report_date) VALUES (2026, 2, 'finalized', '2026-06-09')",
    );
    await db.execute(
      "INSERT INTO mileage_reports (year, seq, status, report_date) VALUES (2026, 3, 'void', '2026-06-20')",
    );
    await db.execute(
      "INSERT INTO mileage_reports (year, status, report_date) VALUES (2026, 'draft', '2026-06-21')",
    );
    const check = await validateBackup(db);
    expect(check.ok).toBe(true);
    expect(check.summary?.businessName).toBe('Jane Tester');
    expect(check.summary?.invoiceCount).toBe(1); // only the finalized one
    expect(check.summary?.latestInvoiceDate).toBe('2026-06-10');
    expect(check.summary?.expenseReportCount).toBe(1);
    expect(check.summary?.latestExpenseReportDate).toBe('2026-06-11');
    expect(check.summary?.mileageReportCount).toBe(2); // cancelled and draft reports excluded
    expect(check.summary?.latestMileageReportDate).toBe('2026-06-09');
  });

  test('accepts a valid pre-expense version-3 backup with an empty expense summary', async () => {
    const db = await migratedThrough(3);

    const check = await validateBackup(db);

    expect(check.ok).toBe(true);
    expect(check.summary?.expenseReportCount).toBe(0);
    expect(check.summary?.latestExpenseReportDate).toBeNull();
    expect(check.summary?.mileageReportCount).toBe(0);
    expect(check.summary?.latestMileageReportDate).toBeNull();
  });

  test.each([2, 3, 4, 5, 6])(
    'accepts a populated genuine version-%i backup that upgrades to a valid current database',
    async (version) => {
      const db = await migratedThrough(version);
      await db.execute(
        "INSERT INTO invoices (id, year, seq, status, issue_date) VALUES (1, 2026, 4, 'finalized', '2026-05-01')",
      );
      if (version >= 4) {
        await db.execute(
          `INSERT INTO expense_reports (id, year, seq, status, report_date, total_cents)
           VALUES (1, 2026, 1, 'finalized', '2026-05-02', 2599)`,
        );
        await db.execute(
          "INSERT INTO expense_items (expense_report_id, description, amount_cents) VALUES (1, 'Fuel', 2599)",
        );
      }

      const before = await validateBackup(db);
      expect(before.ok).toBe(true);
      expect(before.summary?.invoiceCount).toBe(1);
      expect(before.summary?.expenseReportCount).toBe(version >= 4 ? 1 : 0);
      expect(before.summary?.mileageReportCount).toBe(0);
      expect(before.summary?.latestMileageReportDate).toBeNull();

      await expect(runMigrations(db)).resolves.toBe(LATEST_SCHEMA_VERSION);
      expect((await validateBackup(db)).ok).toBe(true);
      if (version >= 4) {
        expect(await db.select('SELECT description, amount_cents, category FROM expense_items')).toEqual([
          { description: 'Fuel', amount_cents: 2599, category: 'general' },
        ]);
      }
    },
  );

  test('rejects a version-4 backup that is missing expense tables', async () => {
    const db = await migratedThrough(4);
    await db.execute('DROP TABLE expense_items');

    await expectMalformed(db);
  });

  test('accepts v4 without approvers but rejects a partial v5 schema', async () => {
    const old = await migratedThrough(4);
    expect((await validateBackup(old)).ok).toBe(true);

    const malformed = await migratedThrough(5);
    await malformed.execute('DROP INDEX idx_approvers_name_key');
    await expectMalformed(malformed);
  });

  test('rejects a v5 backup with a dangling approver reference', async () => {
    const db = await migratedThrough(5);
    await db.execute('PRAGMA foreign_keys = OFF');
    await db.execute("INSERT INTO invoices (id, year, status) VALUES (1, 2026, 'draft')");
    await db.execute(
      "INSERT INTO line_items (invoice_id, type, mileage_approver_id) VALUES (1, 'completed', 999)",
    );
    await db.execute('PRAGMA foreign_keys = ON');
    await expectMalformed(db);
  });

  test('rejects a v5 backup with a partial approver name-key index', async () => {
    const db = await migratedThrough(5);
    await db.execute('DROP INDEX idx_approvers_name_key');
    await db.execute(
      'CREATE UNIQUE INDEX idx_approvers_name_key ON approvers(name_key) WHERE active = 1',
    );

    await expectMalformed(db);
  });

  test('rejects a v5 backup where the approver reference is one leg of a composite foreign key', async () => {
    const db = await migratedThrough(5);
    await db.execute('PRAGMA foreign_keys = OFF');
    await db.execute('DROP TABLE line_items');
    await db.execute('CREATE UNIQUE INDEX idx_approvers_composite_fk ON approvers(id, name_key)');
    await db.execute(`CREATE TABLE line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mileage_approver_id INTEGER,
      mileage_approver_name TEXT NOT NULL DEFAULT '',
      mileage_approval_date TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (mileage_approver_id, mileage_approver_name)
        REFERENCES approvers(id, name_key)
    )`);
    await db.execute('PRAGMA foreign_keys = ON');

    await expectMalformed(db);
  });

  test('accepts genuine v5 without a revision but rejects v6 missing the revision column', async () => {
    const db = await migratedThrough(5);
    expect((await validateBackup(db)).ok).toBe(true);

    await db.execute('PRAGMA user_version = 6');
    await expectMalformed(db);
  });

  test('rejects a backup claiming v5 when it already contains the v6 revision column', async () => {
    const db = await migratedThrough(5);
    await db.execute(
      'ALTER TABLE invoices ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0',
    );

    await expectMalformed(db);
  });

  test('rejects v6 when the revision column has the wrong default', async () => {
    const db = await migratedThrough(5);
    await db.execute(
      'ALTER TABLE invoices ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1',
    );
    await db.execute('PRAGMA user_version = 6');

    await expectMalformed(db);
  });

  test('rejects a database missing our tables (some other app)', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    const check = await validateBackup(db);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Invoice Maker backup/i);
  });

  test('rejects an empty database', async () => {
    const db = await createSqlJsDb();
    const check = await validateBackup(db);
    expect(check.ok).toBe(false);
  });

  test('rejects a backup from a newer schema version', async () => {
    const db = await goodDb();
    await db.execute(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    const check = await validateBackup(db);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/newer version/i);
  });
});

describe('pendingMigrationObjects', () => {
  test('recognizes every table, index, and column a shipped migration creates', () => {
    const ddl = MIGRATIONS
      .flatMap((migration) => migration.statements)
      .filter((sql) => /^\s*(CREATE|ALTER)\b/i.test(sql));
    const pending = pendingMigrationObjects(0);

    expect(pending.names.length + pending.columns.length).toBe(ddl.length);
  });

  test('lists exactly the version-7 objects for a version-6 backup and nothing at the latest version', () => {
    expect(pendingMigrationObjects(6)).toEqual({
      names: [
        'mileage_year_counters', 'mileage_reports', 'mileage_trips',
        'idx_mileage_reports_year_status', 'idx_mileage_trips_report',
      ],
      columns: [{ table: 'expense_items', column: 'category' }],
    });
    expect(pendingMigrationObjects(LATEST_SCHEMA_VERSION)).toEqual({ names: [], columns: [] });
  });
});

describe('validateBackup — version 7 upgrade safety', () => {
  test.each([
    ['the expense category column', "ALTER TABLE expense_items ADD COLUMN category TEXT NOT NULL DEFAULT 'general'"],
    ['a differently-cased category column', 'ALTER TABLE expense_items ADD COLUMN Category TEXT'],
    ['the mileage counters table', 'CREATE TABLE mileage_year_counters (year INTEGER PRIMARY KEY, last_seq INTEGER NOT NULL)'],
    ['the mileage reports table', 'CREATE TABLE mileage_reports (id INTEGER PRIMARY KEY)'],
    ['the mileage trips table', 'CREATE TABLE mileage_trips (id INTEGER PRIMARY KEY)'],
    ['a differently-cased mileage table', 'CREATE TABLE Mileage_Reports (id INTEGER PRIMARY KEY)'],
    ['a view named like a mileage table', 'CREATE VIEW mileage_trips AS SELECT id FROM invoices'],
    ['a mileage index name on another table', 'CREATE INDEX idx_mileage_trips_report ON expense_items(position)'],
  ])('rejects a version-6 backup that already contains %s, which would fail to upgrade', async (_label, sql) => {
    const db = await migratedThrough(6);
    await db.execute(sql);

    await expectMalformed(db);

    // The rejection is real: this file would fail its upgrade on every launch.
    await expect(runMigrations(db)).rejects.toThrow();
    expect(await userVersion(db)).toBe(6);
  });

  test('rejects an older version-4 backup that already contains a mileage table', async () => {
    const db = await migratedThrough(4);
    await db.execute('CREATE TABLE mileage_trips (id INTEGER PRIMARY KEY)');

    await expectMalformed(db);
    await expect(runMigrations(db)).rejects.toThrow();
  });

  test('rejects a partially applied version-7 upgrade whether it claims version 6 or 7', async () => {
    const [category, counters] = VERSION_7.statements;
    const stillSix = await migratedThrough(6);
    await stillSix.execute(category);
    await stillSix.execute(counters);
    await expectMalformed(stillSix);

    const claimsSeven = await migratedThrough(6);
    await claimsSeven.execute(category);
    await claimsSeven.execute(counters);
    await claimsSeven.execute('PRAGMA user_version = 7');
    await expectMalformed(claimsSeven);
  });

  test('rejects a version-6 file stamped as version 7 without any version-7 objects', async () => {
    const db = await migratedThrough(6);
    await db.execute('PRAGMA user_version = 7');

    await expectMalformed(db);
  });

  test('accepts a populated version-7 backup with drafts, blank and zero odometers, and inverted draft trips', async () => {
    const db = await goodDb();
    await db.execute(
      "INSERT INTO expense_reports (id, year, seq, status, report_date) VALUES (1, 2026, 1, 'finalized', '2026-07-01')",
    );
    await db.execute(
      "INSERT INTO expense_items (expense_report_id, category, amount_cents) VALUES (1, 'vehicle', 4500), (1, 'general', 1299)",
    );
    await db.execute('INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 1)');
    await db.execute(
      `INSERT INTO mileage_reports (id, year, seq, status, report_date, vehicle, total_km)
       VALUES (1, 2026, 1, 'finalized', '2026-07-02', 'Blue Civic', 42),
              (2, 2026, NULL, 'draft', '2026-07-03', '', 0),
              (3, 2026, NULL, 'draft', '', '', 0)`,
    );
    await db.execute(
      `INSERT INTO mileage_trips (mileage_report_id, position, start_odometer_km, end_odometer_km)
       VALUES (1, 0, 0, 42), (2, 0, NULL, NULL), (2, 1, 900, 850)`,
    );

    const check = await validateBackup(db);

    expect(check.ok).toBe(true);
    expect(check.summary?.mileageReportCount).toBe(1);
    expect(check.summary?.latestMileageReportDate).toBe('2026-07-02');
  });

  test.each([
    ['no category column', (sql: string) => (sql.startsWith('ALTER TABLE expense_items') ? null : sql)],
    ['a nullable category', (sql: string) => sql.replace('category TEXT NOT NULL', 'category TEXT')],
    ['a category defaulting to vehicle', (sql: string) => sql.replace("DEFAULT 'general'", "DEFAULT 'vehicle'")],
    ['no mileage trips table', (sql: string) => (/mileage_trips/.test(sql) ? null : sql)],
    ['mileage reports without a vehicle column', (sql: string) => sql.replace("vehicle TEXT NOT NULL DEFAULT '',", '')],
    ['total kilometres stored as text', (sql: string) => sql.replace('total_km INTEGER', 'total_km TEXT')],
    ['a nullable trip date', (sql: string) => sql.replace("date TEXT NOT NULL DEFAULT '',\n        from_place", 'date TEXT,\n        from_place')],
    ['counters keyed by year and sequence', (sql: string) => sql.replace(
      'year INTEGER PRIMARY KEY,\n        last_seq INTEGER NOT NULL CHECK (last_seq > 0)',
      'year INTEGER,\n        last_seq INTEGER NOT NULL CHECK (last_seq > 0),\n        PRIMARY KEY (year, last_seq)',
    )],
    ['no unique year and sequence', (sql: string) => sql.replace(/,\s*UNIQUE \(year, seq\)/, '')],
    ['sequence unique across all years', (sql: string) => sql.replace('UNIQUE (year, seq)', 'UNIQUE (seq)')],
    ['trips that survive their report', (sql: string) => sql.replace(' ON DELETE CASCADE', '')],
    ['trips without a report foreign key', (sql: string) => sql.replace(' REFERENCES mileage_reports(id) ON DELETE CASCADE', '')],
    ['no trip lookup index', (sql: string) => (sql.startsWith('CREATE INDEX idx_mileage_trips_report') ? null : sql)],
    ['a unique trip lookup index', (sql: string) => sql.replace('CREATE INDEX idx_mileage_trips_report', 'CREATE UNIQUE INDEX idx_mileage_trips_report')],
    ['a report lookup index on the wrong columns', (sql: string) => sql.replace('(year, status, report_date)', '(year, status)')],
    ['a partial report lookup index', (sql: string) => sql.replace('(year, status, report_date)', "(year, status, report_date) WHERE status = 'finalized'")],
  ])('rejects a version-7 backup with %s', async (_label, alter) => {
    await expectMalformed(await alteredVersion7(alter));
  });

  test.each([
    ['an expense category outside vehicle and general', "INSERT INTO expense_items (expense_report_id, category) VALUES (1, 'fuel')"],
    ['a non-positive mileage counter', 'INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 0)'],
    ['a zero report sequence', "INSERT INTO mileage_reports (year, seq, status) VALUES (2026, 0, 'finalized')"],
    ['an unknown report status', "INSERT INTO mileage_reports (year, status) VALUES (2026, 'archived')"],
    ['negative total kilometres', 'INSERT INTO mileage_reports (year, total_km) VALUES (2026, -5)'],
    ['a negative start odometer', 'INSERT INTO mileage_trips (mileage_report_id, start_odometer_km) VALUES (1, -1)'],
    ['a negative end odometer', 'INSERT INTO mileage_trips (mileage_report_id, end_odometer_km) VALUES (1, -1)'],
  ])('rejects stored rows the version-7 checks forbid: %s', async (_label, insert) => {
    // Without its CHECKs the schema still looks right to PRAGMA table_info, so
    // only the stored values can reveal the problem.
    const db = await alteredVersion7(withoutV7Checks);
    await db.execute("INSERT INTO expense_reports (id, year, status) VALUES (1, 2026, 'draft')");
    await db.execute("INSERT INTO mileage_reports (id, year, status) VALUES (1, 2026, 'draft')");
    expect((await validateBackup(db)).ok).toBe(true);

    await db.execute(insert);

    await expectMalformed(db);
  });

  test.each([
    ['fractional total kilometres', 'UPDATE mileage_reports SET total_km = 12.5'],
    ['a fractional odometer reading', 'UPDATE mileage_trips SET end_odometer_km = 1000.5'],
    ['a text odometer reading', "UPDATE mileage_trips SET start_odometer_km = 'abc'"],
  ])('rejects %s even though the version-7 checks allow it', async (_label, update) => {
    const db = await goodDb();
    await db.execute("INSERT INTO mileage_reports (id, year, status) VALUES (1, 2026, 'draft')");
    await db.execute(
      'INSERT INTO mileage_trips (mileage_report_id, start_odometer_km, end_odometer_km) VALUES (1, 100, 120)',
    );
    expect((await validateBackup(db)).ok).toBe(true);

    await db.execute(update);

    await expectMalformed(db);
  });

  test('rejects a version-7 backup with a trip whose report is missing', async () => {
    const db = await goodDb();
    await db.execute('PRAGMA foreign_keys = OFF');
    await db.execute('INSERT INTO mileage_trips (mileage_report_id) VALUES (999)');
    await db.execute('PRAGMA foreign_keys = ON');

    await expectMalformed(db);
  });
});
