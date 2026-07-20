import type { Db } from './db';
import { runInTransaction } from './db';
import type { DraftInvoice, LineItem, FinalizedSnapshot } from '../types';
import { orderInvoiceLines } from '../lineOrder';
import { buildFinalizedSnapshot } from '../snapshot';
import { checkOverride } from '../numbering';
import { getSettings } from './settings-repo';
import { allocateSeq, reserveSeq, takenSeqs } from './numbering-repo';

export interface DraftHeader {
  year: number;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
}

export async function createDraft(db: Db, header: DraftHeader): Promise<number> {
  const r = await db.execute(
    `INSERT INTO invoices (year, status, issue_date, period_start, period_end)
     VALUES (?, 'draft', ?, ?, ?)`,
    [header.year, header.issueDate, header.periodStart, header.periodEnd],
  );
  return r.lastInsertId as number;
}

interface LineRow {
  type: 'completed' | 'noshow';
  position: number;
  inspection_number: string;
  client_id: number | null;
  stored_client_name: string;
  live_client_name: string | null;
  location_id: number | null;
  stored_location: string;
  live_location: string | null;
  date: string;
  vin8: string;
  mileage_cents: number;
  mileage_approver_id: number | null;
  mileage_approver_name: string;
  mileage_approval_date: string;
  fee_cents: number;
}

export async function loadDraft(db: Db, invoiceId: number): Promise<DraftInvoice> {
  const [head] = await db.select<{
    year: number; seq: number | null; issue_date: string; period_start: string; period_end: string;
  }>('SELECT year, seq, issue_date, period_start, period_end FROM invoices WHERE id = ?', [invoiceId]);

  const rows = await db.select<LineRow>(
    `SELECT li.type, li.position, li.inspection_number,
            li.client_id, li.client_name AS stored_client_name, c.name AS live_client_name,
            li.location_id, li.location AS stored_location, loc.name AS live_location,
            li.date, li.vin8, li.mileage_cents, li.mileage_approver_id,
            li.mileage_approver_name, li.mileage_approval_date, li.fee_cents
       FROM line_items li
       LEFT JOIN clients c ON c.id = li.client_id
       LEFT JOIN locations loc ON loc.id = li.location_id
      WHERE li.invoice_id = ?
      ORDER BY li.position`,
    [invoiceId],
  );

  const lines: LineItem[] = rows.map((r) => ({
    type: r.type,
    position: r.position,
    inspectionNumber: r.inspection_number,
    clientId: r.client_id,
    clientName: r.client_id !== null ? (r.live_client_name ?? r.stored_client_name) : r.stored_client_name,
    locationId: r.location_id,
    location: r.location_id !== null ? (r.live_location ?? r.stored_location) : r.stored_location,
    date: r.date,
    vin8: r.vin8,
    mileageCents: r.mileage_cents,
    mileageApproverId: r.mileage_approver_id ?? null,
    mileageApproverName: r.mileage_approver_name ?? '',
    mileageApprovalDate: r.mileage_approval_date ?? '',
    feeCents: r.fee_cents,
  }));

  return {
    seq: head.seq,
    year: head.year,
    issueDate: head.issue_date,
    periodStart: head.period_start,
    periodEnd: head.period_end,
    lines,
  };
}

type SaveableDraft = Omit<DraftInvoice, 'seq'> & { seq?: number | null };

function deriveInvoiceYear(issueDate: string, fallbackYear: number): number {
  const yearText = issueDate.slice(0, 4);
  return /^\d{4}$/.test(yearText) ? Number(yearText) : fallbackYear;
}

export async function saveDraft(
  db: Db,
  invoiceId: number,
  draft: SaveableDraft,
): Promise<void> {
  await runInTransaction(db, async () => {
    const year = deriveInvoiceYear(draft.issueDate, draft.year);
    if (draft.seq !== undefined && draft.seq !== null) {
      validateSeqResult(draft.seq, await takenSeqs(db, year, invoiceId));
    }
    await db.execute(
      `UPDATE invoices SET seq = ?, year = ?, issue_date = ?, period_start = ?, period_end = ? WHERE id = ?`,
      [draft.seq ?? null, year, draft.issueDate, draft.periodStart, draft.periodEnd, invoiceId],
    );
    await db.execute('DELETE FROM line_items WHERE invoice_id = ?', [invoiceId]);
    for (const l of draft.lines) {
      await db.execute(
        `INSERT INTO line_items
           (invoice_id, type, position, inspection_number, client_id, client_name,
            location_id, location, date, vin8, mileage_cents, fee_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, l.type, l.position, l.inspectionNumber, l.clientId, l.clientName,
         l.locationId, l.location, l.date, l.vin8, l.mileageCents, l.feeCents],
      );
    }
  });
}

/** Persist the canonical row order used immediately before finalization. */
export async function saveDraftInDateOrder(
  db: Db,
  invoiceId: number,
  draft: SaveableDraft,
): Promise<void> {
  await saveDraft(db, invoiceId, {
    ...draft,
    lines: orderInvoiceLines(draft.lines),
  });
}

function validateSeqResult(seq: number, taken: number[]): void {
  const result = checkOverride(seq, taken);
  if (!result.ok) throw new Error(result.message);
}

async function finalizeSelectedSeq(db: Db, invoiceId: number, year: number, seq: number): Promise<number> {
  validateSeqResult(seq, await takenSeqs(db, year, invoiceId));
  return reserveSeq(db, year, seq);
}

/**
 * Finalize a draft: allocate its seq, freeze the full snapshot + totals, set
 * status. One transaction. Returns the snapshot.
 */
export async function finalizeInvoice(db: Db, invoiceId: number): Promise<FinalizedSnapshot> {
  const draft = await loadDraft(db, invoiceId);
  const normalizedDraft = { ...draft, year: deriveInvoiceYear(draft.issueDate, draft.year) };
  const settings = await getSettings(db);

  let snapshot: FinalizedSnapshot | null = null;
  await runInTransaction(db, async () => {
    const seq = normalizedDraft.seq === null
      ? await allocateSeq(db, normalizedDraft.year)
      : await finalizeSelectedSeq(db, invoiceId, normalizedDraft.year, normalizedDraft.seq);
    snapshot = buildFinalizedSnapshot(normalizedDraft, settings, seq);
    await db.execute(
      `UPDATE invoices SET
         seq = ?, year = ?, status = 'finalized', finalized_at = ?,
         subtotal_cents = ?, tax_cents = ?, total_cents = ?, snapshot_json = ?
       WHERE id = ?`,
      [
        seq, normalizedDraft.year, snapshot.issueDate,
        snapshot.totals.subtotalCents, snapshot.totals.taxCents, snapshot.totals.totalCents,
        JSON.stringify(snapshot), invoiceId,
      ],
    );
  });
  if (!snapshot) throw new Error(`Invoice ${invoiceId} could not be finalized.`);
  return snapshot;
}

/** Read a finalized invoice's frozen snapshot. Throws if not finalized. */
export async function reprintSnapshot(db: Db, invoiceId: number): Promise<FinalizedSnapshot> {
  const [row] = await db.select<{ snapshot_json: string | null }>(
    'SELECT snapshot_json FROM invoices WHERE id = ?', [invoiceId]);
  if (!row?.snapshot_json) throw new Error(`Invoice ${invoiceId} is not finalized`);
  return JSON.parse(row.snapshot_json) as FinalizedSnapshot;
}

export interface YearRollup {
  count: number;
  totalBilledCents: number;
  totalTaxCents: number;
}

export interface InvoiceListItem {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  totalCents: number;
}

/** Calendar years (of issue_date) that have at least one non-void invoice, descending. */
export async function listYears(db: Db): Promise<number[]> {
  const rows = await db.select<{ y: number }>(
    `SELECT DISTINCT CAST(substr(issue_date, 1, 4) AS INTEGER) AS y
       FROM invoices WHERE status != 'void' AND issue_date != ''
      ORDER BY y DESC`,
  );
  return rows.map((r) => r.y);
}

export async function yearRollup(db: Db, year: number): Promise<YearRollup> {
  const [r] = await db.select<{ count: number; billed: number; tax: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS billed,
            COALESCE(SUM(tax_cents), 0) AS tax
       FROM invoices
      WHERE status = 'finalized' AND CAST(substr(issue_date, 1, 4) AS INTEGER) = ?`,
    [year],
  );
  return { count: r.count, totalBilledCents: r.billed, totalTaxCents: r.tax };
}

export async function listInvoicesForYear(db: Db, year: number): Promise<InvoiceListItem[]> {
  const rows = await db.select<{ id: number; year: number; seq: number; issue_date: string; total_cents: number }>(
    `SELECT id, year, seq, issue_date, total_cents
       FROM invoices
      WHERE status = 'finalized' AND CAST(substr(issue_date, 1, 4) AS INTEGER) = ?
      ORDER BY seq ASC`,
    [year],
  );
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: `${r.seq}-${r.year}`,
    issueDate: r.issue_date,
    totalCents: r.total_cents,
  }));
}

/** Search finalized invoices by number, issue date, client, location, VIN, or inspection #. */
export async function searchInvoices(db: Db, query: string): Promise<InvoiceListItem[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  const rows = await db.select<{ id: number; year: number; seq: number; issue_date: string; total_cents: number }>(
    `SELECT DISTINCT i.id, i.year, i.seq, i.issue_date, i.total_cents
       FROM invoices i
       LEFT JOIN line_items li ON li.invoice_id = i.id
      WHERE i.status = 'finalized' AND (
            i.issue_date LIKE ?
         OR (i.seq || '-' || i.year) LIKE ?
         OR li.client_name LIKE ?
         OR li.location LIKE ?
         OR li.vin8 LIKE ?
         OR li.inspection_number LIKE ?)
      ORDER BY i.year DESC, i.seq ASC`,
    [like, like, like, like, like, like],
  );
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: `${r.seq}-${r.year}`,
    issueDate: r.issue_date,
    totalCents: r.total_cents,
  }));
}

export interface BilledHistory {
  /** vin8 -> the invoice number it was already billed on */
  vins: Record<string, string>;
  /** inspection # -> the invoice number it was already billed on */
  inspections: Record<string, string>;
}

/** Every VIN / inspection # already on a FINALIZED invoice, for the double-billing guard. */
export async function loadBilledHistory(db: Db): Promise<BilledHistory> {
  const rows = await db.select<{ vin8: string; inspection_number: string; year: number; seq: number }>(
    `SELECT li.vin8, li.inspection_number, i.year, i.seq
       FROM line_items li JOIN invoices i ON i.id = li.invoice_id
      WHERE i.status = 'finalized'
      ORDER BY i.year, i.seq`,
  );
  const vins: Record<string, string> = {};
  const inspections: Record<string, string> = {};
  for (const r of rows) {
    const num = `${r.seq}-${r.year}`;
    if (r.vin8) vins[r.vin8] = num;
    if (r.inspection_number) inspections[r.inspection_number] = num;
  }
  return { vins, inspections };
}

/** id of the most-recently-created draft invoice, or null. Used to reopen on launch. */
export async function latestDraftId(db: Db): Promise<number | null> {
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM invoices WHERE status = 'draft' ORDER BY id DESC LIMIT 1",
  );
  return rows[0]?.id ?? null;
}

/** Copy an invoice's line items into a brand-new draft (new dates). Returns the draft id. */
export async function duplicateInvoice(db: Db, sourceId: number, header: DraftHeader): Promise<number> {
  const src = await loadDraft(db, sourceId);
  const id = await createDraft(db, header);
  await saveDraft(db, id, {
    year: header.year, issueDate: header.issueDate,
    periodStart: header.periodStart, periodEnd: header.periodEnd,
    lines: src.lines.map((l, i) => ({ ...l, position: i })),
  });
  return id;
}

export interface ClientBreakdownRow {
  clientName: string;
  count: number;
  subtotalCents: number;
}

/** Per-client pre-tax subtotal across a calendar year of finalized invoices (tax-time aid). */
export async function yearClientBreakdown(db: Db, year: number): Promise<ClientBreakdownRow[]> {
  return db.select<ClientBreakdownRow>(
    `SELECT li.client_name AS clientName,
            COUNT(*) AS count,
            COALESCE(SUM(li.fee_cents + li.mileage_cents), 0) AS subtotalCents
       FROM line_items li
       JOIN invoices i ON i.id = li.invoice_id
      WHERE i.status = 'finalized' AND CAST(substr(i.issue_date, 1, 4) AS INTEGER) = ?
      GROUP BY li.client_name
      ORDER BY subtotalCents DESC`,
    [year],
  );
}

/** Rollup over an inclusive issue-date range [start, end] (ISO dates). */
export async function rangeRollup(db: Db, start: string, end: string): Promise<YearRollup> {
  const [r] = await db.select<{ count: number; billed: number; tax: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS billed,
            COALESCE(SUM(tax_cents), 0) AS tax
       FROM invoices
      WHERE status = 'finalized' AND issue_date >= ? AND issue_date <= ?`,
    [start, end],
  );
  return { count: r.count, totalBilledCents: r.billed, totalTaxCents: r.tax };
}

/** Per-client pre-tax subtotal over an inclusive issue-date range. */
export async function rangeClientBreakdown(db: Db, start: string, end: string): Promise<ClientBreakdownRow[]> {
  return db.select<ClientBreakdownRow>(
    `SELECT li.client_name AS clientName,
            COUNT(*) AS count,
            COALESCE(SUM(li.fee_cents + li.mileage_cents), 0) AS subtotalCents
       FROM line_items li
       JOIN invoices i ON i.id = li.invoice_id
      WHERE i.status = 'finalized' AND i.issue_date >= ? AND i.issue_date <= ?
      GROUP BY li.client_name
      ORDER BY subtotalCents DESC`,
    [start, end],
  );
}

/** The seq the next finalize will assign for a year (does NOT mutate the counter). */
export async function peekNextSeq(db: Db, year: number, excludeInvoiceId?: number): Promise<number> {
  const params: unknown[] = [year];
  const exclude = excludeInvoiceId === undefined ? '' : ' AND id != ?';
  if (excludeInvoiceId !== undefined) params.push(excludeInvoiceId);
  const rows = await db.select<{ max_seq: number | null }>(
    `SELECT MAX(seq) AS max_seq FROM invoices WHERE year = ? AND seq IS NOT NULL${exclude}`,
    params,
  );
  const counter = await db.select<{ last_seq: number }>('SELECT last_seq FROM year_counters WHERE year = ?', [year]);
  return Math.max(counter[0]?.last_seq ?? 0, rows[0]?.max_seq ?? 0) + 1;
}

/** Cancel a finalized invoice: mark it void (kept in the DB, excluded from totals/History). */
export async function voidInvoice(db: Db, id: number): Promise<void> {
  await db.execute("UPDATE invoices SET status = 'void' WHERE id = ? AND status = 'finalized'", [id]);
}

/** Cancelled invoices: newest year first, then invoice number ascending. */
export async function listVoided(db: Db): Promise<InvoiceListItem[]> {
  const rows = await db.select<{ id: number; year: number; seq: number; issue_date: string; total_cents: number }>(
    `SELECT id, year, seq, issue_date, total_cents FROM invoices WHERE status = 'void' ORDER BY year DESC, seq ASC`,
  );
  return rows.map((r) => ({ id: r.id, invoiceNumber: `${r.seq}-${r.year}`, issueDate: r.issue_date, totalCents: r.total_cents }));
}

/** Restore a cancelled invoice back to finalized (keeps its original number + snapshot). */
export async function unvoidInvoice(db: Db, id: number): Promise<void> {
  await db.execute("UPDATE invoices SET status = 'finalized' WHERE id = ? AND status = 'void'", [id]);
}

/** An invoice's status ('draft' | 'finalized' | 'void'), or null if it doesn't exist. */
export async function getInvoiceStatus(db: Db, id: number): Promise<string | null> {
  const [row] = await db.select<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [id]);
  return row?.status ?? null;
}

/**
 * Permanently delete a cancelled invoice (and its line items). Only acts on voided
 * invoices — a finalized one must be cancelled first. Returns true if a row was deleted.
 */
export async function deleteVoidedInvoice(db: Db, id: number): Promise<boolean> {
  const [row] = await db.select<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [id]);
  if (row?.status !== 'void') return false;
  await runInTransaction(db, async () => {
    await db.execute('DELETE FROM line_items WHERE invoice_id = ?', [id]);
    await db.execute('DELETE FROM invoices WHERE id = ?', [id]);
  });
  return true;
}
