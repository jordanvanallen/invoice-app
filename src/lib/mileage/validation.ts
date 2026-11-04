import { isDateOutsidePeriod, isValidIsoDate } from '../validation';
import { isOdometerKm } from './odometer';
import type { MileageBlocker, MileageDraft, MileageTrip } from './types';

export const MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE = 'Date is outside the reporting period';

type OdometerPair = Pick<MileageTrip, 'startOdometerKm' | 'endOdometerKm'>;

/** Kilometres driven on one trip, or null until both readings are valid and ordered. */
export function tripDistanceKm(trip: OdometerPair): number | null {
  const { startOdometerKm: start, endOdometerKm: end } = trip;
  if (!isOdometerKm(start) || !isOdometerKm(end) || end <= start) return null;
  return end - start;
}

/**
 * Sum of every computable trip distance. Incomplete trips contribute nothing;
 * returns null when the sum is no longer an exactly representable integer.
 */
export function mileageTotalKm(trips: readonly OdometerPair[]): number | null {
  let total = 0;
  for (const trip of trips) {
    const distance = tripDistanceKm(trip);
    if (distance === null) continue;
    total += distance;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function headerDateBlocker(
  value: string,
  field: 'reportDate' | 'periodStart' | 'periodEnd',
  label: string,
): MileageBlocker | null {
  if (!value.trim()) return { field, tripIndex: null, message: `Choose a ${label}.` };
  if (!isValidIsoDate(value)) {
    return { field, tripIndex: null, message: `Choose a valid ${label}.` };
  }
  return null;
}

function odometerBlocker(
  value: number | null,
  field: 'startOdometerKm' | 'endOdometerKm',
  tripIndex: number,
): MileageBlocker | null {
  const which = field === 'startOdometerKm' ? 'start' : 'end';
  if (value === null) {
    return { field, tripIndex, message: `Enter the ${which} odometer for trip ${tripIndex + 1}.` };
  }
  if (!isOdometerKm(value)) {
    return {
      field, tripIndex,
      message: `Enter the ${which} odometer for trip ${tripIndex + 1} in whole kilometres.`,
    };
  }
  return null;
}

/** Every reason the draft cannot be locked yet, in on-screen focus order. */
export function mileageFinalizeBlockers(draft: MileageDraft): MileageBlocker[] {
  const blockers: MileageBlocker[] = [];
  const push = (blocker: MileageBlocker | null) => {
    if (blocker) blockers.push(blocker);
  };

  push(headerDateBlocker(draft.reportDate, 'reportDate', 'report date'));
  const periodStartBlocker = headerDateBlocker(
    draft.periodStart, 'periodStart', 'reporting period start date',
  );
  const periodEndBlocker = headerDateBlocker(
    draft.periodEnd, 'periodEnd', 'reporting period end date',
  );
  push(periodStartBlocker);
  push(periodEndBlocker);
  const periodDatesValid = !periodStartBlocker && !periodEndBlocker;
  if (periodDatesValid && draft.periodStart > draft.periodEnd) {
    blockers.push({
      field: 'periodEnd', tripIndex: null,
      message: 'The reporting period end must be on or after its start.',
    });
  }
  const periodAllowsTrips = periodDatesValid && draft.periodStart <= draft.periodEnd;

  if (!draft.vehicle.trim()) {
    blockers.push({ field: 'vehicle', tripIndex: null, message: 'Enter the vehicle.' });
  }
  if (draft.trips.length === 0) {
    blockers.push({ field: 'trips', tripIndex: null, message: 'Add at least one trip.' });
  }

  draft.trips.forEach((trip, tripIndex) => {
    const n = tripIndex + 1;
    if (!trip.date.trim()) {
      blockers.push({ field: 'date', tripIndex, message: `Choose a date for trip ${n}.` });
    } else if (!isValidIsoDate(trip.date)) {
      blockers.push({ field: 'date', tripIndex, message: `Choose a valid date for trip ${n}.` });
    } else if (periodAllowsTrips
      && isDateOutsidePeriod(trip.date, draft.periodStart, draft.periodEnd)) {
      blockers.push({ field: 'date', tripIndex, message: MILEAGE_DATE_OUTSIDE_PERIOD_MESSAGE });
    }
    if (!trip.from.trim()) {
      blockers.push({ field: 'from', tripIndex, message: `Enter where trip ${n} started.` });
    }
    if (!trip.to.trim()) {
      blockers.push({ field: 'to', tripIndex, message: `Enter where trip ${n} ended.` });
    }
    if (!trip.purpose.trim()) {
      blockers.push({ field: 'purpose', tripIndex, message: `Enter the purpose of trip ${n}.` });
    }
    const startBlocker = odometerBlocker(trip.startOdometerKm, 'startOdometerKm', tripIndex);
    const endBlocker = odometerBlocker(trip.endOdometerKm, 'endOdometerKm', tripIndex);
    push(startBlocker);
    push(endBlocker);
    if (!startBlocker && !endBlocker && tripDistanceKm(trip) === null) {
      blockers.push({
        field: 'endOdometerKm', tripIndex,
        message: `The end odometer for trip ${n} must be greater than its start.`,
      });
    }
  });

  const everyTripMeasured = draft.trips.every((trip) => tripDistanceKm(trip) !== null);
  if (everyTripMeasured && mileageTotalKm(draft.trips) === null) {
    blockers.push({
      field: 'totalKm', tripIndex: null,
      message: 'The total distance is too large to record. Check the odometer readings.',
    });
  }
  return blockers;
}
