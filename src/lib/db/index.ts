import type { Db } from './db';
import { createTauriDb } from './tauri-adapter';
import { runMigrations } from './migrate';
import { INTEGRITY_CHECK_SQL } from './backup';
import { applyPendingRestore } from './restore-swap';

let dbPromise: Promise<Db> | null = null;

/** Open the on-disk DB once, run migrations, verify integrity. Memoized. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // If a restore was staged before the last relaunch, swap it in first.
      await applyPendingRestore();
      const db = await createTauriDb();
      await runMigrations(db);
      const rows = await db.select<{ integrity_check: string }>(INTEGRITY_CHECK_SQL);
      if (rows[0]?.integrity_check !== 'ok') {
        throw new Error(`Database integrity check failed: ${rows[0]?.integrity_check ?? 'unknown'}`);
      }
      return db;
    })();
  }
  return dbPromise;
}
