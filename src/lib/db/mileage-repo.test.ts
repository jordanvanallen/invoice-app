import { describe, expect, test } from 'vitest';
import { createSqlJsDb } from './sqljs-adapter';
import { runMigrations } from './migrate';
import { allocateSeq } from './numbering-repo';
import { getSettings } from './settings-repo';
import {
  createMileageDraft,
  finalizeMileageReport,
  getMileageStatus,
  latestMileageDraftId,
  listFinalizedMileageReports,
  listVoidedMileageReports,
  loadMileageDraft,
  peekNextMileageSeq,
  reprintMileageSnapshot,
  restoreMileageReport,
  saveMileageDraft,
  voidMileageReport,
} from './mileage-repo';
import { buildMileageSnapshot } from '../mileage/snapshot';
import type { MileageDraft, MileageTrip } from '../mileage/types';
import type { Db } from './db';

type TestDb = Awaited<ReturnType<typeof createSqlJsDb>>;

async function freshDb(): Promise<TestDb> {
  const db = await createSqlJsDb();
  await runMigrations(db);
  await db.execute(
    `UPDATE settings SET inspector_name = 'North Star', inspector_address = '1 Main',
       inspector_number = 'ON-7' WHERE id = 1`,
  );
  return db;
}

const header = (over: Partial<Omit<MileageDraft, 'seq' | 'trips'>> = {}) => ({
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  vehicle: 'Ford F-150 · ABC 123',
  ...over,
});

const trip = (over: Partial<MileageTrip> = {}): MileageTrip => ({
  position: 0,
  date: '2026-07-02',
  from: 'Home office',
  to: 'Maplewood lot',
  purpose: 'Lease return inspections',
  startOdometerKm: 48_200,
  endOdometerKm: 48_250,
  ...over,
});

const draft = (over: Partial<MileageDraft> = {}): MileageDraft => ({
  seq: null,
  ...header(),
  trips: [trip()],
  ...over,
});

async function savedDraft(db: Db, over: Partial<MileageDraft> = {}): Promise<number> {
  const value = draft(over);
  const id = await createMileageDraft(db, value);
  await saveMileageDraft(db, id, value);
  return id;
}

async function finalized(db: Db, over: Partial<MileageDraft> = {}): Promise<number> {
  const id = await savedDraft(db, over);
  await finalizeMileageReport(db, id);
  return id;
}

const reportRow = (db: Db, id: number) => db.select(
  `SELECT seq, year, status, finalized_at IS NOT NULL AS has_finalized_at, total_km,
          snapshot_json IS NOT NULL AS has_snapshot
     FROM mileage_reports WHERE id = ?`,
  [id],
);

describe('mileage draft persistence', () => {
  test('saves and reloads an incomplete draft with blank readings null and a zero reading kept', async () => {
    const db = await freshDb();
    const incomplete = draft({
      reportDate: '',
      vehicle: '',
      trips: [
        trip({ date: '', from: '', to: '', purpose: '', startOdometerKm: null, endOdometerKm: null }),
        trip({ position: 1, startOdometerKm: 0, endOdometerKm: null }),
      ],
    });
    const id = await createMileageDraft(db, header());
    await saveMileageDraft(db, id, incomplete);

    expect(await loadMileageDraft(db, id)).toEqual(incomplete);
    expect(await db.select(
      'SELECT start_odometer_km, end_odometer_km FROM mileage_trips WHERE mileage_report_id = ? ORDER BY position',
      [id],
    )).toEqual([
      { start_odometer_km: null, end_odometer_km: null },
      { start_odometer_km: 0, end_odometer_km: null },
    ]);
  });

  test('persists trip order from the array and resumes the newest draft', async () => {
    const db = await freshDb();
    const first = await savedDraft(db);
    const second = await savedDraft(db, {
      trips: [trip({ position: 7, purpose: 'B' }), trip({ position: 3, purpose: 'A' })],
    });

    expect((await loadMileageDraft(db, second)).trips.map((row) => [row.position, row.purpose]))
      .toEqual([[0, 'B'], [1, 'A']]);
    expect(await latestMileageDraftId(db)).toBe(second);
    await finalizeMileageReport(db, second);
    expect(await latestMileageDraftId(db)).toBe(first);
  });

  test('rejects decimal, negative, and unsafe readings without writing any part of the draft', async () => {
    const db = await freshDb();
    const id = await savedDraft(db);
    const before = await loadMileageDraft(db, id);

    for (const bad of [12.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      await expect(saveMileageDraft(db, id, draft({
        vehicle: 'Changed vehicle',
        trips: [trip({ purpose: 'Changed' }), trip({ position: 1, endOdometerKm: bad })],
      }))).rejects.toThrow('Trip 2 has an odometer reading that is not a whole number of kilometres.');
    }
    expect(await loadMileageDraft(db, id)).toEqual(before);
  });

  test('refuses to save into a report that is missing or no longer a draft', async () => {
    const db = await freshDb();
    await expect(saveMileageDraft(db, 999, draft())).rejects.toThrow(/not an editable draft/);
    const id = await finalized(db);
    const rowsBefore = await db.select('SELECT * FROM mileage_trips WHERE mileage_report_id = ?', [id]);

    await expect(saveMileageDraft(db, id, draft({ vehicle: 'Tampered' }))).rejects.toThrow(/not an editable draft/);
    await voidMileageReport(db, id);
    await expect(saveMileageDraft(db, id, draft({ vehicle: 'Tampered' }))).rejects.toThrow(/not an editable draft/);
    expect(await db.select('SELECT * FROM mileage_trips WHERE mileage_report_id = ?', [id])).toEqual(rowsBefore);
    expect((await reprintMileageSnapshot(db, id)).vehicle).toBe('Ford F-150 · ABC 123');
  });

  test('re-checks draft status inside the save transaction', async () => {
    const db = await freshDb();
    const id = await savedDraft(db);
    const racingDb: Db = {
      supportsSqlTransactions: true,
      execute: (sql, params) => db.execute(sql, params),
      select: async (sql, params) => {
        const rows = await db.select(sql, params);
        // The status pre-check passes, then the report is finalized before the write.
        if (sql.startsWith('SELECT status FROM mileage_reports')) {
          await db.execute("UPDATE mileage_reports SET status = 'finalized' WHERE id = ?", [id]);
        }
        return rows as never[];
      },
    };

    await expect(saveMileageDraft(racingDb, id, draft({ vehicle: 'Late edit', trips: [] })))
      .rejects.toThrow(/expected 1 row/i);
    expect((await loadMileageDraft(db, id)).vehicle).toBe('Ford F-150 · ABC 123');
    expect((await loadMileageDraft(db, id)).trips).toHaveLength(1);
  });
});

describe('mileage finalization', () => {
  test('assigns the next number, rewrites canonical rows, and freezes an exact snapshot', async () => {
    const db = await freshDb();
    const id = await savedDraft(db, {
      vehicle: '  Ford F-150 · ABC 123  ',
      trips: [
        trip({ date: '2026-07-10', from: ' Depot ', startOdometerKm: 48_300, endOdometerKm: 48_342 }),
        trip({ position: 1, date: '2026-07-02', startOdometerKm: 0, endOdometerKm: 25 }),
      ],
    });

    const snapshot = await finalizeMileageReport(db, id);

    expect(snapshot).toMatchObject({
      reportNumber: '1-2026', seq: 1, year: 2026,
      vehicle: 'Ford F-150 · ABC 123', inspectorName: 'North Star', totalKm: 67,
    });
    expect(snapshot.trips.map((row) => [row.date, row.from, row.distanceKm])).toEqual([
      ['2026-07-02', 'Home office', 25],
      ['2026-07-10', 'Depot', 42],
    ]);
    expect(await reportRow(db, id)).toEqual([{
      seq: 1, year: 2026, status: 'finalized', has_finalized_at: 1, total_km: 67, has_snapshot: 1,
    }]);
    expect(await loadMileageDraft(db, id)).toMatchObject({
      seq: 1,
      vehicle: 'Ford F-150 · ABC 123',
      trips: [
        { position: 0, date: '2026-07-02', from: 'Home office', startOdometerKm: 0, endOdometerKm: 25 },
        { position: 1, date: '2026-07-10', from: 'Depot', startOdometerKm: 48_300, endOdometerKm: 48_342 },
      ],
    });
    expect(await reprintMileageSnapshot(db, id)).toEqual(snapshot);
    expect(await peekNextMileageSeq(db, 2026)).toBe(2);
    expect((await finalizeMileageReport(db, await savedDraft(db))).reportNumber).toBe('2-2026');
  });

  test('Preview built from the saved draft is the snapshot finalization stores', async () => {
    const db = await freshDb();
    const value = draft({
      trips: [
        trip({ date: '2026-07-09', startOdometerKm: 900, endOdometerKm: 950 }),
        trip({ position: 1, date: '2026-07-09', startOdometerKm: 700, endOdometerKm: 760 }),
        trip({ position: 2, date: '2026-07-03', startOdometerKm: 500, endOdometerKm: 512 }),
      ],
    });
    const id = await savedDraft(db, value);
    const preview = buildMileageSnapshot(value, await getSettings(db), await peekNextMileageSeq(db, 2026));

    expect(await finalizeMileageReport(db, id)).toEqual(preview);
    expect(preview.trips.map((row) => row.startOdometerKm)).toEqual([500, 700, 900]);
  });

  test('derives the numbering year from the report date and numbers each year independently', async () => {
    const db = await freshDb();
    await finalized(db);
    await finalized(db);
    const nextYear = await finalized(db, {
      year: 2026, reportDate: '2027-01-04', periodStart: '2026-12-28', periodEnd: '2027-01-03',
      trips: [trip({ date: '2026-12-30' })],
    });
    const priorYear = await finalized(db, {
      year: 2026, reportDate: '2025-12-31', periodStart: '2025-12-01', periodEnd: '2025-12-31',
      trips: [trip({ date: '2025-12-15' })],
    });

    expect((await reprintMileageSnapshot(db, nextYear)).reportNumber).toBe('1-2027');
    expect((await reprintMileageSnapshot(db, priorYear)).reportNumber).toBe('1-2025');
    expect(await reportRow(db, nextYear)).toMatchObject([{ seq: 1, year: 2027 }]);
    expect(await db.select('SELECT year, last_seq FROM mileage_year_counters ORDER BY year')).toEqual([
      { year: 2025, last_seq: 1 }, { year: 2026, last_seq: 2 }, { year: 2027, last_seq: 1 },
    ]);
  });

  test('keeps mileage numbering isolated from invoice and expense numbering', async () => {
    const db = await freshDb();
    expect(await allocateSeq(db, 2026)).toBe(1);
    expect(await allocateSeq(db, 2026)).toBe(2);
    // Seed expense numbering through the shared schema, independent of the expense editor API.
    await db.execute('INSERT INTO expense_year_counters (year, last_seq) VALUES (2026, 9)');
    await db.execute(
      `INSERT INTO expense_reports (year, seq, status, report_date, total_cents, snapshot_json)
       VALUES (2026, 9, 'finalized', '2026-07-15', 5000, '{}')`,
    );

    const mileageId = await finalized(db);

    expect((await reprintMileageSnapshot(db, mileageId)).reportNumber).toBe('1-2026');
    expect(await db.select('SELECT last_seq FROM year_counters WHERE year = 2026')).toEqual([{ last_seq: 2 }]);
    expect(await db.select('SELECT last_seq FROM expense_year_counters WHERE year = 2026')).toEqual([{ last_seq: 9 }]);
    expect(await allocateSeq(db, 2026)).toBe(3);
  });

  test('never reuses a cancelled number', async () => {
    const db = await freshDb();
    const id = await finalized(db);
    await voidMileageReport(db, id);
    expect(await peekNextMileageSeq(db, 2026)).toBe(2);
    expect((await finalizeMileageReport(db, await savedDraft(db))).reportNumber).toBe('2-2026');
  });

  test('rejects an invalid draft without reserving a number or changing anything', async () => {
    const db = await freshDb();
    const id = await savedDraft(db, {
      trips: [
        trip({ date: '2026-07-10' }),
        trip({ position: 1, date: '2026-07-02', startOdometerKm: 500, endOdometerKm: 500 }),
      ],
    });
    const before = await loadMileageDraft(db, id);

    await expect(finalizeMileageReport(db, id))
      .rejects.toThrow('The end odometer for trip 2 must be greater than its start.');

    expect(await reportRow(db, id)).toEqual([{
      seq: null, year: 2026, status: 'draft', has_finalized_at: 0, total_km: 0, has_snapshot: 0,
    }]);
    expect(await loadMileageDraft(db, id)).toEqual(before);
    expect(await db.select('SELECT * FROM mileage_year_counters')).toEqual([]);
    await expect(reprintMileageSnapshot(db, id)).rejects.toThrow(/not finalized/);
  });

  test('rejects blank readings and out-of-period trips at finalization', async () => {
    const db = await freshDb();
    const blank = await savedDraft(db, { trips: [trip({ startOdometerKm: null })] });
    await expect(finalizeMileageReport(db, blank)).rejects.toThrow('Enter the start odometer for trip 1.');
    const outside = await savedDraft(db, { trips: [trip({ date: '2026-07-16' })] });
    await expect(finalizeMileageReport(db, outside)).rejects.toThrow('Date is outside the reporting period');
    expect(await db.select('SELECT * FROM mileage_year_counters')).toEqual([]);
  });

  test('cannot finalize a report twice or finalize a missing report', async () => {
    const db = await freshDb();
    const id = await finalized(db);
    await expect(finalizeMileageReport(db, id)).rejects.toThrow(/finalized, not a draft/);
    await expect(finalizeMileageReport(db, 404)).rejects.toThrow(/missing, not a draft/);
    expect(await peekNextMileageSeq(db, 2026)).toBe(2);
  });

  test('rolls back counter, canonical row rewrite, and status when the final write fails', async () => {
    const db = await freshDb();
    const id = await savedDraft(db, {
      trips: [
        trip({ date: '2026-07-10', purpose: 'Later' }),
        trip({ position: 1, date: '2026-07-02', purpose: 'Earlier' }),
      ],
    });
    const failingDb: Db = {
      supportsSqlTransactions: true,
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => {
        if (sql.includes("status = 'finalized'")) throw new Error('simulated write failure');
        return db.execute(sql, params);
      },
    };

    await expect(finalizeMileageReport(failingDb, id)).rejects.toThrow('simulated write failure');

    expect(await getMileageStatus(db, id)).toBe('draft');
    expect((await loadMileageDraft(db, id)).trips.map((row) => row.purpose)).toEqual(['Later', 'Earlier']);
    expect(await db.select('SELECT * FROM mileage_year_counters')).toEqual([]);
    expect(await reportRow(db, id)).toMatchObject([{ seq: null, has_snapshot: 0 }]);
  });

  test('rolls back when a trip insert fails part-way through the transaction', async () => {
    const db = await freshDb();
    const id = await savedDraft(db, {
      trips: [trip({ purpose: 'One' }), trip({ position: 1, date: '2026-07-03', purpose: 'Two' })],
    });
    let inserts = 0;
    const failingDb: Db = {
      supportsSqlTransactions: true,
      select: (sql, params) => db.select(sql, params),
      execute: (sql, params) => {
        if (sql.includes('INSERT INTO mileage_trips') && ++inserts === 2) {
          throw new Error('disk full');
        }
        return db.execute(sql, params);
      },
    };

    await expect(finalizeMileageReport(failingDb, id)).rejects.toThrow('disk full');
    expect((await loadMileageDraft(db, id)).trips.map((row) => row.purpose)).toEqual(['One', 'Two']);
    expect(await db.select('SELECT * FROM mileage_year_counters')).toEqual([]);
    expect(await getMileageStatus(db, id)).toBe('draft');
  });

  test('re-checks draft status inside the finalize transaction and rolls everything back', async () => {
    const db = await freshDb();
    const id = await savedDraft(db, {
      trips: [trip({ date: '2026-07-10', purpose: 'Later' }), trip({ position: 1, purpose: 'Earlier' })],
    });
    let raced = false;
    const racingDb: Db = {
      supportsSqlTransactions: true,
      execute: (sql, params) => db.execute(sql, params),
      select: async (sql, params) => {
        const rows = await db.select(sql, params);
        // Another window finalizes this report right after the status pre-check.
        if (!raced && sql.startsWith('SELECT status FROM mileage_reports')) {
          raced = true;
          await db.execute("UPDATE mileage_reports SET status = 'finalized' WHERE id = ?", [id]);
        }
        return rows as never[];
      },
    };

    await expect(finalizeMileageReport(racingDb, id)).rejects.toThrow(/expected 1 row/i);
    expect(await db.select('SELECT * FROM mileage_year_counters')).toEqual([]);
    expect((await loadMileageDraft(db, id)).trips.map((row) => row.purpose)).toEqual(['Later', 'Earlier']);
    expect(await reportRow(db, id)).toMatchObject([{ seq: null, has_snapshot: 0, total_km: 0 }]);
  });

  test('retries a stale counter read and still takes the next free number', async () => {
    const db = await freshDb();
    await db.execute('INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 5)');
    const id = await savedDraft(db);
    let staleReads = 1;
    const staleDb: Db = {
      supportsSqlTransactions: true,
      execute: (sql, params) => db.execute(sql, params),
      select: async (sql, params) => {
        if (sql.includes('FROM mileage_year_counters') && staleReads-- > 0) {
          return [{ last_seq: 4, max_seq: null }] as never[];
        }
        return db.select(sql, params);
      },
    };

    expect((await finalizeMileageReport(staleDb, id)).reportNumber).toBe('6-2026');
    expect(await db.select('SELECT last_seq FROM mileage_year_counters WHERE year = 2026'))
      .toEqual([{ last_seq: 6 }]);
  });
});

describe('mileage reprint immutability, history, and lifecycle', () => {
  test('reprints the frozen copy after settings and stored rows change', async () => {
    const db = await freshDb();
    const id = await finalized(db);
    const snapshot = await reprintMileageSnapshot(db, id);

    await db.execute("UPDATE settings SET inspector_name = 'Renamed Business', logo_data_url = 'data:x' WHERE id = 1");
    await db.execute('UPDATE mileage_trips SET end_odometer_km = 99999 WHERE mileage_report_id = ?', [id]);
    await db.execute("UPDATE mileage_reports SET vehicle = 'Other car' WHERE id = ?", [id]);

    expect(await reprintMileageSnapshot(db, id)).toEqual(snapshot);
    expect(snapshot).toMatchObject({ inspectorName: 'North Star', logoDataUrl: '', totalKm: 50 });
  });

  test('refuses to reprint a corrupted saved copy instead of showing wrong distances', async () => {
    const db = await freshDb();
    const id = await finalized(db);
    const snapshot = await reprintMileageSnapshot(db, id);
    await db.execute('UPDATE mileage_reports SET snapshot_json = ? WHERE id = ?', [
      JSON.stringify({ ...snapshot, trips: [{ ...snapshot.trips[0], distanceKm: 1.5 }] }), id,
    ]);
    await expect(reprintMileageSnapshot(db, id)).rejects.toThrow(/unreadable saved copy/);
    await db.execute('UPDATE mileage_reports SET snapshot_json = ? WHERE id = ?', ['{"truncated', id]);
    await expect(reprintMileageSnapshot(db, id)).rejects.toThrow(/unreadable saved copy/);
  });

  test('lists finalized and cancelled reports by year then number, excluding drafts', async () => {
    const db = await freshDb();
    const first = await finalized(db, { trips: [trip({ startOdometerKm: 0, endOdometerKm: 10 })] });
    const second = await finalized(db, { vehicle: 'Second car' });
    const older = await finalized(db, {
      reportDate: '2025-12-31', periodStart: '2025-12-01', periodEnd: '2025-12-31',
      trips: [trip({ date: '2025-12-02' })],
    });
    await savedDraft(db);
    await voidMileageReport(db, second);

    expect(await listFinalizedMileageReports(db)).toEqual([
      { id: first, reportNumber: '1-2026', reportDate: '2026-07-15', vehicle: 'Ford F-150 · ABC 123', totalKm: 10, status: 'finalized' },
      { id: older, reportNumber: '1-2025', reportDate: '2025-12-31', vehicle: 'Ford F-150 · ABC 123', totalKm: 50, status: 'finalized' },
    ]);
    expect(await listVoidedMileageReports(db)).toEqual([
      { id: second, reportNumber: '2-2026', reportDate: '2026-07-15', vehicle: 'Second car', totalKm: 50, status: 'void' },
    ]);
  });

  test('guards cancel and restore transitions and keeps the frozen copy through them', async () => {
    const db = await freshDb();
    const draftId = await savedDraft(db);
    await expect(voidMileageReport(db, draftId)).rejects.toThrow(/draft, not finalized/);
    await expect(restoreMileageReport(db, draftId)).rejects.toThrow(/draft, not cancelled/);

    const id = await finalized(db);
    const snapshot = await reprintMileageSnapshot(db, id);
    await expect(restoreMileageReport(db, id)).rejects.toThrow(/finalized, not cancelled/);
    await voidMileageReport(db, id);
    expect(await getMileageStatus(db, id)).toBe('void');
    await expect(voidMileageReport(db, id)).rejects.toThrow(/void, not finalized/);
    expect(await reprintMileageSnapshot(db, id)).toEqual(snapshot);
    await restoreMileageReport(db, id);
    expect(await getMileageStatus(db, id)).toBe('finalized');
    expect(await reprintMileageSnapshot(db, id)).toEqual(snapshot);
    await expect(voidMileageReport(db, 404)).rejects.toThrow(/missing, not finalized/);
  });

  test('does not report success when a lifecycle update loses a race', async () => {
    const db = await freshDb();
    const id = await finalized(db);
    const noUpdateDb: Db = {
      select: (sql, params) => db.select(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("SET status = 'void'")) return { rowsAffected: 0 };
        return db.execute(sql, params);
      },
    };

    await expect(voidMileageReport(noUpdateDb, id)).rejects.toThrow(/changed before it could be cancelled/);
    expect(await getMileageStatus(db, id)).toBe('finalized');
  });
});
