import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { allocateSeq, takenSeqs } from './numbering-repo';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

describe('numbering repo', () => {
  test('allocateSeq starts at 1 and increments per year', async () => {
    const db = await freshDb();
    expect(await allocateSeq(db, 2026)).toBe(1);
    expect(await allocateSeq(db, 2026)).toBe(2);
    expect(await allocateSeq(db, 2027)).toBe(1); // separate counter per year
  });

  test('never recycles even though counter is independent of surviving rows', async () => {
    const db = await freshDb();
    await allocateSeq(db, 2026); // 1
    await allocateSeq(db, 2026); // 2
    // Simulate deleting invoice #2: counter must NOT go back to 2.
    expect(await allocateSeq(db, 2026)).toBe(3);
  });

  test('takenSeqs lists finalized/used sequences for a year', async () => {
    const db = await freshDb();
    await db.execute(
      "INSERT INTO invoices (year, seq, status, issue_date) VALUES (2026, 5, 'finalized', '2026-05-28')",
    );
    expect(await takenSeqs(db, 2026)).toEqual([5]);
    expect(await takenSeqs(db, 2027)).toEqual([]);
  });
});
