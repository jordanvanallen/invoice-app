import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { vacuumIntoSql, INTEGRITY_CHECK_SQL, escapeSqlitePath } from './backup';

describe('backup helpers', () => {
  test('escapeSqlitePath doubles single quotes', () => {
    expect(escapeSqlitePath("/tmp/o'brien/backup.db")).toBe("/tmp/o''brien/backup.db");
  });

  test('vacuumIntoSql builds a quoted VACUUM INTO statement', () => {
    expect(vacuumIntoSql('/data/backup.db')).toBe("VACUUM INTO '/data/backup.db'");
  });

  test('integrity check on a migrated db reports ok', async () => {
    const db = await createSqlJsDb();
    await runMigrations(db);
    const rows = await db.select<{ integrity_check: string }>(INTEGRITY_CHECK_SQL);
    expect(rows[0].integrity_check).toBe('ok');
  });
});
