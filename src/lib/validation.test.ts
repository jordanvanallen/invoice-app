import { test, expect, describe } from 'vitest';
import {
  normalizeVin8, isValidVin8, missingFinalizeFields,
  invoiceFinalizeBlockers, invoiceRowWarnings,
  findDuplicates, isValidIsoDate, formatIsoDate, isDateOutsidePeriod,
  isValidHstNumber, isValidEmail, isValidTaxPercent, isValidDollars,
  businessFieldErrors, hasNoErrors, type BusinessFields, type BilledIdentifiers,
} from './validation';
import type { DraftInvoice, LineItem } from './types';

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    type: 'completed', position: 0, inspectionNumber: '12345678', clientId: 1,
    clientName: 'Acme Lease Corp', locationId: 1, location: 'Maplewood',
    date: '2026-05-21', vin8: 'XY12AB99', mileageCents: 0,
    mileageApproverId: null, mileageApproverName: '', mileageApprovalDate: '', feeCents: 3800,
    ...over,
  };
}

const NO_HISTORY: BilledIdentifiers = { vins: {}, inspections: {} };

function draft(lines: LineItem[]): DraftInvoice {
  return {
    seq: null, year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19', lines,
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

  test('includes stable mileage approval labels for compatibility callers', () => {
    expect(missingFinalizeFields(line({
      mileageCents: 1800,
      mileageApproverId: null,
      mileageApproverName: '',
      mileageApprovalDate: '2026-02-30',
    }))).toEqual(['mileage approver', 'mileage approval date']);
  });
});

describe('invoiceFinalizeBlockers', () => {
  test.each(['', '2026-02-30', 'not-a-date'])(
    'requires a canonical invoice issue date before finalization: %s',
    (issueDate) => {
      const invalidDraft = { ...draft([line()]), issueDate };
      expect(invoiceFinalizeBlockers(invalidDraft, NO_HISTORY)).toContainEqual({
        lineIndex: null,
        field: 'issueDate',
        message: 'Choose a valid invoice date.',
      });
    },
  );

  test('requires linked approver and valid date only for non-zero mileage', () => {
    const blockers = invoiceFinalizeBlockers(draft([line({
      mileageCents: 1800,
      mileageApproverId: null,
      mileageApproverName: '',
      mileageApprovalDate: '2026-02-30',
    })]), NO_HISTORY);
    expect(blockers.map((blocker) => blocker.field)).toEqual([
      'mileageApprover', 'mileageApprovalDate',
    ]);
    expect(invoiceFinalizeBlockers(draft([line({ mileageCents: 0 })]), NO_HISTORY)).toEqual([]);
  });

  test('validates non-zero mileage on both current line types', () => {
    const lines = (['completed', 'noshow'] as const).map((type) => line({
      type,
      mileageCents: 1800,
      mileageApproverId: null,
      mileageApproverName: '',
      mileageApprovalDate: '',
    }));
    expect(invoiceFinalizeBlockers(draft(lines), NO_HISTORY).map(({ lineIndex, field }) => ({
      lineIndex, field,
    }))).toEqual([
      { lineIndex: 0, field: 'mileageApprover' },
      { lineIndex: 0, field: 'mileageApprovalDate' },
      { lineIndex: 1, field: 'mileageApprover' },
      { lineIndex: 1, field: 'mileageApprovalDate' },
    ]);
  });

  test('requires at least one invoice row', () => {
    expect(invoiceFinalizeBlockers(draft([]), NO_HISTORY)).toEqual([
      { lineIndex: null, field: 'invoice', message: 'Add at least one invoice row.' },
    ]);
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
  test('ignores no-show rows, which may repeat any identifier', () => {
    expect(findDuplicates([
      line({ inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ type: 'noshow', inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ type: 'noshow', inspectionNumber: '100', vin8: 'AAAA1111' }),
    ])).toEqual({ inspectionNumbers: [], vin8s: [] });
  });
  test('no duplicates returns empty arrays', () => {
    expect(findDuplicates([line({ inspectionNumber: '1', vin8: 'AAAA1111' })]))
      .toEqual({ inspectionNumbers: [], vin8s: [] });
  });
});

describe('completed-only VIN / inspection # uniqueness', () => {
  function identifierBlockers(lines: LineItem[], billed: BilledIdentifiers = NO_HISTORY) {
    return invoiceFinalizeBlockers(draft(lines), billed)
      .filter(({ field }) => field === 'vin8' || field === 'inspectionNumber')
      .map(({ lineIndex, field, message }) => ({ lineIndex, field, message }));
  }

  test('blocks a VIN repeated on completed rows of the same invoice, independently of inspection #', () => {
    expect(identifierBlockers([
      line({ inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ inspectionNumber: '200', vin8: 'AAAA1111' }),
    ])).toEqual([
      { lineIndex: 0, field: 'vin8', message: 'VIN AAAA1111 is on more than one completed row.' },
      { lineIndex: 1, field: 'vin8', message: 'VIN AAAA1111 is on more than one completed row.' },
    ]);
  });

  test('blocks an inspection # repeated on completed rows of the same invoice, independently of VIN', () => {
    expect(identifierBlockers([
      line({ inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ inspectionNumber: '100', vin8: 'BBBB2222' }),
    ])).toEqual([
      { lineIndex: 0, field: 'inspectionNumber', message: 'Inspection #100 is on more than one completed row.' },
      { lineIndex: 1, field: 'inspectionNumber', message: 'Inspection #100 is on more than one completed row.' },
    ]);
  });

  test('blocks completed identifiers already billed on an active invoice from any year', () => {
    expect(identifierBlockers(
      [line({ inspectionNumber: '100', vin8: 'AAAA1111' })],
      { vins: { AAAA1111: '4-2025' }, inspections: { 100: '9-2026' } },
    )).toEqual([
      { lineIndex: 0, field: 'inspectionNumber', message: 'Inspection #100 was already billed on invoice #9-2026.' },
      { lineIndex: 0, field: 'vin8', message: 'VIN AAAA1111 was already billed on invoice #4-2025.' },
    ]);
  });

  test('keeps original full-row indices when no-shows are interleaved with completed rows', () => {
    expect(identifierBlockers([
      line({ type: 'noshow', inspectionNumber: '1', vin8: 'SHARED01' }),
      line({ inspectionNumber: '2', vin8: 'SHARED01' }),
      line({ type: 'noshow', inspectionNumber: '3', vin8: 'SHARED01' }),
      line({ inspectionNumber: '4', vin8: 'SHARED01' }),
    ]).map(({ lineIndex, field }) => ({ lineIndex, field }))).toEqual([
      { lineIndex: 1, field: 'vin8' },
      { lineIndex: 3, field: 'vin8' },
    ]);
  });

  test('never reserves or blocks no-show identifiers', () => {
    const billed = { vins: { SHARED01: '1-2026' }, inspections: { 555: '1-2026' } };
    // Repeated no-shows, a no-show sharing a completed row's identifiers, and no-shows
    // whose identifiers are already billed are all allowed: a no-show gets rescheduled.
    expect(identifierBlockers([
      line({ type: 'noshow', inspectionNumber: '555', vin8: 'SHARED01' }),
      line({ type: 'noshow', inspectionNumber: '555', vin8: 'SHARED01' }),
      line({ type: 'noshow', inspectionNumber: '777', vin8: 'OTHER777' }),
      line({ inspectionNumber: '777', vin8: 'OTHER777' }),
    ], billed)).toEqual([]);
  });

  test('blocks only the completed rows when no-shows share a duplicated completed identifier', () => {
    expect(identifierBlockers([
      line({ inspectionNumber: '1', vin8: 'DUPVIN01' }),
      line({ type: 'noshow', inspectionNumber: '2', vin8: 'DUPVIN01' }),
      line({ inspectionNumber: '3', vin8: 'DUPVIN01' }),
    ]).map(({ lineIndex }) => lineIndex)).toEqual([0, 2]);
  });

  test('keeps required-field blockers and orders them before identifier blockers on the same row', () => {
    const blockers = invoiceFinalizeBlockers(draft([
      line({ clientName: '', inspectionNumber: '100', vin8: 'AAAA1111' }),
      line({ inspectionNumber: '200', vin8: 'AAAA1111' }),
    ]), NO_HISTORY);
    expect(blockers.map(({ lineIndex, field }) => ({ lineIndex, field }))).toEqual([
      { lineIndex: 0, field: 'client' },
      { lineIndex: 0, field: 'vin8' },
      { lineIndex: 1, field: 'vin8' },
    ]);
  });

  test('does not treat inherited object keys as billed identifiers', () => {
    expect(identifierBlockers([
      line({ inspectionNumber: 'constructor', vin8: '__proto__' }),
      line({ inspectionNumber: 'toString', vin8: 'hasOwnProperty' }),
    ])).toEqual([]);
  });

  test('matches prototype-named identifiers that really were billed', () => {
    const billed: BilledIdentifiers = { vins: Object.create(null), inspections: Object.create(null) };
    billed.vins['__proto__'] = '2-2026';
    billed.inspections['constructor'] = '3-2026';
    expect(identifierBlockers([line({ inspectionNumber: 'constructor', vin8: '__proto__' })], billed))
      .toEqual([
        { lineIndex: 0, field: 'inspectionNumber', message: 'Inspection #constructor was already billed on invoice #3-2026.' },
        { lineIndex: 0, field: 'vin8', message: 'VIN __proto__ was already billed on invoice #2-2026.' },
      ]);
  });

  test('uses exact stored strings, leaving inspection # case, zeros and spacing as entered', () => {
    expect(identifierBlockers([
      line({ inspectionNumber: 'a-100', vin8: 'AAAA1111' }),
      line({ inspectionNumber: 'A-100', vin8: 'AAAA2222' }),
      line({ inspectionNumber: '0100', vin8: 'AAAA3333' }),
      line({ inspectionNumber: '100', vin8: 'AAAA4444' }),
      line({ inspectionNumber: '100 ', vin8: 'AAAA5555' }),
    ])).toEqual([]);
  });
});

describe('invoiceRowWarnings', () => {
  const context = {
    dupInspections: new Set(['100']),
    dupVins: new Set(['AAAA1111']),
    billed: { vins: { AAAA1111: '4-2025' }, inspections: { 100: '9-2026' } },
    periodStart: '2026-07-13',
    periodEnd: '2026-07-19',
  };

  test('explains completed-row identifier conflicts', () => {
    expect(invoiceRowWarnings(line({ inspectionNumber: '100', vin8: 'AAAA1111', date: '2026-07-14' }), context))
      .toEqual([
        'Inspection #100 is on more than one completed row',
        'VIN AAAA1111 is on more than one completed row',
        'Inspection #100 was already billed on invoice #9-2026',
        'VIN AAAA1111 was already billed on invoice #4-2025',
      ]);
  });

  test('gives no-show rows no identifier warnings but keeps VIN-format and period notes', () => {
    expect(invoiceRowWarnings(line({
      type: 'noshow', inspectionNumber: '100', vin8: 'AAAA1111', date: '2026-07-14',
    }), context)).toEqual([]);
    expect(invoiceRowWarnings(line({
      type: 'noshow', inspectionNumber: '100', vin8: 'SHORT1', date: '2026-07-30',
    }), context)).toEqual([
      'VIN should be 8 characters — has 6',
      'Date is outside the billing period',
    ]);
  });

  test('does not warn for inherited object keys', () => {
    for (const inspectionNumber of ['constructor', 'toString', '__proto__']) {
      expect(invoiceRowWarnings(line({
        inspectionNumber, vin8: 'VALIDVN1', date: '2026-07-14',
      }), { ...context, billed: NO_HISTORY })).toEqual([]);
    }
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
