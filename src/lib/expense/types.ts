import type { Cents } from '../types';

export type ExpenseStatus = 'draft' | 'finalized' | 'void';

/** Report section an expense row belongs to; persisted in expense_items.category. */
export type ExpenseCategory = 'vehicle' | 'general';

export interface ExpenseItem {
  position: number;
  /** Rows saved before sections existed read back as 'general' (schema v7 default). */
  category: ExpenseCategory;
  /** ISO date string, e.g. "2026-07-15". */
  date: string;
  description: string;
  amountCents: Cents;
}

export interface ExpenseDraft {
  seq: number | null;
  year: number;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  items: ExpenseItem[];
}

/** Identity, period, and grand total frozen onto every finalized expense report. */
interface ExpenseSnapshotBase {
  reportNumber: string;
  seq: number;
  year: number;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  inspectorName: string;
  inspectorAddress: string;
  inspectorNumber: string;
  logoDataUrl: string;
  totalCents: Cents;
}

/** A row frozen before expense sections existed. It never carries a category. */
export type LegacyExpenseItem = Omit<ExpenseItem, 'category'>;

/**
 * A snapshot finalized before expense sections existed (no `snapshotVersion`).
 * It always reprints as one flat table: its rows were never classified, and the
 * schema v7 'general' default on expense_items is not a real classification.
 */
export interface LegacyExpenseSnapshot extends ExpenseSnapshotBase {
  snapshotVersion?: undefined;
  items: LegacyExpenseItem[];
}

/** A snapshot with Vehicle and General/Admin sections and their frozen subtotals. */
export interface SectionedExpenseSnapshot extends ExpenseSnapshotBase {
  snapshotVersion: 2;
  /** Every vehicle row, then every general row; each section chronological. */
  items: ExpenseItem[];
  vehicleSubtotalCents: Cents;
  generalSubtotalCents: Cents;
}

/** What a finalized report reprints from. Narrow with `isSectionedExpenseSnapshot`. */
export type ExpenseSnapshot = LegacyExpenseSnapshot | SectionedExpenseSnapshot;

export interface ExpenseListItem {
  id: number;
  reportNumber: string;
  reportDate: string;
  totalCents: Cents;
  status: ExpenseStatus;
}

export interface ExpenseRollup {
  count: number;
  totalCents: Cents;
}

export interface ExpenseSummaryReport extends ExpenseListItem {
  status: 'finalized';
}

export interface ExpenseSummaryItemRow {
  reportId: number;
  reportNumber: string;
  reportDate: string;
  itemId: number;
  itemDate: string;
  position: number;
  /**
   * Stored section. Rows from reports finalized before sections existed read as
   * 'general' by migration default, so summaries must not split on it.
   */
  category: ExpenseCategory;
  description: string;
  amountCents: Cents;
}

export interface ExpenseSummaryData {
  reports: ExpenseSummaryReport[];
  items: ExpenseSummaryItemRow[];
}

export type ExpenseBlockerField =
  | 'sequence'
  | 'reportDate'
  | 'periodStart'
  | 'periodEnd'
  | 'items'
  | 'date'
  | 'description'
  | 'amountCents'
  | 'category';

export interface ExpenseBlocker {
  field: ExpenseBlockerField;
  itemIndex: number | null;
  message: string;
}
