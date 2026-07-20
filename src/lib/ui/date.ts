/** A Date as a local YYYY-MM-DD string (matches what the date picker stores). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse a valid local YYYY-MM-DD value without UTC date shifting. */
export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toIsoDate(date) === iso ? date : null;
}

/** Initial calendar focus follows the selected date, then today's local date. */
export function initialCalendarDate(value: string, today: Date = new Date()): Date {
  const selected = parseIsoDate(value);
  const initial = selected ?? today;
  return new Date(initial.getFullYear(), initial.getMonth(), initial.getDate());
}

export function calendarDateLabel(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function moveCalendarDateByKey(date: Date, key: string): Date | null {
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const offset = offsets[key];
  if (offset === undefined) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

export function moveCalendarMonth(date: Date, delta: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
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
