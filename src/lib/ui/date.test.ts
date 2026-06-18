import { test, expect, describe } from 'vitest';
import { toIsoDate, defaultInvoicePeriod } from './date';

describe('toIsoDate', () => {
  test('formats a local date as zero-padded YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 5, 9))).toBe('2026-06-09'); // June 9
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('defaultInvoicePeriod', () => {
  test('period ends today (= issue date) and starts 6 days earlier', () => {
    const p = defaultInvoicePeriod();
    expect(p.issueDate).toBe(p.periodEnd);
    expect(String(p.year)).toBe(p.issueDate.slice(0, 4));
    const days = (new Date(p.periodEnd).getTime() - new Date(p.periodStart).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(6);
  });
});
