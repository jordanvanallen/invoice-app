import Database from '@tauri-apps/plugin-sql';
import type { Db, DbResult } from './db';

/** Rewrite positional `?` placeholders to `$1, $2, …` for tauri-plugin-sql. */
function toNumbered(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Production Db backed by tauri-plugin-sql. Loads (and the plugin creates) the
 * on-disk sqlite file in the app's data dir, keyed by the bundle identifier.
 */
export async function createTauriDb(dbFile = 'sqlite:invoice.db'): Promise<Db & { raw: Database }> {
  const raw = await Database.load(dbFile);
  return {
    raw,
    async execute(sql: string, params: unknown[] = []): Promise<DbResult> {
      const r = await raw.execute(toNumbered(sql), params as unknown[]);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
    },
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return raw.select<T[]>(toNumbered(sql), params as unknown[]);
    },
  };
}
