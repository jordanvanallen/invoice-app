import { describe, expect, test } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { executeStatementsAtomically } from './db';

describe('executeStatementsAtomically', () => {
  test('rolls back every statement when a later statement fails', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE values_test (value INTEGER UNIQUE)');

    await expect(executeStatementsAtomically(db, [
      { sql: 'INSERT INTO values_test (value) VALUES (?)', params: [1] },
      { sql: 'INSERT INTO values_test (value) VALUES (?)', params: [1] },
    ])).rejects.toThrow();

    expect(await db.select('SELECT value FROM values_test')).toEqual([]);
  });

  test('commits all statements together', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE values_test (value INTEGER UNIQUE)');

    await executeStatementsAtomically(db, [
      { sql: 'INSERT INTO values_test (value) VALUES (?)', params: [1] },
      { sql: 'INSERT INTO values_test (value) VALUES (?)', params: [2] },
    ]);

    expect(await db.select('SELECT value FROM values_test ORDER BY value')).toEqual([
      { value: 1 }, { value: 2 },
    ]);
  });
});
