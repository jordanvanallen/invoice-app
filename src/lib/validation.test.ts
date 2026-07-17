import { test, expect, describe } from 'vitest';
import {
  normalizeVin8, isValidVin8, missingFinalizeFields,
  findDuplicates, isValidIsoDate, formatIsoDate, isDateOutsidePeriod,
  isValidHstNumber, isValidEmail, isValidTaxPercent, isValidDollars,
  businessFieldErrors, hasNoErrors, type BusinessFields,
} from './validation';
import type { LineItem } from './types';

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0, feeCents: 3800,
    ...over,
  };
}

describe('normalizeVin8 / isValidVin8', () => {
  test('uppercases and strips spaces', () => {
    expect(normalizeVin8(' xy12 ab99 ')).toBe('XY12AB99');
  });
  test('valid only when exactly 8 alphanumerics', () => {
    expect(isValidVin8('XY12AB99')).toBe(true);
    expect(isValidVin8('PS5009')).toBe(false);
    expect(isValidVin8('XY12AB991')).toBe(false);
    expect(isValidVin8('PS-00942')).toBe(false);
  });
});

describe('missingFinalizeFields', () => {
  test('returns [] for a complete line', () => {
    expect(missingFinalizeFields(line())).toEqual([]);
  });
  test('lists each missing required field', () => {
    const bad = line({ inspectionNumber: '', vin8: '', clientName: '', location: '', date: '' });
    expect(missingFinalizeFields(bad)).toEqual(
      ['inspection number', 'client', 'location', 'date', 'VIN'],
    );
  });
});

describe('findDuplicates (within one invoice)', () => {
  test('flags repeated inspection numbers and VINs', () => {
    const lines = [
      line({ inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ inspectionNumber: '100', vin8: 'BBBB2222' }),
      line({ inspectionNumber: '300', vin8: 'AAAA1111' }),
    ];
    expect(findDuplicates(lines)).toEqual({
      inspectionNumbers: ['100'],
      vin8s: ['AAAA1111'],
    });
  });
  test('no duplicates returns empty arrays', () => {
    expect(findDuplicates([line({ inspectionNumber: '1', vin8: 'AAAA1111' })]))
      .toEqual({ inspectionNumbers: [], vin8s: [] });
  });
});

describe('isValidIsoDate / formatIsoDate', () => {
  test('accepts canonical real dates including leap day', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  test('rejects blank, non-canonical, impossible, and arbitrary values', () => {
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('   ')).toBe(false);
    expect(isValidIsoDate('2026-7-01')).toBe(false);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
  });

  test('formats a validated ISO date without timezone conversion', () => {
    expect(formatIsoDate('2026-07-01')).toBe('Jul 1, 2026');
    expect(formatIsoDate('2026-12-15')).toBe('Dec 15, 2026');
  });
});

describe('isDateOutsidePeriod', () => {
  test('true when before, after, or in the future relative to the period', () => {
    expect(isDateOutsidePeriod('2026-05-20', '2026-05-21', '2026-05-27')).toBe(true);
    expect(isDateOutsidePeriod('2026-05-28', '2026-05-21', '2026-05-27')).toBe(true);
    expect(isDateOutsidePeriod('2026-05-24', '2026-05-21', '2026-05-27')).toBe(false);
  });
});

describe('isValidHstNumber', () => {
  test('accepts a well-formed BN + RT account, tolerating spaces/case', () => {
    expect(isValidHstNumber('123456789RT0001')).toBe(true);
    expect(isValidHstNumber('123456789 RT 0001')).toBe(true);
    expect(isValidHstNumber('123456789rt0001')).toBe(true);
  });
  test('rejects malformed numbers', () => {
    expect(isValidHstNumber('')).toBe(false);
    expect(isValidHstNumber('123456789')).toBe(false);      // missing RT account
    expect(isValidHstNumber('12345678RT0001')).toBe(false); // only 8 BN digits
    expect(isValidHstNumber('123456789RT001')).toBe(false); // only 3 ref digits
    expect(isValidHstNumber('123456789RP0001')).toBe(false);// wrong program code
  });
});

describe('isValidEmail', () => {
  test('accepts plausible addresses', () => {
    expect(isValidEmail('billing@example.com')).toBe(true);
    expect(isValidEmail('a.b+c@sub.domain.co')).toBe(true);
  });
  test('rejects malformed addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('no@domain')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });
});

describe('isValidTaxPercent', () => {
  test('accepts 0..100', () => {
    expect(isValidTaxPercent('13')).toBe(true);
    expect(isValidTaxPercent('0')).toBe(true);
    expect(isValidTaxPercent('5.5')).toBe(true);
  });
  test('rejects blank, non-numeric, or out of range', () => {
    expect(isValidTaxPercent('')).toBe(false);
    expect(isValidTaxPercent('abc')).toBe(false);
    expect(isValidTaxPercent('-1')).toBe(false);
    expect(isValidTaxPercent('101')).toBe(false);
  });
});

describe('isValidDollars', () => {
  test('accepts non-negative numbers', () => {
    expect(isValidDollars('38.00')).toBe(true);
    expect(isValidDollars('0')).toBe(true);
  });
  test('rejects blank, non-numeric, or negative', () => {
    expect(isValidDollars('')).toBe(false);
    expect(isValidDollars('x')).toBe(false);
    expect(isValidDollars('-5')).toBe(false);
  });
});

describe('businessFieldErrors / hasNoErrors', () => {
  const valid: BusinessFields = {
    inspectorName: 'Jane Tester', inspectorAddress: '123 Test St', inspectorNumber: '12345',
    gstHstRegistrationNumber: '123456789RT0001', taxPercent: '13', completedFee: '38.00',
    noshowFee: '25.00', billToName: 'Example Co', billToAddress: '1 Example Ave',
    paymentEmail: 'billing@example.com', footerNotes: 'Email payment to billing@example.com',
  };

  test('fully valid fields produce no errors', () => {
    expect(hasNoErrors(businessFieldErrors(valid))).toBe(true);
  });

  test('flags each invalid field while leaving valid ones empty', () => {
    const e = businessFieldErrors({
      ...valid, inspectorName: '   ', gstHstRegistrationNumber: 'bad',
      paymentEmail: 'nope', taxPercent: '200', completedFee: '',
    });
    expect(hasNoErrors(e)).toBe(false);
    expect(e.inspectorName).not.toBe('');
    expect(e.gstHstRegistrationNumber).toMatch(/123456789RT0001/);
    expect(e.paymentEmail).toMatch(/valid email/i);
    expect(e.taxPercent).not.toBe('');
    expect(e.completedFee).not.toBe('');
    expect(e.inspectorAddress).toBe(''); // a valid field stays clear
  });
});
