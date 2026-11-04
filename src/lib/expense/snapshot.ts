import type { Cents, Settings } from '../types';
import { expenseSubtotalFor, expenseSubtotals, isExpenseCategory } from './category';
import { orderExpenseItems } from './order';
import type {
  ExpenseCategory,
  ExpenseDraft,
  ExpenseItem,
  ExpenseSnapshot,
  LegacyExpenseSnapshot,
  SectionedExpenseSnapshot,
} from './types';

/**
 * Freeze a sectioned snapshot from fresh row copies, so later draft or settings
 * edits never reach it. Subtotals are stored, not recomputed at reprint time.
 */
export function buildExpenseSnapshot(
  draft: ExpenseDraft,
  settings: Settings,
  seq: number,
): SectionedExpenseSnapshot {
  const items = orderExpenseItems(draft.items);
  const { vehicleSubtotalCents, generalSubtotalCents, totalCents } = expenseSubtotals(items);
  return {
    snapshotVersion: 2,
    reportNumber: `${seq}-${draft.year}`,
    seq,
    year: draft.year,
    reportDate: draft.reportDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    inspectorName: settings.inspectorName,
    inspectorAddress: settings.inspectorAddress,
    inspectorNumber: settings.inspectorNumber,
    logoDataUrl: settings.logoDataUrl,
    items,
    vehicleSubtotalCents,
    generalSubtotalCents,
    totalCents,
  };
}

/** The only way renderers choose between the sectioned and legacy flat layouts. */
export function isSectionedExpenseSnapshot(
  snapshot: ExpenseSnapshot,
): snapshot is SectionedExpenseSnapshot {
  return snapshot.snapshotVersion === 2;
}

/** One section's frozen rows and stored subtotal, for the view and the PDF. */
export function expenseSnapshotSection(
  snapshot: SectionedExpenseSnapshot,
  category: ExpenseCategory,
): { items: ExpenseItem[]; subtotalCents: Cents } {
  return {
    items: snapshot.items.filter((item) => item.category === category),
    subtotalCents: expenseSubtotalFor(snapshot, category),
  };
}

const DAMAGED = "This expense report's saved copy is damaged, so it can't be shown or printed.";

function isCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateSectionedSnapshot(snapshot: SectionedExpenseSnapshot): void {
  if (!Array.isArray(snapshot.items)) throw new Error(DAMAGED);
  const sums = { vehicle: 0, general: 0 };
  for (const item of snapshot.items) {
    if (!item || !isExpenseCategory(item.category) || !isCents(item.amountCents)) {
      throw new Error(DAMAGED);
    }
    sums[item.category] += item.amountCents;
  }
  if (
    snapshot.vehicleSubtotalCents !== sums.vehicle
    || snapshot.generalSubtotalCents !== sums.general
    || snapshot.totalCents !== sums.vehicle + sums.general
  ) {
    throw new Error(DAMAGED);
  }
}

/**
 * Parse stored snapshot JSON. Legacy snapshots pass through untouched, exactly
 * as reprints always read them; sectioned snapshots must be internally
 * consistent; versions from a newer app are refused rather than misprinted.
 */
export function parseExpenseSnapshot(json: string): ExpenseSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(DAMAGED);
  }
  const version = (parsed as { snapshotVersion?: unknown }).snapshotVersion;
  if (version === undefined) return parsed as LegacyExpenseSnapshot;
  if (version !== 2) {
    throw new Error('This expense report was saved by a newer version of the app. Update the app to view it.');
  }
  const snapshot = parsed as SectionedExpenseSnapshot;
  validateSectionedSnapshot(snapshot);
  return snapshot;
}
