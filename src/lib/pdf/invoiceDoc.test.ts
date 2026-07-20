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

type PdfCell = string | { text?: string; colSpan?: number };

function cellText(cell: unknown): string {
  if (typeof cell === 'string') return cell;
  if (cell && typeof cell === 'object' && 'text' in cell) {
    const text = (cell as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function inspectionTableBodies(doc: Record<string, unknown>): PdfCell[][][] {
  const content = doc.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((node) => {
    if (!node || typeof node !== 'object' || !('table' in node)) return [];
    const table = (node as { table?: { body?: unknown } }).table;
    if (!Array.isArray(table?.body)) return [];
    const body = table.body as PdfCell[][];
    return body[0]?.some((cell) => cellText(cell) === 'Inspection #') ? [body] : [];
  });
}

function rowAfterOwner(body: PdfCell[][], inspectionNumber: string): PdfCell[] {
  const ownerIndex = body.findIndex((row) => row.some((cell) => cellText(cell) === inspectionNumber));
  expect(ownerIndex).toBeGreaterThan(0);
  return body[ownerIndex + 1];
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

  test('adds an unnumbered eight-column approval row immediately after its completed charge', () => {
    const doc = buildInvoiceDoc(snap({
      lines: [line({
        inspectionNumber: 'COMPLETE1', mileageCents: 1500,
        mileageApproverId: 7, mileageApproverName: 'Jordan Lee',
        mileageApprovalDate: '2026-07-18',
      })],
    }));
    const [body] = inspectionTableBodies(doc);
    const approvalRow = rowAfterOwner(body, 'COMPLETE1');

    expect(approvalRow[0]).toMatchObject({
      text: 'Mileage approved by Jordan Lee on Jul 18, 2026',
      colSpan: 8,
    });
    expect(approvalRow).toHaveLength(8);
    expect(approvalRow.slice(1)).toEqual(Array(7).fill(''));
  });

  test('adds approval rows to both completed and no-show tables', () => {
    const approval = {
      mileageCents: 1500, mileageApproverId: 7,
      mileageApproverName: 'Jordan Lee', mileageApprovalDate: '2026-07-18',
    };
    const doc = buildInvoiceDoc(snap({ lines: [
      line({ ...approval, inspectionNumber: 'COMPLETE1' }),
      line({ ...approval, type: 'noshow', inspectionNumber: 'NOSHOW01' }),
    ] }));
    const bodies = inspectionTableBodies(doc);

    expect(bodies).toHaveLength(2);
    expect(cellText(rowAfterOwner(bodies[0], 'COMPLETE1')[0])).toBe(
      'Mileage approved by Jordan Lee on Jul 18, 2026',
    );
    expect(cellText(rowAfterOwner(bodies[1], 'NOSHOW01')[0])).toBe(
      'Mileage approved by Jordan Lee on Jul 18, 2026',
    );
  });

  test('keeps seven-column zero-mileage tables free of approval rows', () => {
    const [body] = inspectionTableBodies(buildInvoiceDoc(snap({ lines: [line()] })));

    expect(body).toHaveLength(2);
    expect(body[1]).toHaveLength(7);
    expect(collectText(body).join(' | ')).not.toContain('Mileage approved by');
  });

  test('safely omits approval rows from legacy mileage snapshots with missing approval properties', () => {
    const legacy = line({ inspectionNumber: 'LEGACY01', mileageCents: 1500 }) as Partial<LineItem>;
    delete legacy.mileageApproverId;
    delete legacy.mileageApproverName;
    delete legacy.mileageApprovalDate;
    const [body] = inspectionTableBodies(buildInvoiceDoc(snap({ lines: [legacy as LineItem] })));

    expect(body).toHaveLength(2);
    expect(body[1]).toHaveLength(8);
    expect(collectText(body).join(' | ')).not.toContain('Mileage approved by');
  });

  test('omits the No-Shows table when there are none', () => {
    const text = collectText(buildInvoiceDoc(snap({ lines: [line()] })).content).join(' | ');
    expect(text).not.toContain('No-Shows');
    expect(text).toContain('Completed Inspections');
  });
});
