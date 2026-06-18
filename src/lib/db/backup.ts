/** Escape a filesystem path for safe inclusion in a single-quoted SQL string literal. */
export function escapeSqlitePath(path: string): string {
  return path.replace(/'/g, "''");
}

/**
 * Build a `VACUUM INTO` statement that writes a single, consistent copy of the
 * database to `path` (safe regardless of WAL state). Executed by the production
 * adapter in Plan 3.
 */
export function vacuumIntoSql(path: string): string {
  return `VACUUM INTO '${escapeSqlitePath(path)}'`;
}

/** Run on startup; expect a single row whose value is 'ok'. */
export const INTEGRITY_CHECK_SQL = 'PRAGMA integrity_check';
