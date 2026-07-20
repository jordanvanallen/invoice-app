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

export interface InvoiceMoneyInputTransition {
  text: string;
  cents: Cents;
  becamePositive: boolean;
}

/** Capture one invoice money edit without depending on Svelte binding/listener order. */
export function invoiceMoneyInputTransition(
  priorCents: Cents,
  raw: string,
): InvoiceMoneyInputTransition {
  const dollars = Number(raw.trim());
  const cents = Number.isFinite(dollars) && dollars >= 0
    ? Math.round(dollars * 100)
    : 0;
  return {
    text: raw,
    cents,
    becamePositive: priorCents <= 0 && cents > 0,
  };
}

/** Canonical blur text; mileage keeps its existing blank-for-zero presentation. */
export function canonicalInvoiceMoneyInput(cents: Cents, blankWhenZero = false): string {
  return blankWhenZero && cents === 0 ? '' : centsToInput(cents);
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
