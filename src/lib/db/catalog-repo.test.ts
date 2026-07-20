import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import {
  addEntry, listEntries, renameEntry, setActive, deleteEntryIfUnused,
} from './catalog-repo';
import type { CatalogTable } from './catalog-repo';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

const catalogReferenceCases = [
  { table: 'clients', column: 'client_id', targetName: 'Draft Client', otherName: 'Other Client' },
  { table: 'locations', column: 'location_id', targetName: 'Draft Location', otherName: 'Other Location' },
  { table: 'approvers', column: 'mileage_approver_id', targetName: 'Draft Approver', otherName: 'Other Approver' },
] as const satisfies readonly {
  table: CatalogTable;
  column: 'client_id' | 'location_id' | 'mileage_approver_id';
  targetName: string;
  otherName: string;
}[];

describe('catalog repo (clients/locations/approvers)', () => {
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

  test('approver quick-add reuses and reactivates a normalized match', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'approvers', 'Jordan Lee');
    await setActive(db, 'approvers', id, false);

    expect(await addEntry(db, 'approvers', '  jordan lee ')).toBe(id);
    expect(await listEntries(db, 'approvers')).toEqual([
      { id, name: 'Jordan Lee', active: true },
    ]);
  });

  test('concurrent approver quick-adds reuse one canonical ID and display name', async () => {
    const db = await freshDb();

    const [canonicalId, duplicateId] = await Promise.all([
      addEntry(db, 'approvers', 'Jordan Lee'),
      addEntry(db, 'approvers', '  jordan lee  '),
    ]);

    expect(duplicateId).toBe(canonicalId);
    expect(await listEntries(db, 'approvers')).toEqual([
      { id: canonicalId, name: 'Jordan Lee', active: true },
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

  test.each(catalogReferenceCases)(
    '$table deletion increments each affected draft revision once without touching other invoice revisions',
    async ({ table, column, targetName, otherName }) => {
      const db = await freshDb();
      const targetId = await addEntry(db, table, targetName);
      const otherId = await addEntry(db, table, otherName);
      await db.execute(`INSERT INTO invoices (id, year, status, draft_revision) VALUES
        (1, 2026, 'draft', 4),
        (2, 2026, 'draft', 8),
        (3, 2026, 'finalized', 12),
        (4, 2026, 'void', 16)`);
      await db.execute(`INSERT INTO line_items (invoice_id, type, position, ${column}) VALUES
        (1, 'completed', 0, ?),
        (1, 'completed', 1, ?),
        (2, 'completed', 0, ?),
        (3, 'completed', 0, ?),
        (4, 'completed', 0, ?)`, [targetId, targetId, otherId, otherId, otherId]);

      expect(await deleteEntryIfUnused(db, table, targetId)).toBe(true);

      expect(await db.select(
        'SELECT id, draft_revision FROM invoices ORDER BY id',
      )).toEqual([
        { id: 1, draft_revision: 5 },
        { id: 2, draft_revision: 8 },
        { id: 3, draft_revision: 12 },
        { id: 4, draft_revision: 16 },
      ]);
      expect(await db.select(
        `SELECT invoice_id, ${column} AS reference_id FROM line_items ORDER BY invoice_id, position`,
      )).toEqual([
        { invoice_id: 1, reference_id: null },
        { invoice_id: 1, reference_id: null },
        { invoice_id: 2, reference_id: otherId },
        { invoice_id: 3, reference_id: otherId },
        { invoice_id: 4, reference_id: otherId },
      ]);
    },
  );

  test('approver deletion detaches drafts but preserves their stored approver name', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'approvers', 'Jordan Lee');
    await db.execute("INSERT INTO invoices (id, year, status) VALUES (1, 2026, 'draft')");
    await db.execute(
      "INSERT INTO line_items (invoice_id, type, mileage_approver_id, mileage_approver_name) VALUES (1, 'completed', ?, 'Jordan Lee')",
      [id],
    );

    expect(await deleteEntryIfUnused(db, 'approvers', id)).toBe(true);
    expect(await db.select(
      'SELECT mileage_approver_id, mileage_approver_name FROM line_items',
    )).toEqual([{ mileage_approver_id: null, mileage_approver_name: 'Jordan Lee' }]);
    expect(await listEntries(db, 'approvers')).toEqual([]);
  });

  test.each(['finalized', 'void'] as const)(
    'approver deletion refuses a %s invoice reference',
    async (status) => {
      const db = await freshDb();
      const id = await addEntry(db, 'approvers', 'Jordan Lee');
      await db.execute('INSERT INTO invoices (id, year, status) VALUES (1, 2026, ?)', [status]);
      await db.execute(
        "INSERT INTO line_items (invoice_id, type, mileage_approver_id, mileage_approver_name) VALUES (1, 'completed', ?, 'Jordan Lee')",
        [id],
      );

      expect(await deleteEntryIfUnused(db, 'approvers', id)).toBe(false);
      expect(await db.select('SELECT mileage_approver_id FROM line_items')).toEqual([
        { mileage_approver_id: id },
      ]);
      expect((await listEntries(db, 'approvers')).map((entry) => entry.id)).toEqual([id]);
    },
  );

  test('approver deletion rolls draft detachment back when deleting the catalog row fails', async () => {
    const db = await freshDb();
    const id = await addEntry(db, 'approvers', 'Jordan Lee');
    await db.execute("INSERT INTO invoices (id, year, status, draft_revision) VALUES (1, 2026, 'draft', 7)");
    await db.execute(
      `INSERT INTO line_items
         (invoice_id, type, position, mileage_approver_id, mileage_approver_name)
       VALUES (1, 'completed', 0, ?, 'Jordan Lee'),
              (1, 'completed', 1, ?, 'Jordan Lee')`,
      [id, id],
    );
    await db.execute(`CREATE TRIGGER fail_approver_delete
      BEFORE DELETE ON approvers
      BEGIN
        SELECT RAISE(FAIL, 'injected approver delete failure');
      END`);

    await expect(deleteEntryIfUnused(db, 'approvers', id)).rejects.toThrow(
      /injected approver delete failure/i,
    );
    expect(await db.select(
      'SELECT mileage_approver_id FROM line_items ORDER BY position',
    )).toEqual([
      { mileage_approver_id: id },
      { mileage_approver_id: id },
    ]);
    expect(await db.select('SELECT draft_revision FROM invoices WHERE id = 1'))
      .toEqual([{ draft_revision: 7 }]);
    expect((await listEntries(db, 'approvers')).map((entry) => entry.id)).toEqual([id]);
  });
});
