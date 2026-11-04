/** Result of reading one odometer field exactly as the user typed it. */
export type OdometerParse =
  | { kind: 'blank'; km: null; message: '' }
  | { kind: 'valid'; km: number; message: '' }
  | { kind: 'invalid'; km: null; message: string };

const PLAIN_DIGITS = /^\d+$/;
const GROUPED_DIGITS = /^\d{1,3}(?:,\d{3})+$/;
const GROUPING = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Parse a whole-kilometre odometer reading. Blank stays null (a missing reading),
 * "0" stays 0 (a real reading), and anything else that is not a whole,
 * non-negative, safely representable number is rejected rather than coerced,
 * truncated, or rounded.
 */
export function parseOdometerKm(text: string): OdometerParse {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'blank', km: null, message: '' };
  if (trimmed.startsWith('-')) {
    return { kind: 'invalid', km: null, message: 'cannot be negative' };
  }
  if (/^[\d,]*\.\d*$/.test(trimmed)) {
    return { kind: 'invalid', km: null, message: 'whole kilometres only, no decimals' };
  }
  if (!PLAIN_DIGITS.test(trimmed) && !GROUPED_DIGITS.test(trimmed)) {
    return { kind: 'invalid', km: null, message: 'digits only, like 48,250' };
  }
  const km = Number(trimmed.replaceAll(',', ''));
  if (!Number.isSafeInteger(km)) {
    return { kind: 'invalid', km: null, message: 'too large to record' };
  }
  return { kind: 'valid', km, message: '' };
}

/** A value that may be persisted or finalized as an odometer reading. */
export function isOdometerKm(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Editable text for a stored reading; blank for null, "0" for a zero reading. */
export function formatOdometerInput(km: number | null): string {
  return km === null ? '' : GROUPING.format(km);
}

/** Display a whole number of kilometres, e.g. "48,250 km". */
export function formatKm(km: number): string {
  return `${GROUPING.format(km)} km`;
}
