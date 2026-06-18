import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';

describe('sql.js adapter implements Db', () => {
  test('execute + select round-trip with params and lastInsertId', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const r = await db.execute('INSERT INTO t (name) VALUES (?)', ['alice']);
    expect(r.rowsAffected).toBe(1);
    expect(r.lastInsertId).toBe(1);
    const rows = await db.select<{ id: number; name: string }>('SELECT * FROM t WHERE name = ?', ['alice']);
    expect(rows).toEqual([{ id: 1, name: 'alice' }]);
  });

  test('select returns [] when no rows match', async () => {
    const db = await createSqlJsDb();
    await db.execute('CREATE TABLE t (id INTEGER)');
    expect(await db.select('SELECT * FROM t')).toEqual([]);
  });
});
