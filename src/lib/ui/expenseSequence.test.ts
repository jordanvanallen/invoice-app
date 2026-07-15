import { describe, expect, test } from 'vitest';
import {
  expenseSeqForPersistence,
  resolveExpenseSequenceState,
  shouldFillDefaultExpenseSequence,
} from './expenseSequence';

describe('expense report sequence state', () => {
  test('parses a positive sequence and a matching full report number', () => {
    expect(resolveExpenseSequenceState({
      sequenceText: '12-2026', reportYear: 2026,
      takenSequences: [1, 2], takenSequencesYear: 2026,
    })).toMatchObject({ status: 'ready', draftSeq: 12, parsedSeq: 12 });
  });

  test('rejects invalid, mismatched-year, and already-used numbers', () => {
    expect(resolveExpenseSequenceState({
      sequenceText: '1.5', reportYear: 2026,
      takenSequences: [], takenSequencesYear: 2026,
    }).message).toMatch(/positive integer/i);
    expect(resolveExpenseSequenceState({
      sequenceText: '3-2025', reportYear: 2026,
      takenSequences: [], takenSequencesYear: 2026,
    }).message).toMatch(/match the report date year/i);
    expect(resolveExpenseSequenceState({
      sequenceText: '2', reportYear: 2026,
      takenSequences: [2], takenSequencesYear: 2026,
    }).message).toMatch(/already used/i);
  });

  test('retains a deliberate number when the report year changes', () => {
    expect(shouldFillDefaultExpenseSequence('12')).toBe(false);
    const checking = resolveExpenseSequenceState({
      sequenceText: '12', reportYear: 2027,
      takenSequences: [], takenSequencesYear: 2026,
    });
    expect(checking.status).toBe('checking');
    expect(expenseSeqForPersistence(checking)).toBe(12);
  });
});
