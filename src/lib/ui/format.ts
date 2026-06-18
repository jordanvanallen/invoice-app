import { formatCents, parseDollars } from '../money';
import type { BasisPoints, Cents } from '../types';

/** Cents -> an editable dollar string ("3800" -> "38.00"). */
export function centsToInput(c: Cents): string {
  return formatCents(c);
}

/** Editable dollar string -> cents. Throws on invalid input. */
export function inputToCents(s: string): Cents {
  return parseDollars(s);
}

/** Basis points -> a percent string for display/edit (1300 -> "13", 1350 -> "13.5"). */
export function bpToPercentInput(bp: BasisPoints): string {
  return String(bp / 100);
}

/** Percent string -> basis points ("13" -> 1300, "13.5" -> 1350). Throws on invalid. */
export function percentInputToBp(s: string): BasisPoints {
  const n = Number(s.trim());
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid percent: "${s}"`);
  }
  return Math.round(n * 100);
}
