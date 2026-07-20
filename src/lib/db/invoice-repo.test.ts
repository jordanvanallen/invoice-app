import { test, expect, describe } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { addEntry, deleteEntryIfUnused, listEntries, renameEntry, setActive } from './catalog-repo';
import { createDraft, loadDraft, saveDraft, saveDraftInDateOrder, finalizeInvoice, reprintSnapshot, listYears, listInvoicesForYear, yearRollup, latestDraftId, duplicateInvoice, yearClientBreakdown, rangeRollup, rangeClientBreakdown, peekNextSeq, voidInvoice, listVoided, unvoidInvoice, searchInvoices, loadBilledHistory, getInvoiceStatus, deleteVoidedInvoice } from './invoice-repo';
import { allocateSeq } from './numbering-repo';
import { getSettings, saveSettings } from './settings-repo';
import type { LineItem } from '../types';
import { executeStatementsAtomically, type Db, type DbResult } from './db';

async function freshDb() {
  const db = await createSqlJsDb();
  await runMigrations(db);
  return db;
}

function withoutSqlTransactions(db: Db): Db {
  return {
    async execute(sql: string, params: unknown[] = []): Promise<DbResult> {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        throw new Error(`raw transaction command is not supported: ${sql}`);
      }
      return db.execute(sql, params);
    },
    select: db.select.bind(db),
    executeTransaction: (statements) => executeStatementsAtomically(db, statements),
  };
}

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: null,
    clientName: 'Acme Lease Corp', locationId: null, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '',
    feeCents: 3800, ...over,
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
    expect(draft.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mileageApproverId: null,
        mileageApproverName: '',
        mileageApprovalDate: '',
      }),
    ]));
  });

  test('saveDraft works on adapters that do not support raw transaction commands', async () => {
    const base = await freshDb();
    const db = withoutSqlTransactions(base);
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });

    await saveDraft(db, id, {
      seq: 1,
      year: 2026,
      issueDate: '2026-05-28',
      periodStart: '2026-05-21',
      periodEnd: '2026-05-27',
      lines: [line()],
    });

    expect((await loadDraft(db, id)).lines).toHaveLength(1);
  });

  test.each(['finalized', 'void'] as const)(
    'rejects an adapter-path save against a %s invoice without changing header or lines',
    async (status) => {
      const db = await freshDb();
      const id = await createDraft(db, {
        year: 2026, issueDate: '2026-05-28',
        periodStart: '2026-05-21', periodEnd: '2026-05-27',
      });
      await saveDraft(db, id, {
        year: 2026, issueDate: '2026-05-28',
        periodStart: '2026-05-21', periodEnd: '2026-05-27',
        lines: [line()],
      });
      await finalizeInvoice(db, id);
      if (status === 'void') await voidInvoice(db, id);
      const invoiceBefore = await db.select('SELECT * FROM invoices WHERE id = ?', [id]);
      const linesBefore = await db.select(
        'SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id',
        [id],
      );
      let batches = 0;
      const adapterDb: Db = {
        execute: async (sql, params) => {
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
            throw new Error(`raw transaction command is not supported: ${sql}`);
          }
          return db.execute(sql, params);
        },
        select: db.select.bind(db),
        executeTransaction: async (statements) => {
          batches += 1;
          return executeStatementsAtomically(db, statements);
        },
      };

      await expect(saveDraft(adapterDb, id, {
        year: 2030, issueDate: '2030-01-10',
        periodStart: '2030-01-01', periodEnd: '2030-01-09',
        lines: [line({ inspectionNumber: '87654321', vin8: 'NEWVIN88' })],
      })).rejects.toThrow(/expected 1 row.*affected 0/i);

      expect(batches).toBe(1);
      expect(await db.select('SELECT * FROM invoices WHERE id = ?', [id])).toEqual(invoiceBefore);
      expect(await db.select(
        'SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id',
        [id],
      )).toEqual(linesBefore);
    },
  );

  test('saveDraftInDateOrder persists separate chronological sections and canonical positions', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
    });

    await saveDraftInDateOrder(db, id, {
      seq: null,
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
      lines: [
        line({ inspectionNumber: 'completed-new', date: '2026-07-14', position: 8 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-new', date: '2026-07-13', position: 3 }),
        line({ inspectionNumber: 'completed-old', date: '2026-07-01', position: 6 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-old', date: '2026-07-02', position: 2 }),
      ],
    });

    const saved = await loadDraft(db, id);
    expect(saved.lines.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(saved.lines.map((row) => row.position)).toEqual([0, 1, 2, 3]);
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

  test('round-trips a linked approval and resolves an approver rename in a draft', async () => {
    const db = await freshDb();
    const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({
        mileageCents: 1800, mileageApproverId: approverId,
        mileageApproverName: 'Jordan Lee', mileageApprovalDate: '2026-07-18',
      })],
    });
    await renameEntry(db, 'approvers', approverId, 'Jordan A. Lee');
    expect((await loadDraft(db, id)).lines[0]).toMatchObject({
      mileageApproverId: approverId,
      mileageApproverName: 'Jordan A. Lee',
      mileageApprovalDate: '2026-07-18',
    });
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

  test('retries automatic allocation when another automatic finalization wins the first number', async () => {
    const db = await freshDb();
    const firstId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    const secondId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-21',
      periodStart: '2026-07-14', periodEnd: '2026-07-20',
    });
    await saveDraft(db, firstId, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({ inspectionNumber: '10000001', vin8: 'FIRST001' })],
    });
    await saveDraft(db, secondId, {
      year: 2026, issueDate: '2026-07-21',
      periodStart: '2026-07-14', periodEnd: '2026-07-20',
      lines: [line({ inspectionNumber: '10000002', vin8: 'SECOND02' })],
    });
    let competingFinalized = false;
    const racingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        if (!competingFinalized && statements.some((statement) => statement.sql.includes("status = 'finalized'"))) {
          competingFinalized = true;
          await finalizeInvoice(db, secondId);
        }
        return executeStatementsAtomically(db, statements);
      },
    };

    const firstSnapshot = await finalizeInvoice(racingDb, firstId);
    const competingSnapshot = await reprintSnapshot(db, secondId);

    expect(competingFinalized).toBe(true);
    expect(competingSnapshot.invoiceNumber).toBe('1-2026');
    expect(firstSnapshot.invoiceNumber).toBe('2-2026');
    expect(await reprintSnapshot(db, firstId)).toEqual(firstSnapshot);
    expect(await reprintSnapshot(db, secondId)).toEqual(competingSnapshot);
    expect(await db.select(
      'SELECT id, seq, status FROM invoices WHERE id IN (?, ?) ORDER BY seq',
      [firstId, secondId],
    )).toEqual([
      { id: secondId, seq: 1, status: 'finalized' },
      { id: firstId, seq: 2, status: 'finalized' },
    ]);
    expect(await db.select('SELECT year, last_seq FROM year_counters'))
      .toEqual([{ year: 2026, last_seq: 2 }]);
  });

  test('retries automatic allocation above a concurrently finalized higher manual number', async () => {
    const db = await freshDb();
    const automaticId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    const manualId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-21',
      periodStart: '2026-07-14', periodEnd: '2026-07-20',
    });
    const automaticDraft = {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({ inspectionNumber: '20000001', vin8: 'AUTOM001' })],
    };
    const manualDraft = {
      year: 2026, issueDate: '2026-07-21',
      periodStart: '2026-07-14', periodEnd: '2026-07-20',
      lines: [line({ inspectionNumber: '20000002', vin8: 'MANUAL02' })],
    };
    await saveDraft(db, automaticId, automaticDraft);
    await saveDraft(db, manualId, manualDraft);
    let manualFinalized = false;
    const racingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        if (!manualFinalized && statements.some((statement) => statement.sql.includes("status = 'finalized'"))) {
          manualFinalized = true;
          await saveDraft(db, manualId, { ...manualDraft, seq: 9 });
          await finalizeInvoice(db, manualId);
        }
        return executeStatementsAtomically(db, statements);
      },
    };

    const automaticSnapshot = await finalizeInvoice(racingDb, automaticId);
    const manualSnapshot = await reprintSnapshot(db, manualId);

    expect(manualFinalized).toBe(true);
    expect(manualSnapshot.invoiceNumber).toBe('9-2026');
    expect(automaticSnapshot.invoiceNumber).toBe('10-2026');
    expect(await reprintSnapshot(db, automaticId)).toEqual(automaticSnapshot);
    expect(await reprintSnapshot(db, manualId)).toEqual(manualSnapshot);
    expect(await db.select(
      'SELECT id, seq, status FROM invoices WHERE id IN (?, ?) ORDER BY seq',
      [automaticId, manualId],
    )).toEqual([
      { id: manualId, seq: 9, status: 'finalized' },
      { id: automaticId, seq: 10, status: 'finalized' },
    ]);
    expect(await db.select('SELECT year, last_seq FROM year_counters'))
      .toEqual([{ year: 2026, last_seq: 10 }]);
  });

  test.each([
    { sequenceKind: 'automatic', seq: null },
    { sequenceKind: 'manual', seq: 9 },
  ])('rejects an invalid approval before $sequenceKind sequence mutation', async ({ seq }) => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      seq,
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({
        mileageCents: 1800,
        mileageApproverId: null,
        mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-07-18',
      })],
    });

    await expect(finalizeInvoice(db, id)).rejects.toThrow(/saved approver/i);
    expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
    expect(await db.select(
      'SELECT status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, subtotal_cents: 0,
      tax_cents: 0, total_cents: 0, snapshot_json: null,
    }]);
  });

  test('retries a competing sequence write and leaves no partial first attempt', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line()],
    });
    let raceInjected = false;
    const failingDb: Db = {
      supportsSqlTransactions: true,
      select: async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
        const rows = await db.select<T>(sql, params);
        if (!raceInjected && sql.includes('(SELECT MAX(seq) FROM invoices')) {
          raceInjected = true;
          await db.execute(
            `INSERT INTO invoices
               (year, seq, status, issue_date, period_start, period_end)
             VALUES (2026, 1, 'finalized', '2026-07-20', '2026-07-13', '2026-07-19')`,
          );
        }
        return rows;
      },
      execute: (sql, params) => db.execute(sql, params),
    };

    const snapshot = await finalizeInvoice(failingDb, id);

    expect(raceInjected).toBe(true);
    expect(snapshot.invoiceNumber).toBe('2-2026');
    expect(await reprintSnapshot(db, id)).toEqual(snapshot);
    expect(await db.select('SELECT * FROM year_counters'))
      .toEqual([{ year: 2026, last_seq: 2 }]);
    expect(await db.select(
      'SELECT seq, status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
      [id],
    )).toEqual([{
      seq: 2, status: 'finalized', finalized_at: '2026-07-20', subtotal_cents: 3800,
      tax_cents: 494, total_cents: 4294, snapshot_json: JSON.stringify(snapshot),
    }]);
  });

  test('does not retry an arbitrary finalization SQL error and rolls back the entire batch', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line()],
    });
    await db.execute(`CREATE TRIGGER fail_invoice_finalize
      BEFORE UPDATE ON invoices
      WHEN NEW.status = 'finalized'
      BEGIN
        SELECT RAISE(FAIL, 'injected finalization failure');
      END`);
    let batches = 0;
    const failingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        batches += 1;
        return executeStatementsAtomically(db, statements);
      },
    };

    await expect(finalizeInvoice(failingDb, id)).rejects.toThrow(/injected finalization failure/i);

    expect(batches).toBe(1);
    expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
    expect(await db.select(
      'SELECT status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, subtotal_cents: 0,
      tax_cents: 0, total_cents: 0, snapshot_json: null,
    }]);
  });

  test('bounds repeated automatic reservation conflicts without persisting partial state', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line()],
    });
    let attempts = 0;
    const conflictingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async () => {
        attempts += 1;
        throw new Error('Expected 1 row(s) affected; affected 0.');
      },
    };

    await expect(finalizeInvoice(conflictingDb, id)).rejects.toThrow(
      /expected 1 row.*affected 0/i,
    );

    expect(attempts).toBe(3);
    expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
    expect(await db.select(
      'SELECT status, finalized_at, snapshot_json FROM invoices WHERE id = ?', [id],
    )).toEqual([{ status: 'draft', finalized_at: null, snapshot_json: null }]);
  });

  test('rejects a stale finalization when a concurrent save advances the draft revision', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({ inspectionNumber: '11111111', vin8: 'OLDVIN11' })],
    });
    const latestDraft = {
      year: 2026, issueDate: '2026-07-21',
      periodStart: '2026-07-14', periodEnd: '2026-07-20',
      lines: [line({
        inspectionNumber: '22222222', vin8: 'NEWVIN22',
        date: '2026-07-20', feeCents: 4100,
      })],
    };
    let saveInjected = false;
    const racingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        if (!saveInjected && statements.some((statement) => statement.sql.includes("status = 'finalized'"))) {
          saveInjected = true;
          await saveDraft(db, id, latestDraft);
        }
        return executeStatementsAtomically(db, statements);
      },
    };

    await expect(finalizeInvoice(racingDb, id)).rejects.toThrow(/expected 1 row.*affected 0/i);

    expect(saveInjected).toBe(true);
    expect(await loadDraft(db, id)).toEqual({ seq: null, ...latestDraft });
    expect(await db.select('SELECT draft_revision FROM invoices WHERE id = ?', [id]))
      .toEqual([{ draft_revision: 2 }]);
    expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
    expect(await db.select(
      'SELECT status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, subtotal_cents: 0,
      tax_cents: 0, total_cents: 0, snapshot_json: null,
    }]);
  });

  test('rejects a stale finalization when approver deletion invalidates its loaded draft', async () => {
    const db = await freshDb();
    const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({
        mileageCents: 1800,
        mileageApproverId: approverId,
        mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-07-18',
      })],
    });
    let deletionInjected = false;
    const racingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        if (!deletionInjected && statements.some((statement) => statement.sql.includes("status = 'finalized'"))) {
          deletionInjected = true;
          expect(await deleteEntryIfUnused(db, 'approvers', approverId)).toBe(true);
        }
        return executeStatementsAtomically(db, statements);
      },
    };

    await expect(finalizeInvoice(racingDb, id)).rejects.toThrow(/expected 1 row.*affected 0/i);

    expect(deletionInjected).toBe(true);
    expect(await listEntries(db, 'approvers')).toEqual([]);
    expect(await db.select(
      `SELECT mileage_approver_id, mileage_approver_name
         FROM line_items WHERE invoice_id = ?`,
      [id],
    )).toEqual([{
      mileage_approver_id: null,
      mileage_approver_name: 'Jordan Lee',
    }]);
    expect(await db.select('SELECT draft_revision FROM invoices WHERE id = ?', [id]))
      .toEqual([{ draft_revision: 2 }]);
    expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
    expect(await db.select(
      'SELECT status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
      [id],
    )).toEqual([{
      status: 'draft', finalized_at: null, subtotal_cents: 0,
      tax_cents: 0, total_cents: 0, snapshot_json: null,
    }]);
  });

  test('finalize stores a date-ordered snapshot that reprints identically', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
    });
    await saveDraft(db, id, {
      seq: null,
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
      lines: [
        line({ inspectionNumber: 'completed-new', date: '2026-07-14', position: 0 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-new', date: '2026-07-13', position: 1 }),
        line({ inspectionNumber: 'completed-old', date: '2026-07-01', position: 2 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-old', date: '2026-07-02', position: 3 }),
      ],
    });

    const finalized = await finalizeInvoice(db, id);
    const reprinted = await reprintSnapshot(db, id);

    expect(finalized.lines.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(reprinted.lines).toEqual(finalized.lines);
  });

  test('finalizeInvoice works on adapters that do not support raw transaction commands', async () => {
    const base = await freshDb();
    const db = withoutSqlTransactions(base);
    const id = await createDraft(db, { year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27' });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-05-28', periodStart: '2026-05-21', periodEnd: '2026-05-27',
      lines: [line()],
    });

    const snap = await finalizeInvoice(db, id);

    expect(snap.invoiceNumber).toBe('1-2026');
    expect(await getInvoiceStatus(db, id)).toBe('finalized');
  });

  test('saveDraft preserves a selected invoice sequence on reload', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-06-21', periodStart: '2026-06-15', periodEnd: '2026-06-21' });

    await saveDraft(db, id, {
      seq: 11,
      year: 2026,
      issueDate: '2026-06-21',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      lines: [line()],
    });

    expect((await loadDraft(db, id)).seq).toBe(11);
  });

  test('finalizes with the selected sequence and advances the next default', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-06-21', periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    await saveDraft(db, id, {
      seq: 11,
      year: 2026,
      issueDate: '2026-06-21',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      lines: [line()],
    });

    const snap = await finalizeInvoice(db, id);

    expect(snap.invoiceNumber).toBe('11-2026');
    expect(await peekNextSeq(db, 2026)).toBe(12);
  });

  test('finalize derives the invoice year from issueDate when the saved draft year mismatches', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-12-30', periodStart: '2026-12-15', periodEnd: '2026-12-30' });
    await saveDraft(db, id, {
      seq: 11,
      year: 2026,
      issueDate: '2027-01-03',
      periodStart: '2026-12-15',
      periodEnd: '2026-12-30',
      lines: [line()],
    });

    const snap = await finalizeInvoice(db, id);
    const [row] = await db.select<{ year: number; seq: number }>(
      'SELECT year, seq FROM invoices WHERE id = ?',
      [id],
    );

    expect(snap.invoiceNumber).toBe('11-2027');
    expect(snap.year).toBe(2027);
    expect(row.year).toBe(2027);
    expect(row.seq).toBe(11);
    expect(await peekNextSeq(db, 2027)).toBe(12);
  });

  test('rejects saving a selected sequence already used by another invoice in the year', async () => {
    const db = await freshDb();
    const first = await createDraft(db, { year: 2026, issueDate: '2026-06-21', periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    await saveDraft(db, first, {
      seq: 11,
      year: 2026,
      issueDate: '2026-06-21',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      lines: [line()],
    });
    await finalizeInvoice(db, first);

    const second = await createDraft(db, { year: 2026, issueDate: '2026-06-22', periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    await expect(saveDraft(db, second, {
      seq: 11,
      year: 2026,
      issueDate: '2026-06-22',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      lines: [line({ inspectionNumber: '22222222', vin8: 'XY12AB98' })],
    })).rejects.toThrow('Invoice number 11 is already used this year.');
  });

  test('peekNextSeq follows the highest stored sequence while ignoring the current draft', async () => {
    const db = await freshDb();
    const id = await createDraft(db, { year: 2026, issueDate: '2026-06-21', periodStart: '2026-06-15', periodEnd: '2026-06-21' });
    await saveDraft(db, id, {
      seq: 11,
      year: 2026,
      issueDate: '2026-06-21',
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      lines: [line()],
    });

    expect(await peekNextSeq(db, 2026)).toBe(12);
    expect(await peekNextSeq(db, 2026, id)).toBe(1);
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

  test('reprint retains the finalized approver after catalog rename and deactivation', async () => {
    const db = await freshDb();
    const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
    const id = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, id, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({
        mileageCents: 1800,
        mileageApproverId: approverId,
        mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-07-18',
      })],
    });

    const finalized = await finalizeInvoice(db, id);
    await renameEntry(db, 'approvers', approverId, 'Jordan A. Lee');
    await setActive(db, 'approvers', approverId, false);
    const reprinted = await reprintSnapshot(db, id);

    expect(finalized.lines[0]).toMatchObject({
      mileageApproverId: approverId,
      mileageApproverName: 'Jordan Lee',
      mileageApprovalDate: '2026-07-18',
    });
    expect(reprinted.lines[0]).toMatchObject({
      mileageApproverId: approverId,
      mileageApproverName: 'Jordan Lee',
      mileageApprovalDate: '2026-07-18',
    });
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

  test('orders active and searched invoice history by number ascending within the year', async () => {
    const db = await freshDb();
    await finalizedInvoice(db, '2026-06-30');
    await finalizedInvoice(db, '2026-05-01');
    await finalizedInvoice(db, '2026-06-01');

    expect((await listInvoicesForYear(db, 2026)).map((invoice) => invoice.invoiceNumber))
      .toEqual(['1-2026', '2-2026', '3-2026']);
    expect((await searchInvoices(db, 'Acme Lease Corp')).map((invoice) => invoice.invoiceNumber))
      .toEqual(['1-2026', '2-2026', '3-2026']);
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
    await saveDraft(db, b, {
      year: 2026, issueDate: '2026-06-04',
      periodStart: '2026-05-28', periodEnd: '2026-06-03',
      lines: [line()],
    });
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

  test('derives the duplicate year from its issue date', async () => {
    const db = await freshDb();
    const sourceId = await createDraft(db, {
      year: 2026, issueDate: '2026-12-31',
      periodStart: '2026-12-20', periodEnd: '2026-12-31',
    });
    await saveDraft(db, sourceId, {
      year: 2026, issueDate: '2026-12-31',
      periodStart: '2026-12-20', periodEnd: '2026-12-31',
      lines: [line()],
    });

    const duplicateId = await duplicateInvoice(db, sourceId, {
      year: 2026, issueDate: '2027-01-03',
      periodStart: '2026-12-27', periodEnd: '2027-01-02',
    });

    expect(await db.select('SELECT year FROM invoices WHERE id = ?', [duplicateId]))
      .toEqual([{ year: 2027 }]);
  });

  test('rolls back a duplicate batch when another invoice claims its explicit id', async () => {
    const db = await freshDb();
    const sourceId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, sourceId, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line()],
    });
    const sourceBefore = await loadDraft(db, sourceId);
    const sourceRowsBefore = await db.select(
      'SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id',
      [sourceId],
    );
    let claimedId: number | null = null;
    const racingDb: Db = {
      execute: (sql, params) => db.execute(sql, params),
      select: db.select.bind(db),
      executeTransaction: async (statements) => {
        claimedId = Number(statements[0]?.params?.[0]);
        await db.execute(
          `INSERT INTO invoices
             (id, year, status, issue_date, period_start, period_end)
           VALUES (?, 2026, 'draft', '2026-07-27', '2026-07-20', '2026-07-26')`,
          [claimedId],
        );
        return executeStatementsAtomically(db, statements);
      },
    };

    await expect(duplicateInvoice(racingDb, sourceId, {
      year: 2026, issueDate: '2026-07-27',
      periodStart: '2026-07-20', periodEnd: '2026-07-26',
    })).rejects.toThrow();

    expect(claimedId).not.toBeNull();
    expect(await loadDraft(db, sourceId)).toEqual(sourceBefore);
    expect(await db.select(
      'SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position, id',
      [sourceId],
    )).toEqual(sourceRowsBefore);
    expect(await db.select('SELECT id, status FROM invoices WHERE id = ?', [claimedId]))
      .toEqual([{ id: claimedId, status: 'draft' }]);
    expect(await db.select('SELECT * FROM line_items WHERE invoice_id = ?', [claimedId])).toEqual([]);
  });

  test('clears every approval field for each line and source state', async () => {
    for (const sourceStatus of ['draft', 'finalized', 'void'] as const) {
      const db = await freshDb();
      const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
      const sourceId = await createDraft(db, {
        year: 2026, issueDate: '2026-07-20',
        periodStart: '2026-07-13', periodEnd: '2026-07-19',
      });
      const approved = {
        mileageApproverId: approverId,
        mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-07-18',
      };
      await saveDraft(db, sourceId, {
        year: 2026, issueDate: '2026-07-20',
        periodStart: '2026-07-13', periodEnd: '2026-07-19',
        lines: [
          line({ position: 0, type: 'completed', inspectionNumber: '10000001', vin8: 'VIN00001', mileageCents: 1800, ...approved }),
          line({ position: 1, type: 'completed', inspectionNumber: '10000002', vin8: 'VIN00002', mileageCents: 0, ...approved }),
          line({ position: 2, type: 'noshow', inspectionNumber: '10000003', vin8: 'VIN00003', mileageCents: 1800, ...approved }),
          line({ position: 3, type: 'noshow', inspectionNumber: '10000004', vin8: 'VIN00004', mileageCents: 0, ...approved }),
        ],
      });
      if (sourceStatus !== 'draft') await finalizeInvoice(db, sourceId);
      if (sourceStatus === 'void') await voidInvoice(db, sourceId);
      expect((await loadDraft(db, sourceId)).lines.map((row) => ({
        id: row.mileageApproverId,
        name: row.mileageApproverName,
        date: row.mileageApprovalDate,
      })), sourceStatus).toEqual(Array.from({ length: 4 }, () => ({
        id: approverId,
        name: 'Jordan Lee',
        date: '2026-07-18',
      })));

      const duplicateId = await duplicateInvoice(db, sourceId, {
        year: 2026, issueDate: '2026-07-27',
        periodStart: '2026-07-20', periodEnd: '2026-07-26',
      });

      expect((await loadDraft(db, duplicateId)).lines.map((row) => ({
        type: row.type,
        mileageCents: row.mileageCents,
        id: row.mileageApproverId,
        name: row.mileageApproverName,
        date: row.mileageApprovalDate,
      })), sourceStatus).toEqual([
        { type: 'completed', mileageCents: 1800, id: null, name: '', date: '' },
        { type: 'completed', mileageCents: 0, id: null, name: '', date: '' },
        { type: 'noshow', mileageCents: 1800, id: null, name: '', date: '' },
        { type: 'noshow', mileageCents: 0, id: null, name: '', date: '' },
      ]);
    }
  });

  test('rolls back the destination invoice when copying a line fails', async () => {
    const db = await freshDb();
    const sourceId = await createDraft(db, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
    });
    await saveDraft(db, sourceId, {
      year: 2026, issueDate: '2026-07-20',
      periodStart: '2026-07-13', periodEnd: '2026-07-19',
      lines: [line({ position: 0 }), line({ position: 1, inspectionNumber: '87654321' })],
    });
    const invoicesBefore = await db.select('SELECT * FROM invoices ORDER BY id');
    let lineInserts = 0;
    const failingDb: Db = {
      supportsSqlTransactions: true,
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => {
        if (/^\s*INSERT INTO line_items\b/.test(sql) && ++lineInserts === 2) {
          throw new Error('simulated line copy failure');
        }
        return db.execute(sql, params);
      },
    };

    await expect(duplicateInvoice(failingDb, sourceId, {
      year: 2026, issueDate: '2026-07-27',
      periodStart: '2026-07-20', periodEnd: '2026-07-26',
    })).rejects.toThrow('simulated line copy failure');

    expect(await db.select('SELECT * FROM invoices ORDER BY id')).toEqual(invoicesBefore);
    expect(await db.select('SELECT invoice_id, COUNT(*) AS count FROM line_items GROUP BY invoice_id'))
      .toEqual([{ invoice_id: sourceId, count: 2 }]);
  });
});

describe('yearClientBreakdown', () => {
  test('sums pre-tax subtotal per client for the year, descending', async () => {
    const db = await freshDb();
    const gm = await addEntry(db, 'clients', 'Globex Finance');
    const honda = await addEntry(db, 'clients', 'Summit Motors');
    const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
    async function inv(issueDate: string, lines: LineItem[]) {
      const id = await createDraft(db, { year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate });
      await saveDraft(db, id, { year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate, lines });
      await finalizeInvoice(db, id);
    }
    await inv('2026-05-28', [
      line({ clientId: gm, clientName: 'Globex Finance', feeCents: 3800 }),
      line({
        clientId: gm, clientName: 'Globex Finance', feeCents: 3800, mileageCents: 200,
        mileageApproverId: approverId, mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-05-27',
      }),
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

  test('orders cancelled invoice history by number ascending within the year', async () => {
    const db = await freshDb();
    for (const issueDate of ['2026-06-30', '2026-05-01', '2026-06-01']) {
      const id = await createDraft(db, {
        year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate,
      });
      await saveDraft(db, id, {
        year: 2026, issueDate, periodStart: issueDate, periodEnd: issueDate,
        lines: [line()],
      });
      await finalizeInvoice(db, id);
      await voidInvoice(db, id);
    }

    expect((await listVoided(db)).map((invoice) => invoice.invoiceNumber))
      .toEqual(['1-2026', '2-2026', '3-2026']);
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
