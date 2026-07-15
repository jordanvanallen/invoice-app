import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { MIGRATIONS } from './schema';
import type { Db, DbResult } from './db';

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

async function tableNames(db: Awaited<ReturnType<typeof createSqlJsDb>>): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

async function migrateThroughVersion3(db: Awaited<ReturnType<typeof createSqlJsDb>>) {
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 3)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
}

describe('runMigrations', () => {
  test('creates all tables and sets user_version', async () => {
    const db = await createSqlJsDb();
    const version = await runMigrations(db);
    expect(version).toBe(4);
    const names = await tableNames(db);
    for (const t of ['settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items']) {
      expect(names).toContain(t);
    }
    for (const t of ['expense_year_counters', 'expense_reports', 'expense_items']) {
      expect(names).toContain(t);
    }
    const uv = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(uv[0].user_version).toBe(4);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
    // v2 added the logo column
    const cols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('settings')");
    expect(cols.map((c) => c.name)).toContain('logo_data_url');
    const clientCols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('clients')");
    expect(clientCols.map((c) => c.name)).toContain('name_key');
  });

  test('migrates a version-3 database without changing existing invoice data', async () => {
    const db = await createSqlJsDb();
    await migrateThroughVersion3(db);
    await db.execute(
      "INSERT INTO invoices (year, seq, status, issue_date) VALUES (2026, 9, 'finalized', '2026-07-01')",
    );

    await expect(runMigrations(db)).resolves.toBe(4);

    expect(await db.select('SELECT year, seq, issue_date FROM invoices')).toEqual([
      { year: 2026, seq: 9, issue_date: '2026-07-01' },
    ]);
    expect(await tableNames(db)).toEqual(expect.arrayContaining([
      'expense_year_counters', 'expense_reports', 'expense_items',
    ]));
  });

  test('backfills client name keys and enforces case-insensitive uniqueness', async () => {
    const db = await createSqlJsDb();
    await db.execute(`CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )`);
    await db.execute("INSERT INTO clients (name) VALUES ('Globex Finance Group')");
    await db.execute("INSERT INTO clients (name) VALUES ('globex finance group')");
    await db.execute('PRAGMA user_version = 2');

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
    await runMigrations(db);
    const s = await db.select<{ c: number }>('SELECT COUNT(*) AS c FROM settings');
    expect(s[0].c).toBe(1);
  });

  test('runs on adapters that do not support raw transaction commands', async () => {
    const db = withoutSqlTransactions(await createSqlJsDb());
    await expect(runMigrations(db)).resolves.toBe(4);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
  });
});
