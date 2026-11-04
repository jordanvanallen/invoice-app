import { groupHistoryRows } from '../history/history';
import type { MileageListItem } from '../mileage/types';

export interface MileageRollup {
  count: number;
  totalKm: number;
}

export interface MileageHistoryGroup {
  /** Report-date year; 0 when the stored date is unusable. */
  year: number;
  reports: MileageListItem[];
  rollup: MileageRollup;
}

export function sumMileageHistory(rows: readonly { totalKm: number }[]): MileageRollup {
  return rows.reduce<MileageRollup>((rollup, row) => ({
    count: rollup.count + 1,
    totalKm: rollup.totalKm + row.totalKm,
  }), { count: 0, totalKm: 0 });
}

/** Finalized reports grouped by report-date year, newest year first, list order kept. */
export function groupMileageHistory(rows: readonly MileageListItem[]): MileageHistoryGroup[] {
  return groupHistoryRows(rows, (report) => report.reportDate).map((group) => ({
    year: group.year,
    reports: group.rows,
    rollup: sumMileageHistory(group.rows),
  }));
}
