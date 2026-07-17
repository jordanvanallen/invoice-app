import type { LineItem } from './types';

export function normalizeVin8(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

export function isValidVin8(vin8: string): boolean {
  return /^[A-Z0-9]{8}$/.test(vin8);
}

/** Required fields for finalize, in a stable display order. */
export function missingFinalizeFields(line: LineItem): string[] {
  const missing: string[] = [];
  if (!line.inspectionNumber.trim()) missing.push('inspection number');
  if (!line.clientName.trim()) missing.push('client');
  if (!line.location.trim()) missing.push('location');
  if (!line.date.trim()) missing.push('date');
  if (!line.vin8.trim()) missing.push('VIN');
  return missing;
}

export interface DuplicateReport {
  inspectionNumbers: string[];
  vin8s: string[];
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

export function findDuplicates(lines: LineItem[]): DuplicateReport {
  return {
    inspectionNumbers: repeatedValues(lines.map((l) => l.inspectionNumber)),
    vin8s: repeatedValues(lines.map((l) => l.vin8)),
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
