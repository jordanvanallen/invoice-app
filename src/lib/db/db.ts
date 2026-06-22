/** Result of a write. */
export interface DbResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * Minimal async database surface. The production adapter wraps tauri-plugin-sql
 * (Plan 3); the test adapter wraps sql.js. All repo functions depend on this,
 * never on a concrete backend.
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<DbResult>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  supportsSqlTransactions?: boolean;
}

export async function runInTransaction(db: Db, work: () => Promise<void>): Promise<void> {
  if (!db.supportsSqlTransactions) {
    await work();
    return;
  }

  await db.execute('BEGIN');
  try {
    await work();
    await db.execute('COMMIT');
  } catch (err) {
    try {
      await db.execute('ROLLBACK');
    } catch {
      // Preserve the original failure; rollback errors are secondary.
    }
    throw err;
  }
}
