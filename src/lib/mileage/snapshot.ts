import type { Settings } from '../types';
import { isValidIsoDate } from '../validation';
import { orderMileageTrips } from './order';
import type { MileageDraft, MileageSnapshot, MileageSnapshotTrip } from './types';
import { mileageTotalKm, tripDistanceKm } from './validation';

/** The numbering year comes from a valid report date; otherwise keep the fallback. */
export function deriveMileageYear(reportDate: string, fallbackYear: number): number {
  return isValidIsoDate(reportDate) ? Number(reportDate.slice(0, 4)) : fallbackYear;
}

/**
 * Freeze a draft into the exact document Preview shows and finalization stores:
 * trips in canonical date order, text trimmed, distances and total computed.
 * Throws if any trip lacks a positive, valid odometer distance.
 */
export function buildMileageSnapshot(
  draft: MileageDraft,
  settings: Settings,
  seq: number,
): MileageSnapshot {
  const year = deriveMileageYear(draft.reportDate, draft.year);
  const trips = orderMileageTrips(draft.trips).map((trip): MileageSnapshotTrip => {
    const distanceKm = tripDistanceKm(trip);
    if (distanceKm === null) {
      throw new Error(
        `Trip ${trip.position + 1} needs a start and end odometer reading with end greater than start.`,
      );
    }
    return {
      position: trip.position,
      date: trip.date,
      from: trip.from.trim(),
      to: trip.to.trim(),
      purpose: trip.purpose.trim(),
      startOdometerKm: trip.startOdometerKm as number,
      endOdometerKm: trip.endOdometerKm as number,
      distanceKm,
    };
  });
  const totalKm = mileageTotalKm(trips);
  if (totalKm === null) throw new Error('The total distance is too large to record.');
  return {
    reportNumber: `${seq}-${year}`,
    seq,
    year,
    reportDate: draft.reportDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    vehicle: draft.vehicle.trim(),
    inspectorName: settings.inspectorName,
    inspectorAddress: settings.inspectorAddress,
    inspectorNumber: settings.inspectorNumber,
    logoDataUrl: settings.logoDataUrl,
    trips,
    totalKm,
  };
}
