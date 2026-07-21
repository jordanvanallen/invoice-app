import { describe, expect, test } from 'vitest';
import { buildSummaryDoc } from './yearSummaryDoc';

function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((value) => collectText(value, out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text' && (typeof value === 'string' || typeof value === 'number')) out.push(String(value));
      else collectText(value, out);
    }
  }
  return out;
}

describe('invoice summary document', () => {
  test('uses a stable title and the frozen range label', () => {
    const text = collectText(buildSummaryDoc({
      rangeLabel: 'All time',
      preparedOn: '2026-07-21',
      businessName: 'Jane Tester',
      rollup: { count: 2, totalBilledCents: 16_950, totalTaxCents: 1_950 },
      breakdown: [{ clientName: 'A Co', count: 2, subtotalCents: 15_000 }],
    }));

    expect(text).toEqual(expect.arrayContaining([
      'Tax Summary', 'All time', 'Invoices issued', '2', 'A Co', '$150.00',
    ]));
  });
});
