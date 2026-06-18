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
    expect(version).toBe(2);
    const names = await tableNames(db);
    for (const t of ['settings', 'clients', 'locations', 'year_counters', 'invoices', 'line_items']) {
      expect(names).toContain(t);
    }
    const uv = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(uv[0].user_version).toBe(2);
    const s = await db.select<{ id: number }>('SELECT id FROM settings');
    expect(s).toEqual([{ id: 1 }]);
    // v2 added the logo column
    const cols = await db.select<{ name: string }>("SELECT name FROM pragma_table_info('settings')");
    expect(cols.map((c) => c.name)).toContain('logo_data_url');
  });

  test('is idempotent — running twice does not error or duplicate', async () => {
    const db = await createSqlJsDb();
    await runMigrations(db);
    await runMigrations(db);
    const s = await db.select<{ c: number }>('SELECT COUNT(*) AS c FROM settings');
    expect(s[0].c).toBe(1);
  });
});
