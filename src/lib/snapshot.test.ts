import { test, expect, describe } from 'vitest';
import { buildFinalizedSnapshot } from './snapshot';
import type { DraftInvoice, LineItem, Settings } from './types';

function settings(over: Partial<Settings> = {}): Settings {
  return {
    inspectorName: 'Jane Tester',
    inspectorAddress: '123 Test Street, Sampleton, ON A1A 1A1',
    inspectorNumber: '00000',
    gstHstRegistrationNumber: '123456789RT0001',
    billToName: 'Example Client Inc.',
    billToAddress: '100 Example Ave Suite 1, Sample City, QC A1A 1A1',
    registered: true,
    taxRateBp: 1300,
    defaultCompletedFeeCents: 3800,
    defaultNoshowFeeCents: 2500,
    paymentEmail: 'billing@example.com',
    footerNotes: 'Email the completed form to billing@example.com',
    logoDataUrl: "",
    ...over,
  };
}
function completed(): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0, feeCents: 3800,
  };
}
function draft(): DraftInvoice {
  return {
    seq: null, year: 2026, issueDate: '2026-05-28',
    periodStart: '2026-05-21', periodEnd: '2026-05-27', lines: [completed()],
  };
}

describe('buildFinalizedSnapshot', () => {
  test('freezes settings, assigns the number, and computes totals', () => {
    const snap = buildFinalizedSnapshot(draft(), settings(), 8);
    expect(snap.invoiceNumber).toBe('8-2026');
    expect(snap.seq).toBe(8);
    expect(snap.gstHstRegistrationNumber).toBe('123456789RT0001');
    expect(snap.billToName).toBe('Example Client Inc.');
    expect(snap.taxRateBp).toBe(1300);
    expect(snap.totals.subtotalCents).toBe(3800);
    expect(snap.totals.taxCents).toBe(494); // 3800*0.13 = 494
    expect(snap.totals.totalCents).toBe(4294);
  });

  test('is value-stable after the source settings/client later change', () => {
    const s = settings();
    const snap = buildFinalizedSnapshot(draft(), s, 8);
    // Mutate the source objects the way a later rename / fee change would.
    s.defaultCompletedFeeCents = 4000;
    s.footerNotes = 'CHANGED';
    // The already-built snapshot must NOT reflect the later mutation to `s`.
    expect(snap.footerNotes).toBe('Email the completed form to billing@example.com');
    expect(snap.totals.subtotalCents).toBe(3800);
    snap.lines[0].clientName = 'should-not-leak-back'; // local mutation only
    const fresh = buildFinalizedSnapshot(draft(), settings(), 8);
    expect(fresh.footerNotes).toBe('Email the completed form to billing@example.com');
    expect(fresh.lines[0].clientName).toBe('Acme Lease Corp');
    expect(fresh.totals.subtotalCents).toBe(3800);
  });
});
