import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { validateBackup, LATEST_SCHEMA_VERSION } from './restore';

async function goodDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
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
    const check = await validateBackup(db);
    expect(check.ok).toBe(true);
    expect(check.summary?.businessName).toBe('Jane Tester');
    expect(check.summary?.invoiceCount).toBe(1); // only the finalized one
    expect(check.summary?.latestInvoiceDate).toBe('2026-06-10');
    expect(check.summary?.expenseReportCount).toBe(1);
    expect(check.summary?.latestExpenseReportDate).toBe('2026-06-11');
  });

  test('accepts a valid pre-expense version-3 backup with an empty expense summary', async () => {
    const db = await goodDb();
    await db.execute('DROP TABLE expense_items');
    await db.execute('DROP TABLE expense_reports');
    await db.execute('DROP TABLE expense_year_counters');
    await db.execute('PRAGMA user_version = 3');

    const check = await validateBackup(db);

    expect(check.ok).toBe(true);
    expect(check.summary?.expenseReportCount).toBe(0);
    expect(check.summary?.latestExpenseReportDate).toBeNull();
  });

  test('rejects a version-4 backup that is missing expense tables', async () => {
    const db = await goodDb();
    await db.execute('DROP TABLE expense_items');

    const check = await validateBackup(db);

    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/missing expected data/i);
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
