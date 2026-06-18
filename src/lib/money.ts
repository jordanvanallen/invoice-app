import type { Cents } from './types';

/** Parse a user-entered dollar string into integer cents. Throws on bad input. */
export function parseDollars(input: string): Cents {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid dollar amount: "${input}"`);
  }
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents;
}

/**
 * Format integer cents as a 2-decimal string, no currency symbol.
 * The float division here is for DISPLAY ONLY — its result is never fed back
 * into money arithmetic (all math stays in integer cents).
 */
export function formatCents(c: Cents): string {
  return (c / 100).toFixed(2);
}

/** Format integer cents as a dollar string with symbol. */
export function formatDollars(c: Cents): string {
  return `$${formatCents(c)}`;
}

/** Sum integer cents exactly (inputs assumed integers). */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
