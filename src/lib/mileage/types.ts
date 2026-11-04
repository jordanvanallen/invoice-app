export type MileageStatus = 'draft' | 'finalized' | 'void';

export interface MileageTrip {
  position: number;
  /** ISO date string, e.g. "2026-07-15". */
  date: string;
  from: string;
  to: string;
  purpose: string;
  /** Whole kilometres. null means the reading is blank; 0 is a real reading. */
  startOdometerKm: number | null;
  endOdometerKm: number | null;
}

export interface MileageDraft {
  /** Always null until finalization assigns the next number for the year. */
  seq: number | null;
  year: number;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  /** Free-text vehicle identification, e.g. "2019 Ford F-150 · ABC 123". */
  vehicle: string;
  trips: MileageTrip[];
}

export interface MileageSnapshotTrip extends Omit<MileageTrip, 'startOdometerKm' | 'endOdometerKm'> {
  startOdometerKm: number;
  endOdometerKm: number;
  distanceKm: number;
}

/** Everything frozen onto a mileage report at finalize. Reprints read only this. */
export interface MileageSnapshot {
  reportNumber: string;
  seq: number;
  year: number;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  vehicle: string;
  inspectorName: string;
  inspectorAddress: string;
  inspectorNumber: string;
  logoDataUrl: string;
  trips: MileageSnapshotTrip[];
  totalKm: number;
}

export interface MileageListItem {
  id: number;
  reportNumber: string;
  reportDate: string;
  vehicle: string;
  totalKm: number;
  status: MileageStatus;
}

export type MileageBlockerField =
  | 'reportDate'
  | 'periodStart'
  | 'periodEnd'
  | 'vehicle'
  | 'trips'
  | 'date'
  | 'from'
  | 'to'
  | 'purpose'
  | 'startOdometerKm'
  | 'endOdometerKm'
  | 'totalKm';

export interface MileageBlocker {
  field: MileageBlockerField;
  tripIndex: number | null;
  message: string;
}
