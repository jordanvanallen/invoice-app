import { test, expect, describe } from 'vitest';
import { centsToInput, inputToCents, bpToPercentInput, percentInputToBp } from './format';

describe('money input helpers', () => {
  test('centsToInput formats cents as a dollar string', () => {
    expect(centsToInput(3800)).toBe('38.00');
    expect(centsToInput(2550)).toBe('25.50');
  });
  test('inputToCents parses back to cents', () => {
    expect(inputToCents('38')).toBe(3800);
    expect(inputToCents('$25.50')).toBe(2550);
  });
});

describe('percent <-> basis points', () => {
  test('bpToPercentInput', () => {
    expect(bpToPercentInput(1300)).toBe('13');
    expect(bpToPercentInput(1350)).toBe('13.5');
    expect(bpToPercentInput(0)).toBe('0');
  });
  test('percentInputToBp', () => {
    expect(percentInputToBp('13')).toBe(1300);
    expect(percentInputToBp(' 13.5 ')).toBe(1350);
    expect(percentInputToBp('0')).toBe(0);
  });
  test('percentInputToBp rejects invalid', () => {
    expect(() => percentInputToBp('abc')).toThrow();
    expect(() => percentInputToBp('-5')).toThrow();
  });
});
