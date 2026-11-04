import type { Db, DbStatement } from './db';
import { executeStatementsAtomically } from './db';
import { getSettings } from './settings-repo';
import { isOdometerKm } from '../mileage/odometer';
import { buildMileageSnapshot, deriveMileageYear } from '../mileage/snapshot';
import { mileageFinalizeBlockers } from '../mileage/validation';
import type {
  MileageDraft,
  MileageListItem,
  MileageSnapshot,
  MileageSnapshotTrip,
  MileageStatus,
  MileageTrip,
} from '../mileage/types';

export type MileageDraftHeader = Omit<MileageDraft, 'seq' | 'trips'>;

const MAX_SEQUENCE_RESERVATION_ATTEMPTS = 3;

export async function createMileageDraft(db: Db, header: MileageDraftHeader): Promise<number> {
  const result = await db.execute(
    `INSERT INTO mileage_reports
       (year, status, report_date, period_start, period_end, vehicle)
     VALUES (?, 'draft', ?, ?, ?, ?)`,
    [
      deriveMileageYear(header.reportDate, header.year),
      header.reportDate,
      header.periodStart,
      header.periodEnd,
      header.vehicle,
    ],
  );
  return result.lastInsertId as number;
}

interface MileageTripRow {
  position: number;
  date: string;
  from_place: string;
  to_place: string;
  purpose: string;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
}

export async function loadMileageDraft(db: Db, reportId: number): Promise<MileageDraft> {
  const [head] = await db.select<{
    year: number;
    seq: number | null;
    report_date: string;
    period_start: string;
    period_end: string;
    vehicle: string;
  }>(
    `SELECT year, seq, report_date, period_start, period_end, vehicle
       FROM mileage_reports WHERE id = ?`,
    [reportId],
  );
  if (!head) throw new Error(`Mileage report ${reportId} does not exist.`);
  const rows = await db.select<MileageTripRow>(
    `SELECT position, date, from_place, to_place, purpose, start_odometer_km, end_odometer_km
       FROM mileage_trips
      WHERE mileage_report_id = ?
      ORDER BY position, id`,
    [reportId],
  );
  return {
    seq: head.seq,
    year: head.year,
    reportDate: head.report_date,
    periodStart: head.period_start,
    periodEnd: head.period_end,
    vehicle: head.vehicle,
    trips: rows.map((row) => ({
      position: row.position,
      date: row.date,
      from: row.from_place,
      to: row.to_place,
      purpose: row.purpose,
      startOdometerKm: row.start_odometer_km,
      endOdometerKm: row.end_odometer_km,
    })),
  };
}

/** Drafts may be incomplete, but never hold a reading that is not blank or whole km. */
function assertPersistableTrips(trips: readonly MileageTrip[]): void {
  trips.forEach((trip, index) => {
    for (const value of [trip.startOdometerKm, trip.endOdometerKm]) {
      if (value !== null && !isOdometerKm(value)) {
        throw new Error(
          `Trip ${index + 1} has an odometer reading that is not a whole number of kilometres.`,
        );
      }
    }
  });
}

function replaceTripStatements(
  reportId: number,
  trips: readonly Omit<MileageTrip, 'position'>[],
): DbStatement[] {
  return [
    { sql: 'DELETE FROM mileage_trips WHERE mileage_report_id = ?', params: [reportId] },
    ...trips.map((trip, position) => ({
      sql: `INSERT INTO mileage_trips
              (mileage_report_id, position, date, from_place, to_place, purpose,
               start_odometer_km, end_odometer_km)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        reportId, position, trip.date, trip.from, trip.to, trip.purpose,
        trip.startOdometerKm, trip.endOdometerKm,
      ],
    })),
  ];
}

/**
 * Persist an editable draft. Trip order is the array order. The number is never
 * chosen here; it is assigned at finalization. The status guard is re-checked
 * inside the transaction so a draft finalized or cancelled concurrently cannot
 * be rewritten.
 */
export async function saveMileageDraft(
  db: Db,
  reportId: number,
  draft: MileageDraft,
): Promise<void> {
  const status = await getMileageStatus(db, reportId);
  if (status !== 'draft') {
    throw new Error(`Mileage report ${reportId} is not an editable draft.`);
  }
  assertPersistableTrips(draft.trips);
  await executeStatementsAtomically(db, [
    {
      sql: `UPDATE mileage_reports SET
              year = ?, report_date = ?, period_start = ?, period_end = ?, vehicle = ?
            WHERE id = ? AND status = 'draft'`,
      params: [
        deriveMileageYear(draft.reportDate, draft.year),
        draft.reportDate,
        draft.periodStart,
        draft.periodEnd,
        draft.vehicle,
        reportId,
      ],
      expectedRowsAffected: 1,
    },
    ...replaceTripStatements(reportId, draft.trips),
  ]);
}

export async function latestMileageDraftId(db: Db): Promise<number | null> {
  const rows = await db.select<{ id: number }>(
    "SELECT id FROM mileage_reports WHERE status = 'draft' ORDER BY id DESC LIMIT 1",
  );
  return rows[0]?.id ?? null;
}

interface MileageSequenceState {
  last_seq: number | null;
  max_seq: number | null;
}

async function readMileageSequenceState(
  db: Db,
  year: number,
  excludeReportId?: number,
): Promise<MileageSequenceState> {
  const [state] = await db.select<MileageSequenceState>(
    `SELECT
       (SELECT last_seq FROM mileage_year_counters WHERE year = ?) AS last_seq,
       (SELECT MAX(seq) FROM mileage_reports
         WHERE year = ? AND seq IS NOT NULL AND id != ?) AS max_seq`,
    [year, year, excludeReportId ?? -1],
  );
  return state ?? { last_seq: null, max_seq: null };
}

function nextSequence(state: MileageSequenceState): number {
  return Math.max(state.last_seq ?? 0, state.max_seq ?? 0) + 1;
}

/** The number the next finalized mileage report in this year will receive. */
export async function peekNextMileageSeq(db: Db, year: number): Promise<number> {
  return nextSequence(await readMileageSequenceState(db, year));
}

function isAffectedRowConflict(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : '';
  return /^Expected 1 row\(s\) affected; affected 0\.$/i.test(message);
}

/**
 * Lock a draft: validate it, assign the next number for its report-date year,
 * and in one transaction reserve the counter, rewrite the trips in canonical
 * order, and store the frozen snapshot. Any failure leaves the draft unchanged.
 */
export async function finalizeMileageReport(db: Db, reportId: number): Promise<MileageSnapshot> {
  const status = await getMileageStatus(db, reportId);
  if (status !== 'draft') {
    throw new Error(`Mileage report ${reportId} is ${status ?? 'missing'}, not a draft.`);
  }
  const loaded = await loadMileageDraft(db, reportId);
  const draft = { ...loaded, year: deriveMileageYear(loaded.reportDate, loaded.year) };
  const blockers = mileageFinalizeBlockers(draft);
  if (blockers.length) throw new Error(blockers[0].message);
  const settings = await getSettings(db);

  for (let attempt = 1; ; attempt += 1) {
    const state = await readMileageSequenceState(db, draft.year, reportId);
    const seq = nextSequence(state);
    const snapshot = buildMileageSnapshot(draft, settings, seq);
    const reservation: DbStatement = state.last_seq === null
      ? {
          sql: `INSERT INTO mileage_year_counters (year, last_seq)
                SELECT ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM mileage_year_counters WHERE year = ?)`,
          params: [snapshot.year, seq, snapshot.year],
          expectedRowsAffected: 1,
        }
      : {
          sql: `UPDATE mileage_year_counters SET last_seq = ?
                WHERE year = ? AND last_seq = ?`,
          params: [seq, snapshot.year, state.last_seq],
          expectedRowsAffected: 1,
        };
    try {
      await executeStatementsAtomically(db, [
        reservation,
        ...replaceTripStatements(reportId, snapshot.trips),
        {
          sql: `UPDATE mileage_reports SET
                  seq = ?, year = ?, status = 'finalized', finalized_at = ?,
                  report_date = ?, period_start = ?, period_end = ?, vehicle = ?,
                  total_km = ?, snapshot_json = ?
                WHERE id = ? AND status = 'draft'
                  AND NOT EXISTS (
                    SELECT 1 FROM mileage_reports other
                     WHERE other.year = ? AND other.seq = ? AND other.id != ?
                  )`,
          params: [
            seq, snapshot.year, new Date().toISOString(),
            snapshot.reportDate, snapshot.periodStart, snapshot.periodEnd, snapshot.vehicle,
            snapshot.totalKm, JSON.stringify(snapshot),
            reportId, snapshot.year, seq, reportId,
          ],
          expectedRowsAffected: 1,
        },
      ]);
      return snapshot;
    } catch (error) {
      const canRetry = attempt < MAX_SEQUENCE_RESERVATION_ATTEMPTS
        && isAffectedRowConflict(error)
        && await getMileageStatus(db, reportId).then((current) => current === 'draft', () => false);
      if (!canRetry) throw error;
    }
  }
}

function isSnapshotTrip(value: unknown): value is MileageSnapshotTrip {
  const trip = value as MileageSnapshotTrip | null;
  return typeof trip === 'object' && trip !== null
    && typeof trip.date === 'string'
    && typeof trip.from === 'string'
    && typeof trip.to === 'string'
    && typeof trip.purpose === 'string'
    && isOdometerKm(trip.startOdometerKm)
    && isOdometerKm(trip.endOdometerKm)
    && isOdometerKm(trip.distanceKm);
}

/** The frozen snapshot exactly as finalized; never rebuilt from live rows or settings. */
export async function reprintMileageSnapshot(db: Db, reportId: number): Promise<MileageSnapshot> {
  const [row] = await db.select<{ snapshot_json: string | null }>(
    'SELECT snapshot_json FROM mileage_reports WHERE id = ?',
    [reportId],
  );
  if (!row?.snapshot_json) throw new Error(`Mileage report ${reportId} is not finalized.`);
  const unreadable = new Error(`Mileage report ${reportId} has an unreadable saved copy.`);
  let snapshot: MileageSnapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json) as MileageSnapshot;
  } catch {
    throw unreadable;
  }
  if (
    typeof snapshot?.reportNumber !== 'string'
    || !Number.isSafeInteger(snapshot.year)
    || !Array.isArray(snapshot.trips)
    || !snapshot.trips.every(isSnapshotTrip)
    || !isOdometerKm(snapshot.totalKm)
  ) {
    throw unreadable;
  }
  return snapshot;
}

export async function getMileageStatus(db: Db, reportId: number): Promise<MileageStatus | null> {
  const [row] = await db.select<{ status: MileageStatus }>(
    'SELECT status FROM mileage_reports WHERE id = ?',
    [reportId],
  );
  return row?.status ?? null;
}

interface MileageListRow {
  id: number;
  year: number;
  seq: number;
  report_date: string;
  vehicle: string;
  total_km: number;
  status: MileageStatus;
}

function toMileageListItem(row: MileageListRow): MileageListItem {
  return {
    id: row.id,
    reportNumber: `${row.seq}-${row.year}`,
    reportDate: row.report_date,
    vehicle: row.vehicle,
    totalKm: row.total_km,
    status: row.status,
  };
}

async function listMileageReportsWithStatus(
  db: Db,
  status: 'finalized' | 'void',
): Promise<MileageListItem[]> {
  const rows = await db.select<MileageListRow>(
    `SELECT id, year, seq, report_date, vehicle, total_km, status
       FROM mileage_reports
      WHERE status = ?
      ORDER BY year DESC, seq ASC`,
    [status],
  );
  return rows.map(toMileageListItem);
}

export function listFinalizedMileageReports(db: Db): Promise<MileageListItem[]> {
  return listMileageReportsWithStatus(db, 'finalized');
}

export function listVoidedMileageReports(db: Db): Promise<MileageListItem[]> {
  return listMileageReportsWithStatus(db, 'void');
}

export async function voidMileageReport(db: Db, reportId: number): Promise<void> {
  const status = await getMileageStatus(db, reportId);
  if (status !== 'finalized') {
    throw new Error(`Mileage report ${reportId} is ${status ?? 'missing'}, not finalized.`);
  }
  const result = await db.execute(
    "UPDATE mileage_reports SET status = 'void' WHERE id = ? AND status = 'finalized'",
    [reportId],
  );
  if (result.rowsAffected !== 1) {
    throw new Error(
      `Mileage report ${reportId} changed before it could be cancelled. Please refresh and try again.`,
    );
  }
}

export async function restoreMileageReport(db: Db, reportId: number): Promise<void> {
  const status = await getMileageStatus(db, reportId);
  if (status !== 'void') {
    throw new Error(`Mileage report ${reportId} is ${status ?? 'missing'}, not cancelled.`);
  }
  const result = await db.execute(
    "UPDATE mileage_reports SET status = 'finalized' WHERE id = ? AND status = 'void'",
    [reportId],
  );
  if (result.rowsAffected !== 1) {
    throw new Error(
      `Mileage report ${reportId} changed before it could be restored. Please refresh and try again.`,
    );
  }
}
