import type { Settings } from '../types';
import { formatOdometerInput, parseOdometerKm } from '../mileage/odometer';
import { sortMileageTrips } from '../mileage/order';
import { buildMileageSnapshot } from '../mileage/snapshot';
import {
  MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE,
  mileageFinalizeBlockers,
  tripDistanceKm,
} from '../mileage/validation';
import type {
  MileageBlocker,
  MileageBlockerField,
  MileageDraft,
  MileageSnapshot,
  MileageTrip,
} from '../mileage/types';

/**
 * One editable trip. Odometer fields keep the exact text being typed so a
 * malformed or decimal entry stays visible (and blocks finalizing) instead of
 * being silently coerced. `uid` is a persistent string key for keyed `{#each}`.
 */
export interface MileageEditorRow {
  uid: string;
  date: string;
  from: string;
  to: string;
  purpose: string;
  startText: string;
  endText: string;
}

export interface MileageEditorBlocker extends MileageBlocker {
  /** Short copy for the warning line under the affected row. */
  rowMessage: string;
}

export interface MileageBlockerTarget {
  id: string;
  message: string;
}

export const MILEAGE_PREVIEW_HINT = 'Preview needs start and end odometer readings on every trip.';

let uidCounter = 0;
const nextUid = () => `mileage-trip-${++uidCounter}`;

export function blankMileageRow(date: string): MileageEditorRow {
  return { uid: nextUid(), date, from: '', to: '', purpose: '', startText: '', endText: '' };
}

export function toMileageEditorRow(trip: MileageTrip): MileageEditorRow {
  return {
    uid: nextUid(),
    date: trip.date,
    from: trip.from,
    to: trip.to,
    purpose: trip.purpose,
    startText: formatOdometerInput(trip.startOdometerKm),
    endText: formatOdometerInput(trip.endOdometerKm),
  };
}

/** Persistable trips: blank and malformed readings both become null, never 0. */
export function mileageRowsToTrips(rows: readonly MileageEditorRow[]): MileageTrip[] {
  return rows.map((row, position) => ({
    position,
    date: row.date,
    from: row.from,
    to: row.to,
    purpose: row.purpose,
    startOdometerKm: parseOdometerKm(row.startText).km,
    endOdometerKm: parseOdometerKm(row.endText).km,
  }));
}

export function mileageRowDistanceKm(row: MileageEditorRow): number | null {
  return tripDistanceKm({
    startOdometerKm: parseOdometerKm(row.startText).km,
    endOdometerKm: parseOdometerKm(row.endText).km,
  });
}

/** Reformat a valid reading on blur; leave anything invalid exactly as typed. */
export function normalizeOdometerText(text: string): string {
  const parsed = parseOdometerKm(text);
  return parsed.kind === 'valid' ? formatOdometerInput(parsed.km) : text;
}

/** The same chronological order Preview and finalization use. */
export function sortMileageEditorRows(rows: readonly MileageEditorRow[]): MileageEditorRow[] {
  return sortMileageTrips(rows, (row) => ({
    date: row.date,
    startOdometerKm: parseOdometerKm(row.startText).km,
  }));
}

const ODOMETER_LABELS = {
  startOdometerKm: { label: 'Start odometer', blank: 'Enter the start odometer' },
  endOdometerKm: { label: 'End odometer', blank: 'Enter the end odometer' },
} as const;

const ROW_COPY: Partial<Record<MileageBlockerField, string>> = {
  from: 'Enter where the trip started',
  to: 'Enter where the trip ended',
  purpose: 'Enter the trip purpose',
};

function rowCopy(blocker: MileageBlocker, row: MileageEditorRow | undefined): MileageEditorBlocker {
  const n = (blocker.tripIndex ?? 0) + 1;
  if (blocker.field === 'startOdometerKm' || blocker.field === 'endOdometerKm') {
    const copy = ODOMETER_LABELS[blocker.field];
    const text = blocker.field === 'startOdometerKm' ? row?.startText : row?.endText;
    const parsed = parseOdometerKm(text ?? '');
    if (parsed.kind === 'invalid') {
      return {
        ...blocker,
        message: `Trip ${n} ${copy.label.toLowerCase()}: ${parsed.message}.`,
        rowMessage: `${copy.label}: ${parsed.message}`,
      };
    }
    if (parsed.kind === 'valid') {
      // Both readings are valid, so the only remaining problem is their order.
      return { ...blocker, rowMessage: 'End odometer must be greater than the start' };
    }
    return { ...blocker, rowMessage: copy.blank };
  }
  if (blocker.field === 'date') {
    const rowMessage = blocker.message === MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE
      ? MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE
      : blocker.message.startsWith('Choose a valid date') ? 'Choose a valid date' : 'Choose a date';
    return { ...blocker, rowMessage };
  }
  return { ...blocker, rowMessage: ROW_COPY[blocker.field] ?? blocker.message };
}

/**
 * Finalization blockers for the visible editor. `draft.trips` must be built from
 * `rows` in the same order (see mileageRowsToTrips) so text-level problems such
 * as "12.5" are explained precisely instead of as a missing reading.
 */
export function mileageEditorBlockers(
  draft: MileageDraft,
  rows: readonly MileageEditorRow[],
): MileageEditorBlocker[] {
  return mileageFinalizeBlockers(draft).map((blocker) => rowCopy(
    blocker,
    blocker.tripIndex === null ? undefined : rows[blocker.tripIndex],
  ));
}

export function mileageRowWarnings(
  blockers: readonly MileageEditorBlocker[],
  tripIndex: number,
): string[] {
  return blockers.filter((blocker) => blocker.tripIndex === tripIndex)
    .map((blocker) => blocker.rowMessage);
}

/** Count unique trip rows with at least one finalization blocker. */
export function mileageBlockingRowCount(blockers: readonly MileageBlocker[]): number {
  return new Set(blockers.flatMap((blocker) =>
    blocker.tripIndex === null ? [] : [blocker.tripIndex]
  )).size;
}

const ROW_FIELD_IDS: Partial<Record<MileageBlockerField, string>> = {
  date: 'date',
  from: 'from',
  to: 'to',
  purpose: 'purpose',
  startOdometerKm: 'start',
  endOdometerKm: 'end',
};

const HEADER_FIELD_IDS: Partial<Record<MileageBlockerField, string>> = {
  reportDate: 'mileage-report-date',
  periodStart: 'mileage-period-start',
  periodEnd: 'mileage-period-end',
  vehicle: 'mileage-vehicle',
  trips: 'mileage-add-trip',
  totalKm: 'mileage-total',
};

export function firstMileageBlockerTarget(
  blockers: readonly MileageBlocker[],
): MileageBlockerTarget | null {
  const blocker = blockers[0];
  if (!blocker) return null;
  if (blocker.tripIndex !== null) {
    return {
      id: `mileage-trip-${blocker.tripIndex}-${ROW_FIELD_IDS[blocker.field] ?? 'date'}`,
      message: blocker.message,
    };
  }
  return { id: HEADER_FIELD_IDS[blocker.field] ?? 'mileage-add-trip', message: blocker.message };
}

/** Preview can render once every trip has a measurable distance. */
export function canPreviewMileage(blockers: readonly MileageBlocker[]): boolean {
  return !blockers.some((blocker) => (
    blocker.field === 'trips'
    || blocker.field === 'startOdometerKm'
    || blocker.field === 'endOdometerKm'
    || blocker.field === 'totalKm'
  ));
}

/** The exact snapshot finalization will store for this draft and number. */
export function prepareMileagePreview(
  draft: MileageDraft,
  settings: Settings,
  seq: number,
): MileageSnapshot {
  return buildMileageSnapshot(draft, settings, seq);
}
