import type { Db } from './db';

/**
 * Atomically allocate the next sequence for a year from a monotonic counter.
 * The counter is never re-derived from surviving invoices, so deletes/voids do
 * not recycle numbers.
 */
export async function allocateSeq(db: Db, year: number): Promise<number> {
  await db.execute(
    `INSERT INTO year_counters (year, last_seq) VALUES (?, 1)
     ON CONFLICT(year) DO UPDATE SET last_seq = last_seq + 1`,
    [year],
  );
  const [{ last_seq }] = await db.select<{ last_seq: number }>(
    'SELECT last_seq FROM year_counters WHERE year = ?',
    [year],
  );
  return last_seq;
}

/** Sequences already assigned to invoices in a year (for override validation). */
export async function reserveSeq(db: Db, year: number, seq: number): Promise<number> {
  await db.execute(
    `INSERT INTO year_counters (year, last_seq) VALUES (?, ?)
     ON CONFLICT(year) DO UPDATE SET last_seq =
       CASE WHEN last_seq < excluded.last_seq THEN excluded.last_seq ELSE last_seq END`,
    [year, seq],
  );
  return seq;
}

/** Sequences already assigned to invoices in a year (for override validation). */
export async function takenSeqs(db: Db, year: number, excludeInvoiceId?: number): Promise<number[]> {
  const params: unknown[] = [year];
  const exclude = excludeInvoiceId === undefined ? '' : ' AND id != ?';
  if (excludeInvoiceId !== undefined) params.push(excludeInvoiceId);
  const rows = await db.select<{ seq: number }>(
    `SELECT seq FROM invoices WHERE year = ? AND seq IS NOT NULL${exclude} ORDER BY seq`,
    params,
  );
  return rows.map((r) => r.seq);
}
