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

async function tableNames(db: Awaited<ReturnType<typeof createSqlJsDb>>): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

async function migrateThroughVersion4(db: Awaited<ReturnType<typeof createSqlJsDb>>) {
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 4)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
}

async function migrateThroughVersion2(db: Awaited<ReturnType<typeof createSqlJsDb>>) {
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 2)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
}

describe('runMigrations', () => {
  test('creates all tables and sets user_version', async () => {
    const db = await createSqlJsDb();
    const version = await runMigrations(db);
    expect(version).toBe(5);
    const names = await tableNames(db);
    for (const t of ['settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items']) {
      expect(names).toContain(t);
    }
    for (const t of ['expense_year_counters', 'expense_reports', 'expense_items']) {
      expect(names).toContain(t);
    }
    expect(names).toContain('approvers');
    const uv = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(uv[0].user_version).toBe(5);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
    // v2 added the logo column
    const cols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('settings')");
    expect(cols.map((c) => c.name)).toContain('logo_data_url');
    const clientCols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('clients')");
    expect(clientCols.map((c) => c.name)).toContain('name_key');
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
    await migrateThroughVersion4(db);
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

    await expect(runMigrations(db)).resolves.toBe(5);

    expect(await db.select('SELECT year, seq, issue_date FROM invoices')).toEqual([
      { year: 2026, seq: 9, issue_date: '2026-07-01' },
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

  test('backfills client name keys and enforces case-insensitive uniqueness', async () => {
    const db = await createSqlJsDb();
    await migrateThroughVersion2(db);
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
    await runMigrations(db);
    const s = await db.select<{ c: number }>('SELECT COUNT(*) AS c FROM settings');
    expect(s[0].c).toBe(1);
  });

  test('runs on adapters that do not support raw transaction commands', async () => {
    const db = withoutSqlTransactions(await createSqlJsDb());
    await expect(runMigrations(db)).resolves.toBe(5);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
  });

  test('uses the adapter atomic batch for every production migration', async () => {
    const inner = await createSqlJsDb();
    let batches = 0;
    const db: Db = {
      execute: inner.execute.bind(inner),
      select: inner.select.bind(inner),
      async executeTransaction(statements: DbStatement[]) {
        batches += 1;
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

    await runMigrations(db);

    expect(batches).toBe(MIGRATIONS.length);
    expect((await inner.select<{ user_version: number }>('PRAGMA user_version'))[0].user_version).toBe(5);
  });
});
