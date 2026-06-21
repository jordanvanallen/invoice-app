import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { allocateSeq, reserveSeq, takenSeqs } from './numbering-repo';

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

  test('reserveSeq advances the counter to a manual number without moving backward', async () => {
    const db = await freshDb();

    expect(await reserveSeq(db, 2026, 11)).toBe(11);
    expect(await allocateSeq(db, 2026)).toBe(12);

    expect(await reserveSeq(db, 2026, 5)).toBe(5);
    expect(await allocateSeq(db, 2026)).toBe(13);
  });

  test('takenSeqs can ignore the current draft invoice', async () => {
    const db = await freshDb();
    await db.execute(
      "INSERT INTO invoices (id, year, seq, status, issue_date) VALUES (10, 2026, 11, 'draft', '2026-06-21')",
    );
    await db.execute(
      "INSERT INTO invoices (id, year, seq, status, issue_date) VALUES (11, 2026, 12, 'finalized', '2026-06-22')",
    );

    expect(await takenSeqs(db, 2026)).toEqual([11, 12]);
    expect(await takenSeqs(db, 2026, 10)).toEqual([12]);
  });
});
