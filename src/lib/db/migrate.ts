import type { Db } from './db';
import { runInTransaction } from './db';
import { MIGRATIONS } from './schema';

/**
 * Apply any migrations newer than the DB's current user_version. Adapters that
 * expose sticky transactions run each migration atomically; Tauri SQL runs the
 * statements in SQLite autocommit mode because its JS API is backed by a pool.
 * Returns the resulting version. Idempotent: already-applied versions are skipped.
 */
export async function runMigrations(db: Db): Promise<number> {
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  let current = rows[0]?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await runInTransaction(db, async () => {
      for (const stmt of migration.statements) {
        await db.execute(stmt);
      }
      await db.execute(`PRAGMA user_version = ${migration.version}`);
    });
    current = migration.version;
  }
  return current;
}
