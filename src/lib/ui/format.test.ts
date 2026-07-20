import { test, expect, describe } from 'vitest';
import {
  bpToPercentInput,
  canonicalInvoiceMoneyInput,
  centsToInput,
  inputToCents,
  invoiceMoneyInputTransition,
  percentInputToBp,
} from './format';

describe('money input helpers', () => {
  test('centsToInput formats cents as a dollar string', () => {
    expect(centsToInput(3800)).toBe('38.00');
    expect(centsToInput(2550)).toBe('25.50');
  });
  test('inputToCents parses back to cents', () => {
    expect(inputToCents('38')).toBe(3800);
    expect(inputToCents('$25.50')).toBe(2550);
  });

  test('captures every raw invoice-money keystroke with its matching cents transition', () => {
    expect(invoiceMoneyInputTransition(0, '1')).toEqual({
      text: '1', cents: 100, becamePositive: true,
    });
    expect(invoiceMoneyInputTransition(120, '1.25')).toEqual({
      text: '1.25', cents: 125, becamePositive: false,
    });
    expect(invoiceMoneyInputTransition(125, '')).toEqual({
      text: '', cents: 0, becamePositive: false,
    });
    expect(invoiceMoneyInputTransition(100, '2')).toEqual({
      text: '2', cents: 200, becamePositive: false,
    });
  });

  test('canonicalizes invoice money on blur while mileage zero stays blank', () => {
    expect(canonicalInvoiceMoneyInput(1234)).toBe('12.34');
    expect(canonicalInvoiceMoneyInput(0)).toBe('0.00');
    expect(canonicalInvoiceMoneyInput(5, true)).toBe('0.05');
    expect(canonicalInvoiceMoneyInput(0, true)).toBe('');
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
