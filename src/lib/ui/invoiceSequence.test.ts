import { describe, expect, test } from 'vitest';
import { canPersistInvoiceSequence, resolveInvoiceSequenceState } from './invoiceSequence';

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

  test('returns false while sequence validation is still checking', () => {
    const state = resolveInvoiceSequenceState({
      invoiceSeqText: '8',
      invoiceYear: 2027,
      takenSequences: [8],
      takenSequencesYear: 2026,
    });

    expect(canPersistInvoiceSequence(state)).toBe(false);
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
