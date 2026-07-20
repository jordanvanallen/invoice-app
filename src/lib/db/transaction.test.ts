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

  test('rolls back when a statement affects an unexpected number of rows', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE values_test (id INTEGER PRIMARY KEY, value INTEGER)');
    await db.execute('INSERT INTO values_test (id, value) VALUES (1, 10)');

    await expect(executeStatementsAtomically(db, [
      { sql: 'UPDATE values_test SET value = 20 WHERE id = 1', expectedRowsAffected: 1 },
      { sql: 'UPDATE values_test SET value = 30 WHERE id = 99', expectedRowsAffected: 1 },
    ])).rejects.toThrow(/expected 1 row.*affected 0/i);

    expect(await db.select('SELECT id, value FROM values_test')).toEqual([{ id: 1, value: 10 }]);
  });
});
