import type { DraftInvoice, LineItem } from './types';

export function normalizeVin8(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

export function isValidVin8(vin8: string): boolean {
  return /^[A-Z0-9]{8}$/.test(vin8);
}

export interface DuplicateReport {
  inspectionNumbers: string[];
  vin8s: string[];
}

/** The fields that identify one inspection: its row type and its exact stored identifiers. */
export type IdentifiedLine = Pick<LineItem, 'type' | 'inspectionNumber' | 'vin8'>;

/**
 * VIN / inspection # -> the invoice number it was billed on, from COMPLETED rows of
 * active (finalized) invoices only. No-shows never reserve an identifier: they get rescheduled.
 */
export interface BilledIdentifiers {
  vins: Record<string, string>;
  inspections: Record<string, string>;
}

/**
 * Own-property lookup, so identifiers such as "constructor" never match an inherited
 * Object member now that a match blocks Lock & Save.
 */
function billedInvoiceFor(record: Record<string, string>, identifier: string): string | undefined {
  if (!identifier || !Object.prototype.hasOwnProperty.call(record, identifier)) return undefined;
  return record[identifier];
}

function repeatedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/** Exact identifiers repeated across COMPLETED rows. No-show rows may repeat any identifier. */
export function findDuplicates(lines: readonly IdentifiedLine[]): DuplicateReport {
  const completed = lines.filter((l) => l.type === 'completed');
  return {
    inspectionNumbers: repeatedValues(completed.map((l) => l.inspectionNumber)),
    vin8s: repeatedValues(completed.map((l) => l.vin8)),
  };
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** A canonical YYYY-MM-DD string that represents a real calendar date. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Deterministic display label for a validated ISO date. */
export function formatIsoDate(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return `${SHORT_MONTHS[month - 1]} ${day}, ${year}`;
}

export type InvoiceFinalizeField =
  | 'invoice' | 'issueDate' | 'inspectionNumber' | 'client' | 'location' | 'date' | 'vin8'
  | 'mileageApprover' | 'mileageApprovalDate';

export interface InvoiceFinalizeBlocker {
  lineIndex: number | null;
  field: InvoiceFinalizeField;
  message: string;
}

type LineFinalizeField = Exclude<InvoiceFinalizeField, 'invoice' | 'issueDate'>;
interface LineFinalizeBlocker extends InvoiceFinalizeBlocker {
  lineIndex: number;
  field: LineFinalizeField;
}

function lineFinalizeBlockers(line: LineItem, lineIndex: number): LineFinalizeBlocker[] {
  const blockers: LineFinalizeBlocker[] = [];
  if (!line.inspectionNumber.trim()) {
    blockers.push({ lineIndex, field: 'inspectionNumber', message: 'Enter an inspection number.' });
  }
  if (!line.clientName.trim()) {
    blockers.push({ lineIndex, field: 'client', message: 'Choose a client.' });
  }
  if (!line.location.trim()) {
    blockers.push({ lineIndex, field: 'location', message: 'Choose a location.' });
  }
  if (!line.date.trim()) {
    blockers.push({ lineIndex, field: 'date', message: 'Choose a date.' });
  }
  if (!line.vin8.trim()) {
    blockers.push({ lineIndex, field: 'vin8', message: 'Enter the last 8 of the VIN.' });
  }
  if (line.mileageCents > 0) {
    if (line.mileageApproverId == null || !line.mileageApproverName.trim()) {
      blockers.push({
        lineIndex,
        field: 'mileageApprover',
        message: 'Select a saved approver or choose Add new approver.',
      });
    }
    if (!isValidIsoDate(line.mileageApprovalDate)) {
      blockers.push({
        lineIndex,
        field: 'mileageApprovalDate',
        message: 'Choose a valid approval date.',
      });
    }
  }
  return blockers;
}

/**
 * Per row of `lines` (same indices), the blockers for a completed row whose exact VIN or
 * inspection # repeats on another completed row of this invoice or was billed before.
 * Each identifier is checked independently; no-show rows never get identifier blockers.
 */
function completedIdentifierBlockers(
  lines: readonly IdentifiedLine[],
  billed: BilledIdentifiers,
): LineFinalizeBlocker[][] {
  const repeated = findDuplicates(lines);
  const repeatedInspections = new Set(repeated.inspectionNumbers);
  const repeatedVins = new Set(repeated.vin8s);
  return lines.map((line, lineIndex) => {
    const blockers: LineFinalizeBlocker[] = [];
    if (line.type !== 'completed') return blockers;
    const { inspectionNumber, vin8 } = line;
    const inspectionBilledOn = billedInvoiceFor(billed.inspections, inspectionNumber);
    const vinBilledOn = billedInvoiceFor(billed.vins, vin8);
    if (inspectionNumber && repeatedInspections.has(inspectionNumber)) {
      blockers.push({
        lineIndex, field: 'inspectionNumber',
        message: `Inspection #${inspectionNumber} is on more than one completed row.`,
      });
    }
    if (inspectionBilledOn) {
      blockers.push({
        lineIndex, field: 'inspectionNumber',
        message: `Inspection #${inspectionNumber} was already billed on invoice #${inspectionBilledOn}.`,
      });
    }
    if (vin8 && repeatedVins.has(vin8)) {
      blockers.push({ lineIndex, field: 'vin8', message: `VIN ${vin8} is on more than one completed row.` });
    }
    if (vinBilledOn) {
      blockers.push({ lineIndex, field: 'vin8', message: `VIN ${vin8} was already billed on invoice #${vinBilledOn}.` });
    }
    return blockers;
  });
}

/** The first reason a set of rows can't become active without billing an inspection twice. */
export function completedIdentifierConflict(
  lines: readonly IdentifiedLine[],
  billed: BilledIdentifiers,
): string | null {
  return completedIdentifierBlockers(lines, billed).flat()[0]?.message ?? null;
}

/**
 * Everything that stops Lock & Save, in display order. `billed` must come from finalized
 * invoices; line indices always refer to `draft.lines`, including no-show rows.
 */
export function invoiceFinalizeBlockers(
  draft: DraftInvoice,
  billed: BilledIdentifiers,
): InvoiceFinalizeBlocker[] {
  const headerBlockers: InvoiceFinalizeBlocker[] = isValidIsoDate(draft.issueDate)
    ? []
    : [{ lineIndex: null, field: 'issueDate', message: 'Choose a valid invoice date.' }];
  if (draft.lines.length === 0) {
    return [
      ...headerBlockers,
      { lineIndex: null, field: 'invoice', message: 'Add at least one invoice row.' },
    ];
  }
  const identifierBlockers = completedIdentifierBlockers(draft.lines, billed);
  return [
    ...headerBlockers,
    ...draft.lines.flatMap((line, i) => [...lineFinalizeBlockers(line, i), ...identifierBlockers[i]]),
  ];
}

export interface InvoiceRowWarningContext {
  /** Identifiers repeated across completed rows (from `findDuplicates`). */
  dupInspections: ReadonlySet<string>;
  dupVins: ReadonlySet<string>;
  billed: BilledIdentifiers;
  periodStart: string;
  periodEnd: string;
}

/** Notes shown under an editor row. Identifier notes apply to completed rows only. */
export function invoiceRowWarnings(row: LineItem, context: InvoiceRowWarningContext): string[] {
  const w: string[] = [];
  const isCompleted = row.type === 'completed';
  const inspectionBilledOn = isCompleted ? billedInvoiceFor(context.billed.inspections, row.inspectionNumber) : undefined;
  const vinBilledOn = isCompleted ? billedInvoiceFor(context.billed.vins, row.vin8) : undefined;
  if (isCompleted && row.inspectionNumber && context.dupInspections.has(row.inspectionNumber)) {
    w.push(`Inspection #${row.inspectionNumber} is on more than one completed row`);
  }
  if (isCompleted && row.vin8 && context.dupVins.has(row.vin8)) w.push(`VIN ${row.vin8} is on more than one completed row`);
  if (row.vin8 && !isValidVin8(row.vin8)) w.push(`VIN should be 8 characters — has ${row.vin8.length}`);
  if (inspectionBilledOn) w.push(`Inspection #${row.inspectionNumber} was already billed on invoice #${inspectionBilledOn}`);
  if (vinBilledOn) w.push(`VIN ${row.vin8} was already billed on invoice #${vinBilledOn}`);
  if (row.date && isDateOutsidePeriod(row.date, context.periodStart, context.periodEnd)) {
    w.push('Date is outside the billing period');
  }
  return w;
}

const FINALIZE_FIELD_LABELS: Record<LineFinalizeField, string> = {
  inspectionNumber: 'inspection number',
  client: 'client',
  location: 'location',
  date: 'date',
  vin8: 'VIN',
  mileageApprover: 'mileage approver',
  mileageApprovalDate: 'mileage approval date',
};

/** Required fields for finalize, in a stable display order. */
export function missingFinalizeFields(line: LineItem): string[] {
  return lineFinalizeBlockers(line, 0).map(({ field }) => FINALIZE_FIELD_LABELS[field]);
}

/** ISO date strings compare correctly with simple string comparison. */
export function isDateOutsidePeriod(date: string, start: string, end: string): boolean {
  return date < start || date > end;
}

/**
 * Canadian GST/HST registration number: a 9-digit Business Number + "RT" +
 * 4-digit reference (e.g. 123456789RT0001). Tolerant of spaces and case.
 */
export function isValidHstNumber(raw: string): boolean {
  return /^\d{9}RT\d{4}$/.test(raw.replace(/\s/g, '').toUpperCase());
}

/** Pragmatic email check: something@something.tld with no spaces. */
export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** A tax rate the user typed (percent): a number in [0, 100]. */
export function isValidTaxPercent(raw: string): boolean {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
}

/** A dollar amount the user typed: a finite number >= 0. */
export function isValidDollars(raw: string): boolean {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0;
}

/** The business-detail fields collected by both the first-run wizard and Settings. */
export interface BusinessFields {
  inspectorName: string;
  inspectorAddress: string;
  inspectorNumber: string;
  gstHstRegistrationNumber: string;
  taxPercent: string;
  completedFee: string;
  noshowFee: string;
  billToName: string;
  billToAddress: string;
  paymentEmail: string;
  footerNotes: string;
}
export type BusinessFieldErrors = Record<keyof BusinessFields, string>;

/**
 * Per-field error messages ('' = valid) for the business details. Shared by the
 * setup wizard and Settings so the two screens validate identically and can't drift.
 */
export function businessFieldErrors(f: BusinessFields): BusinessFieldErrors {
  const required = (v: string) => v.trim() === '';
  return {
    inspectorName: required(f.inspectorName) ? 'Enter your name.' : '',
    inspectorAddress: required(f.inspectorAddress) ? 'Enter your address.' : '',
    inspectorNumber: required(f.inspectorNumber) ? 'Enter your inspector number.' : '',
    gstHstRegistrationNumber:
      required(f.gstHstRegistrationNumber) ? 'Enter your GST/HST number.'
      : !isValidHstNumber(f.gstHstRegistrationNumber) ? 'Use the format 123456789RT0001.' : '',
    taxPercent: !isValidTaxPercent(f.taxPercent) ? 'Enter a rate between 0 and 100.' : '',
    completedFee: !isValidDollars(f.completedFee) ? 'Enter a dollar amount.' : '',
    noshowFee: !isValidDollars(f.noshowFee) ? 'Enter a dollar amount.' : '',
    billToName: required(f.billToName) ? 'Enter who you bill.' : '',
    billToAddress: required(f.billToAddress) ? 'Enter their address.' : '',
    paymentEmail:
      required(f.paymentEmail) ? 'Enter a payment email.'
      : !isValidEmail(f.paymentEmail) ? 'Enter a valid email address.' : '',
    footerNotes: required(f.footerNotes) ? 'Enter a footer note.' : '',
  };
}

/** True when every business field is valid. */
export function hasNoErrors(errs: BusinessFieldErrors): boolean {
  return Object.values(errs).every((m) => m === '');
}
