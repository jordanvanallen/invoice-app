import type { DraftInvoice, FinalizedSnapshot, Settings } from './types';
import { computeTotals } from './totals';
import { formatInvoiceNumber } from './numbering';

/**
 * Build the immutable snapshot stored on finalize. Deep-copies line items so the
 * snapshot never shares references with live draft state. `seq` is the sequence
 * allocated atomically by the DB layer (Plan 2).
 */
export function buildFinalizedSnapshot(
  draft: DraftInvoice,
  settings: Settings,
  seq: number,
): FinalizedSnapshot {
  const lines = draft.lines.map((l) => ({ ...l }));
  const totals = computeTotals(lines, settings.taxRateBp);

  return {
    invoiceNumber: formatInvoiceNumber(seq, draft.year),
    seq,
    year: draft.year,
    issueDate: draft.issueDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    inspectorName: settings.inspectorName,
    inspectorAddress: settings.inspectorAddress,
    inspectorNumber: settings.inspectorNumber,
    gstHstRegistrationNumber: settings.gstHstRegistrationNumber,
    billToName: settings.billToName,
    billToAddress: settings.billToAddress,
    registered: settings.registered,
    taxRateBp: settings.taxRateBp,
    paymentEmail: settings.paymentEmail,
    footerNotes: settings.footerNotes,
    logoDataUrl: settings.logoDataUrl,
    lines,
    totals,
  };
}
