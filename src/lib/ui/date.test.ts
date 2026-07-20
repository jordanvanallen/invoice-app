import { test, expect, describe } from 'vitest';
import {
  calendarDateLabel,
  defaultInvoicePeriod,
  initialCalendarDate,
  moveCalendarDateByKey,
  moveCalendarMonth,
  toIsoDate,
} from './date';

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

describe('calendar navigation', () => {
  test('initial focus prefers a valid selected date and otherwise uses today', () => {
    const today = new Date(2026, 6, 20);
    expect(toIsoDate(initialCalendarDate('2026-07-09', today))).toBe('2026-07-09');
    expect(toIsoDate(initialCalendarDate('', today))).toBe('2026-07-20');
    expect(toIsoDate(initialCalendarDate('not-a-date', today))).toBe('2026-07-20');
  });

  test('full date labels include weekday, month, day, and year', () => {
    expect(calendarDateLabel(new Date(2026, 6, 5), 'en-US')).toBe('Sunday, July 5, 2026');
  });

  test('Arrow keys move by one day or one week across month and year boundaries', () => {
    expect(toIsoDate(moveCalendarDateByKey(new Date(2026, 2, 1), 'ArrowLeft')!)).toBe('2026-02-28');
    expect(toIsoDate(moveCalendarDateByKey(new Date(2026, 0, 31), 'ArrowRight')!)).toBe('2026-02-01');
    expect(toIsoDate(moveCalendarDateByKey(new Date(2026, 0, 3), 'ArrowUp')!)).toBe('2025-12-27');
    expect(toIsoDate(moveCalendarDateByKey(new Date(2026, 11, 28), 'ArrowDown')!)).toBe('2027-01-04');
    expect(moveCalendarDateByKey(new Date(2026, 6, 20), 'Enter')).toBeNull();
  });

  test('month movement preserves the day when possible and clamps to month end', () => {
    expect(toIsoDate(moveCalendarMonth(new Date(2025, 0, 31), 1))).toBe('2025-02-28');
    expect(toIsoDate(moveCalendarMonth(new Date(2024, 0, 31), 1))).toBe('2024-02-29');
    expect(toIsoDate(moveCalendarMonth(new Date(2026, 11, 15), 1))).toBe('2027-01-15');
  });
});
