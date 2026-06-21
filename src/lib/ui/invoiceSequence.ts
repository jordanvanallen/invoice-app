import { checkOverride } from '../numbering';

export type InvoiceSequenceStatus = 'checking' | 'invalid' | 'ready';

export interface InvoiceSequenceState {
  parsedSeq: number | null;
  draftSeq: number | null;
  status: InvoiceSequenceStatus;
  message: string;
  helperMessage: string;
}

interface ResolveInvoiceSequenceArgs {
  invoiceSeqText: string;
  invoiceYear: number;
  takenSequences: number[];
  takenSequencesYear: number | null;
}

function parseInvoiceSequenceText(invoiceSeqText: string): number | null {
  const trimmed = invoiceSeqText.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function resolveInvoiceSequenceState({
  invoiceSeqText,
  invoiceYear,
  takenSequences,
  takenSequencesYear,
}: ResolveInvoiceSequenceArgs): InvoiceSequenceState {
  const parsedSeq = parseInvoiceSequenceText(invoiceSeqText);

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
