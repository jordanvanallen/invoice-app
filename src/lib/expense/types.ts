import type { Cents } from '../types';

export type ExpenseStatus = 'draft' | 'finalized' | 'void';

export interface ExpenseItem {
  position: number;
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

export interface ExpenseSnapshot {
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
  items: ExpenseItem[];
  totalCents: Cents;
}

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
  | 'amountCents';

export interface ExpenseBlocker {
  field: ExpenseBlockerField;
  itemIndex: number | null;
  message: string;
}
