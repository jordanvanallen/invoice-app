import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { addEntry } from './catalog-repo';
import { createDraft, loadDraft, saveDraft, finalizeInvoice, reprintSnapshot, listYears, listInvoicesForYear, yearRollup, latestDraftId, duplicateInvoice, yearClientBreakdown, rangeRollup, rangeClientBreakdown, peekNextSeq, voidInvoice, listVoided, unvoidInvoice, searchInvoices, loadBilledHistory, getInvoiceStatus, deleteVoidedInvoice } from './invoice-repo';
import { allocateSeq } from './numbering-repo';
import { getSettings, saveSettings } from './settings-repo';
import type { LineItem } from '../types';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: null,
    clientName: 'Acme Lease Corp', locationId: null, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0, feeCents: 3800, ...over,
  };
}

describe('invoice draft repo', () => {
  test('create then load returns an empty draft with the given header', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    const draft = await loadDraft(db, id);
    expect(draft.year).toBe(2026);
    expect(draft.periodStart).toBe('2026-05-21');
    expect(draft.lines).toEqual([]);
  });

  test('saveDraft replaces lines; load returns them ordered by position', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line({ position: 1, inspectionNumber: 'B' }), line({ position: 0, inspectionNumber: 'A' })],
    });
    const draft = await loadDraft(db, id);
    expect(draft.lines.map((l) => l.inspectionNumber)).toEqual(['A', 'B']);
  });

  test('a linked client name resolves LIVE — renaming the client updates an open draft', async () => {
    const db = await freshDb();
    const clientId = await addEntry(db, 'clients', 'Globex Finance Grp');
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line({ clientId, clientName: 'stale text' })],
    });
    await db.execute('UPDATE clients SET name = ? WHERE id = ?', ['Globex Finance Group', clientId]);
    const draft = await loadDraft(db, id);
    expect(draft.lines[0].clientName).toBe('Globex Finance Group');
  });
});

describe('finalize + reprint', () => {
  test('assigns number, stores snapshot + totals, sets status', async () => {
    const db = await freshDb();
    const clientId = await addEntry(db, 'clients', 'Acme Lease Corp');
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line({ clientId, clientName: 'Acme Lease Corp' })],
    });
    const snap = await finalizeInvoice(db, id);
    expect(snap.invoiceNumber).toBe('1-2026');
    expect(snap.totals.subtotalCents).toBe(3800);
    expect(snap.totals.taxCents).toBe(494);
    const [row] = await db.select<{ status: string; seq: number; total_cents: number }>(
      'SELECT status, seq, total_cents FROM invoices WHERE id = ?', [id]);
    expect(row.status).toBe('finalized');
    expect(row.seq).toBe(1);
    expect(row.total_cents).toBe(4294);
  });

  test('reprint is value-stable after the client is later renamed', async () => {
    const db = await freshDb();
    const clientId = await addEntry(db, 'clients', 'Globex Finance Grp');
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line({ clientId, clientName: 'Globex Finance Grp' })],
    });
    await finalizeInvoice(db, id);
    await db.execute('UPDATE clients SET name = ? WHERE id = ?', ['Globex Finance Group', clientId]);
    const s = await getSettings(db);
    await saveSettings(db, { ...s, defaultCompletedFeeCents: 4000 });
    const reprinted = await reprintSnapshot(db, id);
    expect(reprinted.lines[0].clientName).toBe('Globex Finance Grp'); // frozen as issued
    expect(reprinted.totals.totalCents).toBe(4294);
  });
});

describe('by-year views', () => {
  async function finalizedInvoice(db: Awaited<ReturnType<typeof freshDb>>, issueDate: string) {
    const id = await createDraft(db, { year: Number(issueDate.slice(0, 4)), issueDate, periodStart: issueDate, periodEnd: issueDate });
    await saveDraft(db, id, {
      year: Number(issueDate.slice(0, 4)), issueDate, periodStart: issueDate, periodEnd: issueDate,
      lines: [line()],
    });
    return finalizeInvoice(db, id);
  }

  test('rollup sums totals for the year and counts invoices', async () => {
    const db = await freshDb();
    await finalizedInvoice(db, '2026-05-28');
    await finalizedInvoice(db, '2026-06-10');
    const r = await yearRollup(db, 2026);
    expect(r.count).toBe(2);
    expect(r.totalBilledCents).toBe(2 * 4294);
    expect(r.totalTaxCents).toBe(2 * 494);
  });

  test('listYears returns distinct issue-date years descending', async () => {
    const db = await freshDb();
    await finalizedInvoice(db, '2026-05-28');
    await finalizedInvoice(db, '2027-01-04');
    expect(await listYears(db)).toEqual([2027, 2026]);
  });

  test('listInvoicesForYear returns finalized invoices for that year', async () => {
    const db = await freshDb();
    const snap = await finalizedInvoice(db, '2026-05-28');
    const list = await listInvoicesForYear(db, 2026);
    expect(list.length).toBe(1);
    expect(list[0].invoiceNumber).toBe(snap.invoiceNumber);
    expect(list[0].totalCents).toBe(4294);
  });
});

describe('latestDraftId', () => {
  test('returns null when there are no drafts, then the newest draft id', async () => {
    const db = await freshDb();
    expect(await latestDraftId(db)).toBeNull();
    const a = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    const b = await createDraft(db, { year: 2026, issueDate: '2026-06-04', periodStart: '2026-05-28', periodEnd: '2026-06-03' });
    expect(await latestDraftId(db)).toBe(b);
    // finalizing the newest leaves the older draft as the latest remaining draft
    await finalizeInvoice(db, b);
    expect(await latestDraftId(db)).toBe(a);
  });
});

describe('duplicateInvoice', () => {
  test('copies lines into a new draft with fresh dates', async () => {
    const db = await freshDb();
    const clientId = await addEntry(db, 'clients', 'Acme Lease Corp');
    const srcId = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, srcId, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line({ clientId, clientName: 'Acme Lease Corp', inspectionNumber: 'X1' })],
    });
    await finalizeInvoice(db, srcId);
    const dupId = await duplicateInvoice(db, srcId, { year: 2026, issueDate: '2026-06-04', periodStart: '2026-05-28', periodEnd: '2026-06-03' });
    expect(dupId).not.toBe(srcId);
    const dup = await loadDraft(db, dupId);
    expect(dup.issueDate).toBe('2026-06-04');
    expect(dup.lines.map((l) => l.inspectionNumber)).toEqual(['X1']);
    const [row] = await db.select<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [dupId]);
    expect(row.status).toBe('draft');
  });
});

describe('yearClientBreakdown', () => {
  test('sums pre-tax subtotal per client for the year, descending', async () => {
    const db = await freshDb();
    const gm = await addEntry(db, 'clients', 'Globex Finance');
    const honda = await addEntry(db, 'clients', 'Summit Motors');
    async function inv(issueDate: string, lines: LineItem[]) {
      const id = await createDraft(db, { year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate });
      await saveDraft(db, id, { year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate, lines });
      await finalizeInvoice(db, id);
    }
    await inv('2026-05-28', [
      line({ clientId: gm, clientName: 'Globex Finance', feeCents: 3800 }),
      line({ clientId: gm, clientName: 'Globex Finance', feeCents: 3800, mileageCents: 200 }),
    ]);
    await inv('2026-06-10', [line({ clientId: honda, clientName: 'Summit Motors', feeCents: 3800 })]);

    const rows = await yearClientBreakdown(db, 2026);
    expect(rows).toEqual([
      { clientName: 'Globex Finance', count: 2, subtotalCents: 7800 },
      { clientName: 'Summit Motors', count: 1, subtotalCents: 3800 },
    ]);
    expect(await yearClientBreakdown(db, 2027)).toEqual([]);
  });
});

describe('range summary', () => {
  async function fin(db: Awaited<ReturnType<typeof freshDb>>, issueDate: string, clientName: string, feeCents: number) {
    const cid = await addEntry(db, 'clients', clientName);
    const id = await createDraft(db, { year: Number(issueDate.slice(0, 4)), issueDate, periodStart: issueDate, periodEnd: issueDate });
    await saveDraft(db, id, { year: Number(issueDate.slice(0, 4)), issueDate, periodStart: issueDate, periodEnd: issueDate, lines: [line({ clientId: cid, clientName, feeCents })] });
    await finalizeInvoice(db, id);
  }
  test('rollup + breakdown respect inclusive date bounds', async () => {
    const db = await freshDb();
    await fin(db, '2026-01-15', 'A Co', 3800); // in
    await fin(db, '2026-03-31', 'B Co', 2500); // in (boundary)
    await fin(db, '2026-04-01', 'C Co', 9900); // out
    const r = await rangeRollup(db, '2026-01-01', '2026-03-31');
    expect(r.count).toBe(2);
    // A: 3800 + 13% (494) = 4294 ; B: 2500 + 13% (325) = 2825
    expect(r.totalTaxCents).toBe(494 + 325);
    expect(r.totalBilledCents).toBe(4294 + 2825);
    const bd = await rangeClientBreakdown(db, '2026-01-01', '2026-03-31');
    expect(bd.map((b) => b.clientName).sort()).toEqual(['A Co', 'B Co']);
  });
});

describe('peekNextSeq', () => {
  test('previews the next seq without consuming it', async () => {
    const db = await freshDb();
    expect(await peekNextSeq(db, 2026)).toBe(1);
    expect(await peekNextSeq(db, 2026)).toBe(1); // peeking does not advance
    await allocateSeq(db, 2026); // now used 1
    expect(await peekNextSeq(db, 2026)).toBe(2);
  });
});

describe('voidInvoice', () => {
  test('marks finalized invoice void and drops it from rollups', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27', lines: [line()] });
    await finalizeInvoice(db, id);
    expect((await yearRollup(db, 2026)).count).toBe(1);
    await voidInvoice(db, id);
    const [row] = await db.select<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [id]);
    expect(row.status).toBe('void');
    expect((await yearRollup(db, 2026)).count).toBe(0);
    expect(await listInvoicesForYear(db, 2026)).toEqual([]);
  });
});

describe('cancelled (void) listing + restore', () => {
  test('void then restore round-trips through the lists and rollups', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27', lines: [line()] });
    const snap = await finalizeInvoice(db, id);

    await voidInvoice(db, id);
    expect((await listVoided(db)).map((v) => v.invoiceNumber)).toEqual([snap.invoiceNumber]);
    expect(await listInvoicesForYear(db, 2026)).toEqual([]); // gone from active

    await unvoidInvoice(db, id);
    expect(await listVoided(db)).toEqual([]); // no longer cancelled
    expect((await listInvoicesForYear(db, 2026)).map((i) => i.invoiceNumber)).toEqual([snap.invoiceNumber]); // back, same number
    expect((await yearRollup(db, 2026)).count).toBe(1);
  });
});

describe('searchInvoices + loadBilledHistory', () => {
  async function finalizeOne(db: Awaited<ReturnType<typeof freshDb>>, over: Partial<LineItem>) {
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line(over)],
    });
    return finalizeInvoice(db, id);
  }

  test('matches client, location, VIN, inspection #, and invoice number; blank/none → empty', async () => {
    const db = await freshDb();
    await finalizeOne(db, { clientName: 'Summit Motors', location: 'Riverton', vin8: 'AB12CD34', inspectionNumber: '99887766' });
    expect((await searchInvoices(db, 'Summit')).length).toBe(1);
    expect((await searchInvoices(db, 'riverton')).length).toBe(1); // case-insensitive
    expect((await searchInvoices(db, 'AB12CD34')).length).toBe(1);
    expect((await searchInvoices(db, '99887766')).length).toBe(1);
    expect((await searchInvoices(db, '1-2026')).length).toBe(1);
    expect((await searchInvoices(db, 'nope')).length).toBe(0);
    expect((await searchInvoices(db, '   ')).length).toBe(0);
  });

  test('loadBilledHistory maps finalized VINs/inspection #s to invoice number; drafts excluded', async () => {
    const db = await freshDb();
    await finalizeOne(db, { vin8: 'XY12AB99', inspectionNumber: '12345678' });
    const draftId = await createDraft(db, { year: 2026, issueDate: '2026-06-01', periodStart: '2026-05-25', periodEnd: '2026-06-01' });
    await saveDraft(db, draftId, {
      year: 2026, issueDate: '2026-06-01', periodStart: '2026-05-25', periodEnd: '2026-06-01',
      lines: [line({ vin8: 'DRAFTVIN', inspectionNumber: '00000001' })],
    });
    const billed = await loadBilledHistory(db);
    expect(billed.vins['XY12AB99']).toBe('1-2026');
    expect(billed.inspections['12345678']).toBe('1-2026');
    expect(billed.vins['DRAFTVIN']).toBeUndefined();
    expect(billed.inspections['00000001']).toBeUndefined();
  });
});

describe('getInvoiceStatus + deleteVoidedInvoice', () => {
  async function finalizeOne(db: Awaited<ReturnType<typeof freshDb>>) {
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line()],
    });
    await finalizeInvoice(db, id);
    return id;
  }

  test('hard-deletes a voided invoice and its line items; finalized is protected', async () => {
    const db = await freshDb();
    const id = await finalizeOne(db);
    expect(await getInvoiceStatus(db, id)).toBe('finalized');

    // refuses to delete a finalized invoice
    expect(await deleteVoidedInvoice(db, id)).toBe(false);
    expect(await getInvoiceStatus(db, id)).toBe('finalized');

    await voidInvoice(db, id);
    expect(await getInvoiceStatus(db, id)).toBe('void');
    expect(await deleteVoidedInvoice(db, id)).toBe(true);

    expect(await getInvoiceStatus(db, id)).toBeNull();
    const [{ c }] = await db.select<{ c: number }>('SELECT COUNT(*) AS c FROM line_items WHERE invoice_id = ?', [id]);
    expect(c).toBe(0);
  });
});
