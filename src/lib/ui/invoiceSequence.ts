import { checkOverride } from '../numbering';

export type InvoiceSequenceStatus = 'checking' | 'invalid' | 'ready';

export interface InvoiceSequenceState {
  parsedSeq: number | null;
  draftSeq: number | null;
  status: InvoiceSequenceStatus;
  message: string;
  helperMessage: string;
}

export function draftSeqForPersistence(state: InvoiceSequenceState): number | null {
  if (state.status === 'ready') return state.draftSeq;
  if (state.status === 'checking') return state.parsedSeq;
  return null;
}

export function canPersistInvoiceSequence(state: InvoiceSequenceState): boolean {
  return draftSeqForPersistence(state) !== null;
}

export function shouldFillDefaultInvoiceSequence(invoiceSeqText: string): boolean {
  return !invoiceSeqText.trim();
}

interface ResolveInvoiceSequenceArgs {
  invoiceSeqText: string;
  invoiceYear: number;
  takenSequences: number[];
  takenSequencesYear: number | null;
}

interface ParsedInvoiceSequenceText {
  seq: number | null;
  message: string;
}

function parseInvoiceSequenceText(invoiceSeqText: string, invoiceYear: number): ParsedInvoiceSequenceText {
  const trimmed = invoiceSeqText.trim();
  if (!trimmed) return { seq: null, message: '' };
  const fullInvoiceNumber = trimmed.match(/^(\d+)\s*-\s*(\d{4})$/);
  if (fullInvoiceNumber && Number(fullInvoiceNumber[2]) !== invoiceYear) {
    return { seq: null, message: 'Invoice number year must match the invoice date year.' };
  }
  const value = Number(fullInvoiceNumber?.[1] ?? trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return { seq: null, message: '' };
  }
  return { seq: value, message: '' };
}

export function resolveInvoiceSequenceState({
  invoiceSeqText,
  invoiceYear,
  takenSequences,
  takenSequencesYear,
}: ResolveInvoiceSequenceArgs): InvoiceSequenceState {
  const parsed = parseInvoiceSequenceText(invoiceSeqText, invoiceYear);
  const parsedSeq = parsed.seq;

  if (parsed.message) {
    return {
      parsedSeq: null,
      draftSeq: null,
      status: 'invalid',
      message: parsed.message,
      helperMessage: '',
    };
  }

  if (takenSequencesYear !== invoiceYear) {
    return {
      parsedSeq,
      draftSeq: null,
      status: 'checking',
      message: 'Checking invoice number...',
      helperMessage: '',
    };
  }

  if (parsedSeq === null) {
    return {
      parsedSeq: null,
      draftSeq: null,
      status: 'invalid',
      message: 'Invoice number must be a positive integer.',
      helperMessage: '',
    };
  }

  const result = checkOverride(parsedSeq, takenSequences);
  if (!result.ok) {
    return {
      parsedSeq,
      draftSeq: null,
      status: 'invalid',
      message: result.message ?? 'Invoice number must be a positive integer.',
      helperMessage: '',
    };
  }

  return {
    parsedSeq,
    draftSeq: parsedSeq,
    status: 'ready',
    message: '',
    helperMessage: result.message ?? '',
  };
}
