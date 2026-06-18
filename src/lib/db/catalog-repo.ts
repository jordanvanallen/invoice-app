import type { Db } from './db';

export type CatalogTable = 'clients' | 'locations';

export interface CatalogEntry {
  id: number;
  name: string;
  active: boolean;
}

interface CatalogRow {
  id: number;
  name: string;
  active: number;
}

export async function addEntry(db: Db, table: CatalogTable, name: string): Promise<number> {
  const r = await db.execute(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
  return r.lastInsertId as number;
}

export async function listEntries(
  db: Db,
  table: CatalogTable,
  opts: { activeOnly?: boolean } = {},
): Promise<CatalogEntry[]> {
  const where = opts.activeOnly ? 'WHERE active = 1' : '';
  const rows = await db.select<CatalogRow>(`SELECT id, name, active FROM ${table} ${where} ORDER BY name`);
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active === 1 }));
}

export async function renameEntry(db: Db, table: CatalogTable, id: number, name: string): Promise<void> {
  await db.execute(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, id]);
}

export async function setActive(db: Db, table: CatalogTable, id: number, active: boolean): Promise<void> {
  await db.execute(`UPDATE ${table} SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
}

/**
 * Delete an entry only if no FINALIZED or cancelled invoice references it. Draft
 * invoices are scratch and don't block deletion (a draft keeps its stored name
 * text if the entry is gone). Returns false (and does nothing) when it's locked by
 * a real invoice — callers should deactivate instead.
 */
export async function deleteEntryIfUnused(db: Db, table: CatalogTable, id: number): Promise<boolean> {
  const column = table === 'clients' ? 'client_id' : 'location_id';
  const [{ c }] = await db.select<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM line_items li JOIN invoices i ON i.id = li.invoice_id
      WHERE li.${column} = ? AND i.status != 'draft'`,
    [id],
  );
  if (c > 0) return false;
  // Only draft rows can still reference it now — detach them (keeping their stored
  // name text) so the foreign key doesn't block the delete.
  await db.execute(`UPDATE line_items SET ${column} = NULL WHERE ${column} = ?`, [id]);
  await db.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
  return true;
}
