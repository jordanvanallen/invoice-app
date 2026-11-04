import type { MileageTrip } from './types';

export interface TripOrderKey {
  date: string;
  startOdometerKm: number | null;
}

/**
 * Stable chronological copy: by date (blank dates last), then by start odometer
 * for same-day trips (blank readings last), then by the original row order.
 */
export function sortMileageTrips<T>(
  rows: readonly T[],
  keyOf: (row: T) => TripOrderKey,
): T[] {
  return rows
    .map((row, index) => ({ row, index, key: keyOf(row) }))
    .sort((a, b) => {
      const aBlank = a.key.date === '';
      const bBlank = b.key.date === '';
      if (aBlank !== bBlank) return aBlank ? 1 : -1;
      if (a.key.date !== b.key.date) return a.key.date < b.key.date ? -1 : 1;
      const aStart = a.key.startOdometerKm;
      const bStart = b.key.startOdometerKm;
      if ((aStart === null) !== (bStart === null)) return aStart === null ? 1 : -1;
      if (aStart !== null && bStart !== null && aStart !== bStart) return aStart - bStart;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Canonical persisted order with fresh trip objects and sequential positions. */
export function orderMileageTrips(trips: readonly MileageTrip[]): MileageTrip[] {
  return sortMileageTrips(trips, (trip) => trip)
    .map((trip, position) => ({ ...trip, position }));
}
