import { describe, expect, test } from 'vitest';
import { formatKm, formatOdometerInput, isOdometerKm, parseOdometerKm } from './odometer';

describe('parseOdometerKm', () => {
  test('keeps a blank reading distinct from a real zero reading', () => {
    expect(parseOdometerKm('')).toEqual({ kind: 'blank', km: null, message: '' });
    expect(parseOdometerKm('   ')).toEqual({ kind: 'blank', km: null, message: '' });
    expect(parseOdometerKm('0')).toEqual({ kind: 'valid', km: 0, message: '' });
    expect(parseOdometerKm(' 000 ')).toEqual({ kind: 'valid', km: 0, message: '' });
  });

  test('accepts whole kilometres with or without correct thousands grouping', () => {
    expect(parseOdometerKm('48250').km).toBe(48_250);
    expect(parseOdometerKm('48,250').km).toBe(48_250);
    expect(parseOdometerKm('1,234,567').km).toBe(1_234_567);
    expect(parseOdometerKm(String(Number.MAX_SAFE_INTEGER)).km).toBe(Number.MAX_SAFE_INTEGER);
  });

  test('rejects decimals instead of truncating or rounding them', () => {
    for (const text of ['12.5', '12.0', '12.', '.5', '1,234.9']) {
      expect(parseOdometerKm(text)).toEqual({
        kind: 'invalid', km: null, message: 'whole kilometres only, no decimals',
      });
    }
  });

  test('rejects negative and malformed text instead of coercing it to zero', () => {
    expect(parseOdometerKm('-1')).toMatchObject({ kind: 'invalid', km: null, message: 'cannot be negative' });
    expect(parseOdometerKm('-0')).toMatchObject({ kind: 'invalid', km: null });
    for (const text of ['abc', '12a', '1e3', '+5', '0x10', '12 345', '12,34', ',123', '1,,234', 'Infinity', 'NaN']) {
      const parsed = parseOdometerKm(text);
      expect(parsed.kind, text).toBe('invalid');
      expect(parsed.km, text).toBeNull();
    }
  });

  test('rejects readings that are not exactly representable integers', () => {
    expect(parseOdometerKm(String(Number.MAX_SAFE_INTEGER + 1))).toEqual({
      kind: 'invalid', km: null, message: 'too large to record',
    });
    expect(parseOdometerKm('99999999999999999999').kind).toBe('invalid');
  });
});

describe('odometer value guards and formatting', () => {
  test('accepts only non-negative safe integers as persisted readings', () => {
    expect(isOdometerKm(0)).toBe(true);
    expect(isOdometerKm(Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '5', null]) {
      expect(isOdometerKm(value), String(value)).toBe(false);
    }
  });

  test('round-trips stored readings through editable text without losing zero', () => {
    expect(formatOdometerInput(null)).toBe('');
    expect(formatOdometerInput(0)).toBe('0');
    expect(formatOdometerInput(48_250)).toBe('48,250');
    expect(parseOdometerKm(formatOdometerInput(48_250)).km).toBe(48_250);
    expect(parseOdometerKm(formatOdometerInput(0)).km).toBe(0);
    expect(formatKm(1_234)).toBe('1,234 km');
  });
});
