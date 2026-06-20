import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';

async function tableNames(db: Awaited<ReturnType<typeof createSqlJsDb>>): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

describe('runMigrations', () => {
  test('creates all tables and sets user_version', async () => {
    const db = await createSqlJsDb();
    const version = await runMigrations(db);
    expect(version).toBe(3);
    const names = await tableNames(db);
    for (const t of ['settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items']) {
      expect(names).toContain(t);
    }
    const uv = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(uv[0].user_version).toBe(3);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
    // v2 added the logo column
    const cols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('settings')");
    expect(cols.map((c) => c.name)).toContain('logo_data_url');
    const clientCols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('clients')");
    expect(clientCols.map((c) => c.name)).toContain('name_key');
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
});
