import { test, expect, describe } from 'vitest';
import { expensePdfBytes, invoicePdfBytes, summaryPdfBytes } from './generate';
import type { FinalizedSnapshot, LineItem } from '../types';
import type { ExpenseSnapshot } from '../expense/types';

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0, feeCents: 3800, ...over,
  };
}

const snap: FinalizedSnapshot = {
  invoiceNumber: '8-2026', seq: 8, year: 2026, issueDate: '2026-05-28',
  periodStart: '2026-05-21', periodEnd: '2026-05-27',
  inspectorName: 'Jane Tester', inspectorAddress: '123 Test Street',
  inspectorNumber: '00000', gstHstRegistrationNumber: '123456789RT0001',
  billToName: 'Example Client Inc.', billToAddress: '100 Example Ave',
  registered: true, taxRateBp: 1300, paymentEmail: 'billing@example.com',
  footerNotes: 'Email the completed form to billing@example.com',
  logoDataUrl: "",
  lines: [line(), line({ type: 'noshow', clientName: 'Pioneer Motor Finance', feeCents: 2500 })],
  totals: { completedSubtotalCents: 3800, noshowSubtotalCents: 2500, subtotalCents: 6300, taxCents: 819, totalCents: 7119 },
};

describe('invoicePdfBytes', () => {
  test('actually generates a non-empty PDF (real pdfmake + fonts)', async () => {
    const bytes = await invoicePdfBytes(snap);
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF magic header "%PDF"
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });

  test('tax summary generates a non-empty PDF', async () => {
    const bytes = await summaryPdfBytes({
      title: 'Tax Summary — 2026', note: 'From finalized invoices.',
      preparedOn: '2026-06-08', businessName: 'Jane Tester',
      rollup: { count: 3, totalBilledCents: 87236, totalTaxCents: 10036 },
      breakdown: [{ clientName: 'Globex Finance', count: 2, subtotalCents: 7600 }],
    });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });

  test('expense report generates a non-empty PDF', async () => {
    const expense: ExpenseSnapshot = {
      reportNumber: '7-2026', seq: 7, year: 2026, reportDate: '2026-07-15',
      periodStart: '2026-07-01', periodEnd: '2026-07-15',
      inspectorName: 'Jane Tester', inspectorAddress: '123 Test Street',
      inspectorNumber: '00000', logoDataUrl: '',
      items: [{ position: 0, date: '2026-07-02', description: 'Fuel', amountCents: 5_000 }],
      totalCents: 5_000,
    };

    const bytes = await expensePdfBytes(expense);

    expect(bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });
});
