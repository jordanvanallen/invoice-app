import type { Db } from './db';
import { executeStatementsAtomically } from './db';
import { MIGRATIONS } from './schema';

/**
 * Apply any migrations newer than the DB's current user_version. Production and
 * sticky test adapters run each migration atomically. Minimal legacy adapters
 * without transaction support retain the sequential compatibility fallback.
 * Returns the resulting version. Idempotent: already-applied versions are skipped.
 */
export async function runMigrations(db: Db): Promise<number> {
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  let current = rows[0]?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const statements = [
      ...migration.statements.map((sql) => ({ sql })),
      { sql: `PRAGMA user_version = ${migration.version}` },
    ];
    if (db.executeTransaction || db.supportsSqlTransactions) {
      await executeStatementsAtomically(db, statements);
    } else {
      for (const stmt of migration.statements) {
        await db.execute(stmt);
      }
      await db.execute(`PRAGMA user_version = ${migration.version}`);
    }
    current = migration.version;
  }
  return current;
}
