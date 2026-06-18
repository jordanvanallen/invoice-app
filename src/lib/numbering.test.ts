import { test, expect, describe } from 'vitest';
import { formatInvoiceNumber, checkOverride } from './numbering';

describe('formatInvoiceNumber', () => {
  test('formats seq-year', () => {
    expect(formatInvoiceNumber(8, 2026)).toBe('8-2026');
  });
});

describe('checkOverride', () => {
  const taken = [1, 2, 3, 8];
  test('rejects a sequence already taken this year', () => {
    expect(checkOverride(8, taken)).toEqual({ ok: false, message: 'Invoice number 8 is already used this year.' });
  });
  test('accepts the next sequential number with no warning', () => {
    expect(checkOverride(9, taken)).toEqual({ ok: true });
  });
  test('accepts but warns when the override leaves a gap', () => {
    expect(checkOverride(12, taken)).toEqual({ ok: true, message: 'This skips numbers 9–11, leaving a gap.' });
  });
  test('rejects non-positive sequences', () => {
    expect(checkOverride(0, taken)).toEqual({ ok: false, message: 'Invoice number must be a positive integer.' });
  });
});
