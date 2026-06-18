import type { Db } from './db';

/**
 * Atomically allocate the next sequence for a year from a monotonic counter.
 * The counter is never re-derived from surviving invoices, so deletes/voids do
 * not recycle numbers. Call inside the finalize transaction.
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
export async function takenSeqs(db: Db, year: number): Promise<number[]> {
  const rows = await db.select<{ seq: number }>(
    'SELECT seq FROM invoices WHERE year = ? AND seq IS NOT NULL ORDER BY seq',
    [year],
  );
  return rows.map((r) => r.seq);
}
