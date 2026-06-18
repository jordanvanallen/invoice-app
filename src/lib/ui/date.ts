/** A Date as a local YYYY-MM-DD string (matches what the date picker stores). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Header defaults for a brand-new or duplicated invoice: today, with a 7-day
 *  billing period ending today. */
export function defaultInvoicePeriod(): { year: number; issueDate: string; periodStart: string; periodEnd: string } {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  return {
    year: today.getFullYear(),
    issueDate: toIsoDate(today),
    periodStart: toIsoDate(start),
    periodEnd: toIsoDate(today),
  };
}
