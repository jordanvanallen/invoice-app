import { test, expect, describe } from 'vitest';
import { applyTax, computeTotals } from './totals';
import type { LineItem } from './types';

function completed(feeCents: number, mileageCents = 0): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: 'x', clientId: null,
    clientName: 'c', locationId: null, location: 'l', date: '2026-05-21',
    vin8: 'AB123456', mileageCents,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '', feeCents,
  };
}
function noshow(feeCents: number, mileageCents = 0): LineItem {
  return { ...completed(feeCents, mileageCents), type: 'noshow' };
}

describe('applyTax (exact integer, half away from zero)', () => {
  test('matches the real sample: 13% of $772.00 = $100.36', () => {
    expect(applyTax(77200, 1300)).toBe(10036);
  });
  test('rounds the .005 boundary up', () => {
    // 50 * 1300 / 10000 = 6.5 -> 7
    expect(applyTax(50, 1300)).toBe(7);
  });
  test('rounds below .005 down', () => {
    // 38 * 1300 / 10000 = 4.94 -> 5 ; 30 * 1300 /10000 = 3.9 -> 4 ; 1 -> 0.13 -> 0
    expect(applyTax(1, 1300)).toBe(0);
  });
  test('zero rate yields zero tax', () => {
    expect(applyTax(77200, 0)).toBe(0);
  });
});

describe('computeTotals', () => {
  test('reproduces the sample invoice totals', () => {
    const lines: LineItem[] = [
      ...Array.from({ length: 19 }, () => completed(3800)),
      noshow(2500), noshow(2500),
    ];
    const t = computeTotals(lines, 1300);
    expect(t.completedSubtotalCents).toBe(72200);
    expect(t.noshowSubtotalCents).toBe(5000);
    expect(t.subtotalCents).toBe(77200);
    expect(t.taxCents).toBe(10036);
    expect(t.totalCents).toBe(87236);
  });
  test('includes mileage in the completed subtotal and taxable base', () => {
    const t = computeTotals([completed(3800, 1500)], 1300);
    expect(t.completedSubtotalCents).toBe(5300);
    expect(t.subtotalCents).toBe(5300);
    expect(t.taxCents).toBe(applyTax(5300, 1300));
  });

  test('includes mileage in the no-show subtotal and taxable base', () => {
    const t = computeTotals([noshow(2500, 1200)], 1300);
    expect(t.noshowSubtotalCents).toBe(3700);
    expect(t.subtotalCents).toBe(3700);
    expect(t.taxCents).toBe(applyTax(3700, 1300));
  });
  test('empty invoice is all zeros', () => {
    const t = computeTotals([], 1300);
    expect(t).toEqual({
      completedSubtotalCents: 0, noshowSubtotalCents: 0,
      subtotalCents: 0, taxCents: 0, totalCents: 0,
    });
  });
});
