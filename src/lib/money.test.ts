import { test, expect, describe } from 'vitest';
import { parseDollars, formatCents, formatDollars, sumCents } from './money';

describe('parseDollars', () => {
  test('parses whole dollars to cents', () => {
    expect(parseDollars('38')).toBe(3800);
  });
  test('parses decimals', () => {
    expect(parseDollars('38.00')).toBe(3800);
    expect(parseDollars('25.50')).toBe(2550);
  });
  test('tolerates $ , and whitespace', () => {
    expect(parseDollars(' $1,234.56 ')).toBe(123456);
  });
  test('throws on invalid input', () => {
    expect(() => parseDollars('abc')).toThrow();
    expect(() => parseDollars('1.234')).toThrow(); // >2 decimals
  });
});

describe('formatCents / formatDollars', () => {
  test('formats cents to 2dp string without symbol', () => {
    expect(formatCents(3800)).toBe('38.00');
    expect(formatCents(100360)).toBe('1003.60');
  });
  test('formatDollars adds the symbol', () => {
    expect(formatDollars(87236)).toBe('$872.36');
  });
});

describe('sumCents', () => {
  test('sums an array of integer cents exactly', () => {
    expect(sumCents([3800, 3800, 2500])).toBe(10100);
    expect(sumCents([])).toBe(0);
  });
});
