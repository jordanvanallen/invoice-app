/** Result of a write. */
export interface DbResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/** A single parameterized write in an atomic batch. */
export interface DbStatement {
  sql: string;
  params?: unknown[];
}

/**
 * Minimal async database surface. The production adapter wraps tauri-plugin-sql
 * (Plan 3); the test adapter wraps sql.js. All repo functions depend on this,
 * never on a concrete backend.
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<DbResult>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  executeTransaction?(statements: DbStatement[]): Promise<void>;
  supportsSqlTransactions?: boolean;
}

/**
 * Execute a fixed set of writes as one transaction on the same connection.
 * Production provides a native implementation; test adapters use BEGIN/COMMIT.
 */
export async function executeStatementsAtomically(
  db: Db,
  statements: readonly DbStatement[],
): Promise<void> {
  if (db.executeTransaction) {
    await db.executeTransaction(statements.map((statement) => ({
      sql: statement.sql,
      params: [...(statement.params ?? [])],
    })));
    return;
  }

  if (!db.supportsSqlTransactions) {
    throw new Error('This database adapter does not support atomic transactions.');
  }

  await runInTransaction(db, async () => {
    for (const statement of statements) {
      await db.execute(statement.sql, statement.params ?? []);
    }
  });
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
