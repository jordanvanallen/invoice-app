import { executeStatementsAtomically, type Db } from './db';

export type CatalogTable = 'clients' | 'locations' | 'approvers';

const CATALOGS = {
  clients: { referenceColumn: 'client_id', normalized: true, noun: 'client' },
  locations: { referenceColumn: 'location_id', normalized: false, noun: 'location' },
  approvers: { referenceColumn: 'mileage_approver_id', normalized: true, noun: 'approver' },
} as const satisfies Record<CatalogTable, {
  referenceColumn: string;
  normalized: boolean;
  noun: string;
}>;

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

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export async function addEntry(db: Db, table: CatalogTable, name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');

  if (CATALOGS[table].normalized) {
    const key = nameKey(trimmed);
    const [existing] = await db.select<{ id: number; active: number }>(
      `SELECT id, active FROM ${table} WHERE name_key = ?`,
      [key],
    );
    if (existing) {
      if (existing.active !== 1) {
        await db.execute(`UPDATE ${table} SET active = 1 WHERE id = ?`, [existing.id]);
      }
      return existing.id;
    }
    const r = await db.execute(`INSERT INTO ${table} (name, name_key) VALUES (?, ?)`, [trimmed, key]);
    return r.lastInsertId as number;
  }

  const r = await db.execute(`INSERT INTO ${table} (name) VALUES (?)`, [trimmed]);
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
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');

  const catalog = CATALOGS[table];
  if (catalog.normalized) {
    const key = nameKey(trimmed);
    const [existing] = await db.select<{ id: number }>(
      `SELECT id FROM ${table} WHERE name_key = ? AND id != ?`,
      [key, id],
    );
    if (existing) throw new Error(`A ${catalog.noun} named "${trimmed}" already exists.`);
    await db.execute(`UPDATE ${table} SET name = ?, name_key = ? WHERE id = ?`, [trimmed, key, id]);
    return;
  }

  await db.execute(`UPDATE ${table} SET name = ? WHERE id = ?`, [trimmed, id]);
}

export async function setActive(db: Db, table: CatalogTable, id: number, active: boolean): Promise<void> {
  await db.execute(`UPDATE ${table} SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
}

/**
 * Delete an entry only if no finalized or void invoice references it. Draft
 * invoices are scratch and don't block deletion (a draft keeps its stored name
 * text if the entry is gone). Returns false (and does nothing) when it's locked by
 * a real invoice — callers should deactivate instead.
 */
export async function deleteEntryIfUnused(db: Db, table: CatalogTable, id: number): Promise<boolean> {
  const column = CATALOGS[table].referenceColumn;
  const countNonDraftReferences = async (): Promise<number> => {
    const [{ c }] = await db.select<{ c: number }>(
      `SELECT COUNT(*) AS c
         FROM line_items li JOIN invoices i ON i.id = li.invoice_id
        WHERE li.${column} = ? AND i.status != 'draft'`,
      [id],
    );
    return c;
  };

  if (await countNonDraftReferences() > 0) return false;

  try {
    await executeStatementsAtomically(db, [
      {
        sql: `UPDATE line_items SET ${column} = NULL
               WHERE ${column} = ? AND invoice_id IN
                 (SELECT id FROM invoices WHERE status = 'draft')`,
        params: [id],
      },
      {
        sql: `DELETE FROM ${table} WHERE id = ? AND NOT EXISTS (
                SELECT 1 FROM line_items li JOIN invoices i ON i.id = li.invoice_id
                WHERE li.${column} = ? AND i.status != 'draft'
              )`,
        params: [id, id],
        expectedRowsAffected: 1,
      },
    ]);
    return true;
  } catch (error) {
    if (await countNonDraftReferences() > 0) return false;
    throw error;
  }
}
