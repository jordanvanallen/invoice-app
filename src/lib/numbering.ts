export function formatInvoiceNumber(seq: number, year: number): string {
  return `${seq}-${year}`;
}

export interface OverrideResult {
  ok: boolean;
  message?: string;
}

/** Validate a manually-entered sequence against the sequences already used this year. */
export function checkOverride(seq: number, takenSeqs: number[]): OverrideResult {
  if (!Number.isInteger(seq) || seq <= 0) {
    return { ok: false, message: 'Invoice number must be a positive integer.' };
  }
  if (takenSeqs.includes(seq)) {
    return { ok: false, message: `Invoice number ${seq} is already used this year.` };
  }
  const max = takenSeqs.length ? Math.max(...takenSeqs) : 0;
  if (seq > max + 1) {
    return { ok: true, message: `This skips numbers ${max + 1}–${seq - 1}, leaving a gap.` };
  }
  return { ok: true };
}
