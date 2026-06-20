import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import {
  addEntry, listEntries, renameEntry, setActive, deleteEntryIfUnused,
} from './catalog-repo';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

describe('catalog repo (clients/locations)', () => {
  test('add and list', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Globex Finance Group');
    expect(id).toBeGreaterThan(0);
    const all = await listEntries(db, 'clients');
    expect(all).toEqual([{ id, name: 'Globex Finance Group', active: true }]);
  });

  test('addEntry reuses an existing client name regardless of capitalization', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Globex Finance Group');
    await setActive(db, 'clients', id, false);

    const duplicateId = await addEntry(db, 'clients', '  globex finance group  ');

    expect(duplicateId).toBe(id);
    expect(await listEntries(db, 'clients')).toEqual([
      { id, name: 'Globex Finance Group', active: true },
    ]);
  });

  test('rename fixes a misspelling', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Globex Finance Grp');
    await renameEntry(db, 'clients', id, 'Globex Finance Group');
    const [c] = await listEntries(db, 'clients');
    expect(c.name).toBe('Globex Finance Group');
  });

  test('renameEntry rejects a duplicate client name regardless of capitalization', async () => {
    const db = await freshDb();
    const first = await addEntry(db, 'clients', 'Globex Finance Group');
    const second = await addEntry(db, 'clients', 'Summit Motors');

    await expect(renameEntry(db, 'clients', second, 'globex finance group')).rejects.toThrow(/already exists/i);

    expect((await listEntries(db, 'clients')).map((c) => [c.id, c.name])).toEqual([
      [first, 'Globex Finance Group'],
      [second, 'Summit Motors'],
    ]);
  });

  test('listEntries can filter to active only', async () => {
    const db = await freshDb();
    const a = await addEntry(db, 'locations', 'Maplewood');
    const b = await addEntry(db, 'locations', 'Old Town');
    await setActive(db, 'locations', b, false);
    expect((await listEntries(db, 'locations', { activeOnly: true })).map((e) => e.id)).toEqual([a]);
    expect((await listEntries(db, 'locations')).length).toBe(2);
  });

  test('deleteEntryIfUnused removes an unreferenced entry and returns true', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Typo Co');
    expect(await deleteEntryIfUnused(db, 'clients', id)).toBe(true);
    expect(await listEntries(db, 'clients')).toEqual([]);
  });

  test('deleteEntryIfUnused refuses (returns false) when a FINALIZED invoice references it', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Used Co');
    await db.execute("INSERT INTO invoices (year, status, issue_date) VALUES (2026, 'finalized', '2026-05-28')");
    await db.execute(
      "INSERT INTO line_items (invoice_id, type, client_id, client_name) VALUES (1, 'completed', ?, 'Used Co')",
      [id],
    );
    expect(await deleteEntryIfUnused(db, 'clients', id)).toBe(false);
    expect((await listEntries(db, 'clients')).map((c) => c.id)).toEqual([id]);
  });

  test('deleteEntryIfUnused ALLOWS deletion when only a DRAFT references it (drafts are scratch)', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'clients', 'Draft Co');
    await db.execute("INSERT INTO invoices (year, status, issue_date) VALUES (2026, 'draft', '2026-05-28')");
    await db.execute(
      "INSERT INTO line_items (invoice_id, type, client_id, client_name) VALUES (1, 'completed', ?, 'Draft Co')",
      [id],
    );
    expect(await deleteEntryIfUnused(db, 'clients', id)).toBe(true);
    expect(await listEntries(db, 'clients')).toEqual([]);
  });
});
