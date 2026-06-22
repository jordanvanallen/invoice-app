import { describe, expect, test } from 'vitest';
import {
  canPersistInvoiceSequence,
  draftSeqForPersistence,
  resolveInvoiceSequenceState,
  shouldFillDefaultInvoiceSequence,
} from './invoiceSequence';

describe('resolveInvoiceSequenceState', () => {
  test('blocks on stale taken sequences until the current year finishes loading', () => {
    expect(resolveInvoiceSequenceState({
      invoiceSeqText: '8',
      invoiceYear: 2027,
      takenSequences: [8],
      takenSequencesYear: 2026,
    })).toEqual({
      draftSeq: null,
      helperMessage: '',
      message: 'Checking invoice number...',
      parsedSeq: 8,
      status: 'checking',
    });
  });

  test('keeps invalid text out of the draft sequence', () => {
    expect(resolveInvoiceSequenceState({
      invoiceSeqText: '11.5',
      invoiceYear: 2026,
      takenSequences: [1, 2, 3, 8],
      takenSequencesYear: 2026,
    })).toEqual({
      draftSeq: null,
      helperMessage: '',
      message: 'Invoice number must be a positive integer.',
      parsedSeq: null,
      status: 'invalid',
    });
  });

  test('persists a valid current-year sequence', () => {
    expect(resolveInvoiceSequenceState({
      invoiceSeqText: '9',
      invoiceYear: 2026,
      takenSequences: [1, 2, 3, 8],
      takenSequencesYear: 2026,
    })).toEqual({
      draftSeq: 9,
      helperMessage: '',
      message: '',
      parsedSeq: 9,
      status: 'ready',
    });
  });

  test('accepts a full invoice number when the year matches the invoice date', () => {
    expect(resolveInvoiceSequenceState({
      invoiceSeqText: '11-2026',
      invoiceYear: 2026,
      takenSequences: [1, 2, 3, 8],
      takenSequencesYear: 2026,
    })).toEqual({
      draftSeq: 11,
      helperMessage: 'This skips numbers 9–10, leaving a gap.',
      message: '',
      parsedSeq: 11,
      status: 'ready',
    });
  });

  test('rejects a full invoice number when the year does not match the invoice date', () => {
    expect(resolveInvoiceSequenceState({
      invoiceSeqText: '11-2025',
      invoiceYear: 2026,
      takenSequences: [],
      takenSequencesYear: 2026,
    })).toEqual({
      draftSeq: null,
      helperMessage: '',
      message: 'Invoice number year must match the invoice date year.',
      parsedSeq: null,
      status: 'invalid',
    });
  });
});

describe('canPersistInvoiceSequence', () => {
  test('returns true for a ready sequence state', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '9',
      invoiceYear: 2026,
      takenSequences: [1, 2, 3, 8],
      takenSequencesYear: 2026,
    });

    expect(canPersistInvoiceSequence(state)).toBe(true);
  });

  test('returns true for parsed text while sequence validation is still checking', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '8',
      invoiceYear: 2027,
      takenSequences: [8],
      takenSequencesYear: 2026,
    });

    expect(canPersistInvoiceSequence(state)).toBe(true);
  });

  test('returns false for invalid invoice-number text', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '11.5',
      invoiceYear: 2026,
      takenSequences: [1, 2, 3, 8],
      takenSequencesYear: 2026,
    });

    expect(canPersistInvoiceSequence(state)).toBe(false);
  });
});

describe('draftSeqForPersistence', () => {
  test('uses a parsed positive sequence while duplicate validation is still loading', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '11',
      invoiceYear: 2026,
      takenSequences: [],
      takenSequencesYear: null,
    });

    expect(draftSeqForPersistence(state)).toBe(11);
    expect(canPersistInvoiceSequence(state)).toBe(true);
  });

  test('keeps invalid text out of persistence even if parsing found no duplicate yet', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '11.5',
      invoiceYear: 2026,
      takenSequences: [],
      takenSequencesYear: null,
    });

    expect(draftSeqForPersistence(state)).toBeNull();
    expect(canPersistInvoiceSequence(state)).toBe(false);
  });
});

describe('shouldFillDefaultInvoiceSequence', () => {
  test('fills the default only when the sequence input is blank', () => {
    expect(shouldFillDefaultInvoiceSequence('')).toBe(true);
    expect(shouldFillDefaultInvoiceSequence('   ')).toBe(true);
    expect(shouldFillDefaultInvoiceSequence('11')).toBe(false);
  });
});
