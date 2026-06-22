import initSqlJs, { type Database } from 'sql.js';
import type { Db, DbResult } from './db';

/** TEST-ONLY: an in-memory sql.js-backed Db. Never import from production code. */
export async function createSqlJsDb(): Promise<Db & { export(): Uint8Array; close(): void }> {
  const SQL = await initSqlJs();
  const raw: Database = new SQL.Database();
  raw.run('PRAGMA foreign_keys = ON');

  return {
    supportsSqlTransactions: true,
    async execute(sql: string, params: unknown[] = []): Promise<DbResult> {
      raw.run(sql, params as never[]);
      const idRows = raw.exec('SELECT last_insert_rowid() AS id');
      const lastInsertId = idRows.length ? Number(idRows[0].values[0][0]) : undefined;
      return { rowsAffected: raw.getRowsModified(), lastInsertId };
    },
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = raw.prepare(sql);
      stmt.bind(params as never[]);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      stmt.free();
      return rows;
    },
    export: () => raw.export(),
    close: () => raw.close(),
  };
}
