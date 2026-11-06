import { expect, test } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { createDraft, finalizeInvoice, saveDraft, unvoidInvoice, voidInvoice } from './invoice-repo';
import type { Db, DbStatement } from './db';
import type { LineItem } from '../types';

const CAPTURED = 'batch captured for native replay';
const FIXTURE = '../../../src-tauri/test-fixtures/identifier-guard-batches.json';

function row(type: LineItem['type'], inspectionNumber: string, vin8: string): LineItem {
  return {
    type, position: 0, inspectionNumber, clientId: null, clientName: 'Acme Lease Corp',
    locationId: null, location: 'Maplewood', date: '2026-04-06', vin8, mileageCents: 0,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '',
    feeCents: type === 'completed' ? 3800 : 2500,
  };
}

async function draft(db: Db, issueDate: string, line: LineItem, seq: number | null): Promise<number> {
  const header = { year: Number(issueDate.slice(0, 4)), issueDate, periodStart: issueDate, periodEnd: issueDate };
  const id = await createDraft(db, header);
  await saveDraft(db, id, { ...header, seq, lines: [line] });
  return id;
}

/** The exact batch an operation hands to the native transaction command, without applying it. */
async function capture(db: Db, operation: (capturing: Db) => Promise<unknown>): Promise<DbStatement[]> {
  let batch: DbStatement[] | null = null;
  const capturing: Db = {
    execute: (sql, params) => db.execute(sql, params),
    select: db.select.bind(db),
    executeTransaction: async (statements) => {
      batch = statements;
      throw new Error(CAPTURED);
    },
  };
  await expect(operation(capturing)).rejects.toThrow(CAPTURED);
  expect(batch).not.toBeNull();
  return batch!;
}

/** INSERTs that rebuild every row finalize and restore read or write. */
async function seed(db: Db): Promise<DbStatement[]> {
  const statements: DbStatement[] = [];
  for (const table of ['invoices', 'line_items', 'year_counters']) {
    for (const values of await db.select<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid`)) {
      const columns = Object.keys(values);
      statements.push({
        sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        params: columns.map((column) => values[column]),
        expectedRowsAffected: 1,
      });
    }
  }
  return statements;
}

/**
 * Captures the finalize and restore batches the app sends to native SQLite, all computed
 * from ONE state in which every precheck passes, so `src-tauri/src/database.rs` can replay
 * them as racing writers. Fails when the SQL changes: regenerate with
 * `npx vitest run src/lib/db/identifierGuardNativeFixture.test.ts --update`, then run `cargo test`.
 */
test('native replay fixture matches the batches finalize and restore send today', async () => {
  const db = await createSqlJsDb();
  await runMigrations(db);
  const cancelled = await draft(db, '2026-04-06', row('completed', 'R-100', 'RACEVIN1'), null);
  await finalizeInvoice(db, cancelled);
  await voidInvoice(db, cancelled);
  const ids = {
    cancelled,
    // Automatic numbers in different years: their reservations never collide with each
    // other, so only the identifier guard can decide which one wins.
    completedA: await draft(db, '2026-04-13', row('completed', 'R-200', 'RACEVIN1'), null),
    completedB: await draft(db, '2027-01-04', row('completed', 'R-300', 'RACEVIN1'), null),
    // Shares only the inspection # with the cancelled invoice.
    inspectionC: await draft(db, '2026-04-20', row('completed', 'R-100', 'OTHERVN1'), 4),
    noShow: await draft(db, '2026-04-27', row('noshow', 'R-100', 'RACEVIN1'), 5),
  };

  const fixture = {
    ids,
    seed: await seed(db),
    finalizeA: await capture(db, (capturing) => finalizeInvoice(capturing, ids.completedA)),
    finalizeB: await capture(db, (capturing) => finalizeInvoice(capturing, ids.completedB)),
    finalizeC: await capture(db, (capturing) => finalizeInvoice(capturing, ids.inspectionC)),
    finalizeNoShow: await capture(db, (capturing) => finalizeInvoice(capturing, ids.noShow)),
    restoreCancelled: await capture(db, (capturing) => unvoidInvoice(capturing, ids.cancelled)),
  };

  await expect(`${JSON.stringify(fixture, null, 2)}\n`).toMatchFileSnapshot(FIXTURE);
});
