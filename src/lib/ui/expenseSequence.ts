export type ExpenseSequenceStatus = 'checking' | 'invalid' | 'ready';

export interface ExpenseSequenceState {
  parsedSeq: number | null;
  draftSeq: number | null;
  status: ExpenseSequenceStatus;
  message: string;
  helperMessage: string;
}

interface ResolveExpenseSequenceArgs {
  sequenceText: string;
  reportYear: number;
  takenSequences: number[];
  takenSequencesYear: number | null;
}

function parseSequence(sequenceText: string, reportYear: number) {
  const trimmed = sequenceText.trim();
  if (!trimmed) return { seq: null, message: '' };
  const fullNumber = trimmed.match(/^(\d+)\s*-\s*(\d{4})$/);
  if (fullNumber && Number(fullNumber[2]) !== reportYear) {
    return { seq: null, message: 'Expense report number year must match the report date year.' };
  }
  const value = Number(fullNumber?.[1] ?? trimmed);
  if (!Number.isInteger(value) || value <= 0) return { seq: null, message: '' };
  return { seq: value, message: '' };
}

export function resolveExpenseSequenceState({
  sequenceText,
  reportYear,
  takenSequences,
  takenSequencesYear,
}: ResolveExpenseSequenceArgs): ExpenseSequenceState {
  const parsed = parseSequence(sequenceText, reportYear);
  if (parsed.message) {
    return { parsedSeq: null, draftSeq: null, status: 'invalid', message: parsed.message, helperMessage: '' };
  }
  if (takenSequencesYear !== reportYear) {
    return {
      parsedSeq: parsed.seq, draftSeq: null, status: 'checking',
      message: 'Checking expense report number...', helperMessage: '',
    };
  }
  if (parsed.seq === null) {
    return {
      parsedSeq: null, draftSeq: null, status: 'invalid',
      message: 'Expense report number must be a positive integer.', helperMessage: '',
    };
  }
  if (takenSequences.includes(parsed.seq)) {
    return {
      parsedSeq: parsed.seq, draftSeq: null, status: 'invalid',
      message: `Expense report number ${parsed.seq} is already used this year.`, helperMessage: '',
    };
  }
  const max = takenSequences.length ? Math.max(...takenSequences) : 0;
  return {
    parsedSeq: parsed.seq,
    draftSeq: parsed.seq,
    status: 'ready',
    message: '',
    helperMessage: parsed.seq > max + 1
      ? `This skips numbers ${max + 1}-${parsed.seq - 1}, leaving a gap.`
      : '',
  };
}

export function expenseSeqForPersistence(state: ExpenseSequenceState): number | null {
  if (state.status === 'ready') return state.draftSeq;
  if (state.status === 'checking') return state.parsedSeq;
  return null;
}

export function shouldFillDefaultExpenseSequence(sequenceText: string): boolean {
  return !sequenceText.trim();
}
