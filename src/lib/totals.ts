import type { BasisPoints, Cents, InvoiceTotals, LineItem } from './types';

/**
 * Apply a basis-point tax rate to a taxable amount in cents using exact integer
 * division, rounding half away from zero. No floating-point money.
 * Assumes non-negative inputs (invoices never have negative totals).
 */
export function applyTax(taxableCents: Cents, rateBp: BasisPoints): Cents {
  const numerator = taxableCents * rateBp; // integer
  const quotient = Math.floor(numerator / 10000);
  const remainder = numerator % 10000;
  return remainder * 2 >= 10000 ? quotient + 1 : quotient;
}

export function computeTotals(lines: LineItem[], rateBp: BasisPoints): InvoiceTotals {
  let completedSubtotalCents = 0;
  let noshowSubtotalCents = 0;

  for (const line of lines) {
    if (line.type === 'completed') {
      completedSubtotalCents += line.feeCents + line.mileageCents;
    } else {
      noshowSubtotalCents += line.feeCents + line.mileageCents;
    }
  }

  const subtotalCents = completedSubtotalCents + noshowSubtotalCents;
  const taxCents = applyTax(subtotalCents, rateBp);
  const totalCents = subtotalCents + taxCents;

  return { completedSubtotalCents, noshowSubtotalCents, subtotalCents, taxCents, totalCents };
}
