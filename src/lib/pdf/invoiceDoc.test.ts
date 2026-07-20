import { test, expect, describe } from 'vitest';
import { buildInvoiceDoc } from './invoiceDoc';
import type { FinalizedSnapshot, LineItem } from '../types';

/** Recursively collect every `text` string in a pdfmake doc fragment. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const n of node) collectText(n, out);
  } else if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    for (const v of Object.values(o)) if (typeof v === 'object') collectText(v, out);
  }
  return out;
}

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '',
    feeCents: 3800, ...over,
  };
}

function snap(over: Partial<FinalizedSnapshot> = {}): FinalizedSnapshot {
  return {
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
    ...over,
  };
}

describe('buildInvoiceDoc', () => {
  test('includes invoice number, reg number, client names, and total', () => {
    const text = collectText(buildInvoiceDoc(snap()).content).join(' | ');
    expect(text).toContain('#8-2026');
    expect(text).toContain('123456789RT0001');
    expect(text).toContain('Acme Lease Corp');
    expect(text).toContain('Pioneer Motor Finance');
    expect(text).toContain('HST 13%');
    expect(text).toContain('$71.19'); // total
  });

  test('omits the HST line and reg number when not registered', () => {
    const text = collectText(buildInvoiceDoc(snap({ registered: false })).content).join(' | ');
    expect(text).not.toContain('HST 13%');
    expect(text).not.toContain('123456789RT0001');
  });

  test('shows a Mileage column only when a line has mileage', () => {
    const without = collectText(buildInvoiceDoc(snap({ lines: [line()] })).content).join(' | ');
    expect(without).not.toContain('Mileage');
    const withMileage = collectText(buildInvoiceDoc(snap({ lines: [line({ mileageCents: 1500 })] })).content).join(' | ');
    expect(withMileage).toContain('Mileage');
    expect(withMileage).toContain('$15.00');
  });

  test('omits the No-Shows table when there are none', () => {
    const text = collectText(buildInvoiceDoc(snap({ lines: [line()] })).content).join(' | ');
    expect(text).not.toContain('No-Shows');
    expect(text).toContain('Completed Inspections');
  });
});
