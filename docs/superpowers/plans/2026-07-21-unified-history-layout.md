# Unified History and Responsive Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen invoice preview/detail responsively and give Invoice History and Expense History one All-time-first range, search, cancelled-record, row-alignment, and summary-PDF experience.

**Architecture:** Route-owned state feeds a controlled range toolbar and pure History helpers. Each domain loads finalized and void rows with fixed-count repository queries, then derives range groups and rollups in memory; repository search remains asynchronous and returns both visible statuses. Invoice and expense summaries use a frozen closed-range snapshot at export time, while one shared stylesheet aligns the two routes without hiding their domain-specific actions.

**Tech Stack:** SvelteKit 2 with Svelte 5 runes, TypeScript, SQLite through the repository `Db` interface, sql.js repository tests, pdfmake, Vitest, Tauri 2/Rust.

## Global Constraints

- Default both pages to **All time**; valid effective ranges are only `null` or an inclusive `{ start, end }` pair.
- An incomplete or reversed range displays an alert, disables toolbar export, and leaves All-time rows visible under the current text query.
- Text search filters discovery but never changes range rollups or PDF contents.
- Cancelled records remain in a distinct section, follow range/search filters, and never enter totals or PDFs; drafts never appear.
- Toolbar exports use a frozen active range; year-section exports always use the full calendar year.
- Invoice width is `min(100%, 1040px)` with a compact container fallback at `860px`.
- History amount tracks reserve `11ch`, align right, and do not wrap, supporting `$10.00` through `$99,999.99`.
- Retain the approximately `820px` History row-action wrapping threshold.
- Keep all money as integer cents and all dates as canonical `YYYY-MM-DD` strings without timezone conversion.
- Preserve existing per-year invoice filenames/subfolders and individual invoice/expense-report PDF behavior.
- Do not add pagination, a generic History framework, a browser component-test stack, or a database migration.

---

### Task 1: Pure History Range, Grouping, and Request-State Contracts

**Files:**
- Create: `src/lib/history/history.ts`
- Create: `src/lib/history/history.test.ts`

**Interfaces:**
- Produces: `ClosedDateRange`, `HistoryRangeResolution`, `resolveHistoryRange(start, end)`, `calendarYearRange(year)`, `historyPresets(now)`, `historyRangeLabel(range, calendarYear?)`, `matchesHistoryRange(date, range)`, `filterHistoryRows(rows, dateOf, range)`, `groupHistoryRows(rows, dateOf)`, `sumInvoiceHistory(rows)`, `sumExpenseHistory(rows)`, `partitionHistoryRows(rows)`, and `createLatestRequestGate()`.
- Consumes: `isValidIsoDate` from `$lib/validation` and `toIsoDate` from `$lib/ui/date`.

- [ ] **Step 1: Write failing pure-helper tests**

```ts
import { describe, expect, test } from 'vitest';
import {
  calendarYearRange, createLatestRequestGate, filterHistoryRows, groupHistoryRows,
  historyPresets, historyRangeLabel, partitionHistoryRows, resolveHistoryRange,
  sumExpenseHistory, sumInvoiceHistory,
} from './history';

describe('history ranges', () => {
  test('resolves blank dates to All time and valid bounds inclusively', () => {
    expect(resolveHistoryRange('', '')).toEqual({ kind: 'all', range: null, error: '' });
    expect(resolveHistoryRange('2026-07-01', '2026-07-31')).toEqual({
      kind: 'range', range: { start: '2026-07-01', end: '2026-07-31' }, error: '',
    });
    const rows = [{ date: '2026-06-30' }, { date: '2026-07-01' }, { date: '2026-07-31' }, { date: '2026-08-01' }];
    expect(filterHistoryRows(rows, (row) => row.date, { start: '2026-07-01', end: '2026-07-31' }))
      .toEqual(rows.slice(1, 3));
  });

  test('uses All time as the effective range for incomplete or reversed input', () => {
    expect(resolveHistoryRange('2026-07-01', '')).toMatchObject({ kind: 'invalid', range: null });
    expect(resolveHistoryRange('', '2026-07-31')).toMatchObject({ kind: 'invalid', range: null });
    expect(resolveHistoryRange('2026-08-01', '2026-07-31')).toMatchObject({ kind: 'invalid', range: null });
  });

  test('formats stable labels and calendar presets without UTC conversion', () => {
    expect(historyRangeLabel(null)).toBe('All time');
    expect(historyRangeLabel(calendarYearRange(2026), 2026)).toBe('Calendar year 2026');
    expect(historyRangeLabel({ start: '2026-07-01', end: '2026-07-31' }))
      .toBe('July 1, 2026 – July 31, 2026');
    expect(historyPresets(new Date(2026, 6, 21)).thisQuarter)
      .toEqual({ start: '2026-07-01', end: '2026-07-21' });
  });
});

describe('history derivation', () => {
  test('groups without mutating and calculates cents-only rollups', () => {
    const invoices = [
      { issueDate: '2026-02-01', totalCents: 11_300, taxCents: 1_300 },
      { issueDate: '2025-12-31', totalCents: 5_650, taxCents: 650 },
    ];
    expect(groupHistoryRows(invoices, (row) => row.issueDate).map((group) => group.year)).toEqual([2026, 2025]);
    expect(sumInvoiceHistory(invoices)).toEqual({ count: 2, totalBilledCents: 16_950, totalTaxCents: 1_950 });
    expect(sumExpenseHistory([{ totalCents: 10_000 }, { totalCents: 25_000 }]))
      .toEqual({ count: 2, totalCents: 35_000 });
    expect(invoices.map((row) => row.issueDate)).toEqual(['2026-02-01', '2025-12-31']);
  });

  test('splits finalized and void rows while excluding drafts', () => {
    expect(partitionHistoryRows([
      { id: 1, status: 'finalized' as const },
      { id: 2, status: 'void' as const },
      { id: 3, status: 'draft' as const },
    ])).toEqual({ finalized: [{ id: 1, status: 'finalized' }], void: [{ id: 2, status: 'void' }] });
  });

  test('allows only the latest asynchronous request to publish', () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npm test -- --run src/lib/history/history.test.ts`

Expected: FAIL because `./history` does not exist.

- [ ] **Step 3: Implement the minimal pure helper module**

```ts
import { toIsoDate } from '../ui/date';
import { isValidIsoDate } from '../validation';

export interface ClosedDateRange { readonly start: string; readonly end: string }
export type HistoryRangeResolution =
  | { kind: 'all'; range: null; error: '' }
  | { kind: 'range'; range: ClosedDateRange; error: '' }
  | { kind: 'invalid'; range: null; error: string };

export function resolveHistoryRange(start: string, end: string): HistoryRangeResolution {
  if (!start && !end) return { kind: 'all', range: null, error: '' };
  if (!start || !end) return { kind: 'invalid', range: null, error: 'Choose both a start and end date.' };
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return { kind: 'invalid', range: null, error: 'Choose valid dates.' };
  if (start > end) return { kind: 'invalid', range: null, error: 'Start date must be on or before end date.' };
  return { kind: 'range', range: Object.freeze({ start, end }), error: '' };
}

export const calendarYearRange = (year: number): ClosedDateRange =>
  Object.freeze({ start: `${year}-01-01`, end: `${year}-12-31` });

export function historyPresets(now: Date) {
  const year = now.getFullYear();
  return {
    thisYear: Object.freeze({ start: `${year}-01-01`, end: toIsoDate(now) }),
    lastYear: calendarYearRange(year - 1),
    thisQuarter: Object.freeze({
      start: toIsoDate(new Date(year, Math.floor(now.getMonth() / 3) * 3, 1)),
      end: toIsoDate(now),
    }),
  };
}

export function matchesHistoryRange(date: string, range: ClosedDateRange | null): boolean {
  return range === null || (date >= range.start && date <= range.end);
}

export function filterHistoryRows<T>(
  rows: readonly T[], dateOf: (row: T) => string, range: ClosedDateRange | null,
): T[] {
  return rows.filter((row) => matchesHistoryRange(dateOf(row), range));
}

export function groupHistoryRows<T>(rows: readonly T[], dateOf: (row: T) => string) {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const year = Number(dateOf(row).slice(0, 4));
    groups.set(year, [...(groups.get(year) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, groupedRows]) => ({ year, rows: groupedRows }));
}

export function sumInvoiceHistory(rows: readonly { totalCents: number; taxCents: number }[]) {
  return rows.reduce((rollup, row) => ({
    count: rollup.count + 1,
    totalBilledCents: rollup.totalBilledCents + row.totalCents,
    totalTaxCents: rollup.totalTaxCents + row.taxCents,
  }), { count: 0, totalBilledCents: 0, totalTaxCents: 0 });
}

export function sumExpenseHistory(rows: readonly { totalCents: number }[]) {
  return rows.reduce((rollup, row) => ({
    count: rollup.count + 1,
    totalCents: rollup.totalCents + row.totalCents,
  }), { count: 0, totalCents: 0 });
}

export function partitionHistoryRows<T extends { status: string }>(rows: readonly T[]) {
  return {
    finalized: rows.filter((row) => row.status === 'finalized'),
    void: rows.filter((row) => row.status === 'void'),
  };
}

function displayIsoDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function historyRangeLabel(range: ClosedDateRange | null, calendarYear?: number): string {
  if (range === null) return 'All time';
  if (calendarYear !== undefined
    && range.start === `${calendarYear}-01-01`
    && range.end === `${calendarYear}-12-31`) return `Calendar year ${calendarYear}`;
  return `${displayIsoDate(range.start)} – ${displayIsoDate(range.end)}`;
}

export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (requestId: number) => requestId === latest,
  };
}
```

- [ ] **Step 4: Run helper tests and verify GREEN**

Run: `npm test -- --run src/lib/history/history.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/history/history.ts src/lib/history/history.test.ts
git commit -m "Add shared history range helpers"
```

---

### Task 2: Fixed-Query Invoice History Repository

**Files:**
- Modify: `src/lib/db/invoice-repo.ts:318-515`
- Modify: `src/lib/db/invoice-repo.test.ts`

**Interfaces:**
- Consumes: `ClosedDateRange` from `src/lib/history/history.ts`.
- Produces: `InvoiceListItem` with `status: 'finalized' | 'void'` and `taxCents`; `listFinalizedInvoices(db)`; updated `listVoided(db)`; `searchInvoices(db, query)` returning both statuses; `rangeRollup(db, range)` and `rangeClientBreakdown(db, range)` accepting `ClosedDateRange | null`.

- [ ] **Step 1: Add failing repository tests**

Add sql.js tests that finalize invoices in 2025/2026, void one, leave one draft, and assert:

```ts
expect(await listFinalizedInvoices(db)).toEqual([
  expect.objectContaining({ status: 'finalized', taxCents: expect.any(Number) }),
]);
expect((await listVoided(db))[0]).toMatchObject({ status: 'void', taxCents: expect.any(Number) });
expect((await searchInvoices(db, 'cancelled-client')).map((row) => row.status)).toEqual(['void']);
expect(await rangeRollup(db, null)).toEqual(await yearRollup(db, 2026));
expect(await rangeClientBreakdown(db, null)).toEqual(expect.arrayContaining([
  expect.objectContaining({ clientName: 'A Co' }),
]));
```

Also assert drafts do not appear, inclusive boundaries still work, and equal client subtotals sort by `clientName ASC`.

- [ ] **Step 2: Run focused invoice repository tests and verify RED**

Run: `npm test -- --run src/lib/db/invoice-repo.test.ts`

Expected: FAIL because `listFinalizedInvoices` and the nullable range/status/tax contracts are absent.

- [ ] **Step 3: Implement one mapper and fixed queries**

```ts
export interface InvoiceListItem {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  totalCents: number;
  taxCents: number;
  status: 'finalized' | 'void';
}

interface InvoiceListRow {
  id: number; year: number; seq: number; issue_date: string;
  total_cents: number; tax_cents: number; status: 'finalized' | 'void';
}

function toInvoiceListItem(row: InvoiceListRow): InvoiceListItem {
  return {
    id: row.id, invoiceNumber: `${row.seq}-${row.year}`, issueDate: row.issue_date,
    totalCents: row.total_cents, taxCents: row.tax_cents, status: row.status,
  };
}

export async function listFinalizedInvoices(db: Db): Promise<InvoiceListItem[]> {
  return (await db.select<InvoiceListRow>(
    `SELECT id, year, seq, issue_date, total_cents, tax_cents, status
       FROM invoices WHERE status = 'finalized'
      ORDER BY issue_date DESC, year DESC, seq ASC`,
  )).map(toInvoiceListItem);
}
```

Update every retained list/search constructor to use the mapper. Search with `i.status IN ('finalized', 'void')`. For summary functions, build separate static SQL strings for `null` and bounded range so All time omits date predicates while every value remains parameterized. Keep the existing year wrappers for compatibility, but make `listYears` finalized-only.

- [ ] **Step 4: Run invoice repository tests and verify GREEN**

Run: `npm test -- --run src/lib/db/invoice-repo.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/lib/db/invoice-repo.ts src/lib/db/invoice-repo.test.ts
git commit -m "Add fixed-query invoice history reads"
```

---

### Task 3: Fixed-Query Expense History and Range Export Data

**Files:**
- Modify: `src/lib/expense/types.ts:37-48`
- Modify: `src/lib/db/expense-repo.ts:229-306`
- Modify: `src/lib/db/expense-repo.test.ts`

**Interfaces:**
- Consumes: `ClosedDateRange`.
- Produces: `listFinalizedExpenses(db)`; updated `searchExpenses` with finalized/void; `ExpenseSummaryReport`, `ExpenseSummaryItemRow`, `ExpenseSummaryData`; `expenseSummaryForRange(db, range)`.

- [ ] **Step 1: Add failing sql.js tests for expense history/export semantics**

Create reports where a July report contains a June-dated and an August-dated item, plus a void report and draft. Assert:

```ts
expect((await listFinalizedExpenses(db)).every((row) => row.status === 'finalized')).toBe(true);
expect((await searchExpenses(db, 'cancelled parking')).map((row) => row.status)).toEqual(['void']);

const summary = await expenseSummaryForRange(db, { start: '2026-07-01', end: '2026-07-31' });
expect(summary.reports).toHaveLength(1);
expect(summary.items.map((row) => row.itemDate)).toEqual(['2026-06-30', '2026-08-01']);
expect(summary.items.reduce((sum, row) => sum + row.amountCents, 0))
  .toBe(summary.reports.reduce((sum, report) => sum + report.totalCents, 0));
expect((await expenseSummaryForRange(db, null)).reports.every((row) => row.status === 'finalized')).toBe(true);
```

Add tied item dates and assert ordering by item date, report year, report sequence, item position, and item ID.

- [ ] **Step 2: Run expense repository tests and verify RED**

Run: `npm test -- --run src/lib/db/expense-repo.test.ts`

Expected: FAIL because the all-history and summary operations do not exist and search excludes void records.

- [ ] **Step 3: Implement the fixed queries and one-predicate export result**

```ts
export interface ExpenseSummaryReport extends ExpenseListItem { status: 'finalized' }
export interface ExpenseSummaryItemRow {
  reportId: number; reportNumber: string; reportDate: string;
  itemId: number; itemDate: string; position: number;
  description: string; amountCents: Cents;
}
export interface ExpenseSummaryData {
  reports: ExpenseSummaryReport[];
  items: ExpenseSummaryItemRow[];
}
```

`listFinalizedExpenses` selects all finalized headers in one ordered query. `expenseSummaryForRange` uses report-date predicates only, reads finalized headers and their complete joined item sets with the same normalized range, and applies:

```sql
ORDER BY ei.date ASC, er.year ASC, er.seq ASC, ei.position ASC, ei.id ASC
```

Never filter on `expense_items.date`.

- [ ] **Step 4: Run expense repository tests and verify GREEN**

Run: `npm test -- --run src/lib/db/expense-repo.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/expense/types.ts src/lib/db/expense-repo.ts src/lib/db/expense-repo.test.ts
git commit -m "Add fixed-query expense history reads"
```

---

### Task 4: Range-Aware Invoice and Expense Summary PDFs

**Files:**
- Modify: `src/lib/pdf/yearSummaryDoc.ts`
- Create: `src/lib/pdf/yearSummaryDoc.test.ts`
- Create: `src/lib/pdf/expenseSummaryDoc.ts`
- Create: `src/lib/pdf/expenseSummaryDoc.test.ts`
- Modify: `src/lib/pdf/generate.ts`
- Modify: `src/lib/pdf/generate.test.ts`

**Interfaces:**
- Consumes: `ExpenseSummaryData`.
- Produces: invoice `SummaryInput.rangeLabel`; `ExpenseSummaryInput`; `buildExpenseSummaryDoc(input)`; `expenseSummaryPdfBytes(input)`; `saveExpenseSummaryPdf(input, fileName)`.

- [ ] **Step 1: Add failing pure document tests**

Use recursive text collectors and assert the invoice document contains `All time` or `Calendar year 2026`, while the expense document contains the frozen label, distinct report count, grand total, and every item row in supplied order:

```ts
const input = {
  rangeLabel: 'July 1, 2026 – July 31, 2026', preparedOn: '2026-07-21', businessName: 'Jane Tester',
  reports: [{ id: 1, reportNumber: '4-2026', reportDate: '2026-07-15', totalCents: 7500, status: 'finalized' as const }],
  items: [
    { reportId: 1, reportNumber: '4-2026', reportDate: '2026-07-15', itemId: 10,
      itemDate: '2026-06-30', position: 0, description: 'Fuel', amountCents: 7500 },
  ],
};
expect(collectText(buildExpenseSummaryDoc(input))).toEqual(expect.arrayContaining([
  'Expense Summary', input.rangeLabel, '1', '$75.00', 'Fuel', '4-2026',
]));
```

- [ ] **Step 2: Run document tests and verify RED**

Run: `npm test -- --run src/lib/pdf/yearSummaryDoc.test.ts src/lib/pdf/expenseSummaryDoc.test.ts src/lib/pdf/generate.test.ts`

Expected: FAIL because the expense summary and `rangeLabel` contract do not exist.

- [ ] **Step 3: Implement pure documents and generation wrappers**

Change invoice summary input from route-authored title/note to a stable document title plus `rangeLabel`. Add:

```ts
export interface ExpenseSummaryInput extends ExpenseSummaryData {
  rangeLabel: string;
  preparedOn: string;
  businessName: string;
}

export function expenseSummaryPdfBytes(input: ExpenseSummaryInput): Promise<Uint8Array> {
  return docBytes(buildExpenseSummaryDoc(input));
}

export function saveExpenseSummaryPdf(input: ExpenseSummaryInput, fileName: string): Promise<SaveResult> {
  return savePdfDoc(buildExpenseSummaryDoc(input), fileName, 'expense-summaries');
}
```

The expense summary calculates report count and total from `reports`, verifies rows visually through the pure table definition, and prints items in the repository-provided order.

- [ ] **Step 4: Run PDF tests and verify GREEN**

Run: `npm test -- --run src/lib/pdf/yearSummaryDoc.test.ts src/lib/pdf/expenseSummaryDoc.test.ts src/lib/pdf/generate.test.ts`

Expected: PASS and generated byte tests retain the `%PDF` header.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/pdf/yearSummaryDoc.ts src/lib/pdf/yearSummaryDoc.test.ts src/lib/pdf/expenseSummaryDoc.ts src/lib/pdf/expenseSummaryDoc.test.ts src/lib/pdf/generate.ts src/lib/pdf/generate.test.ts
git commit -m "Add range-aware history summary PDFs"
```

---

### Task 5: Controlled Range Toolbar and Shared History Styling

**Files:**
- Create: `src/lib/components/HistoryRangeControls.svelte`
- Create: `src/lib/styles/history.css`
- Create: `src/lib/components/historyPresentationContract.test.ts`

**Interfaces:**
- Consumes: `resolveHistoryRange`, `historyPresets`, `ClosedDateRange`, and existing `DatePicker` invalid/error props.
- Produces: bindable `start`/`end`, `exportLabel`, `busyLabel`, and `onExport` component props; semantic `.history-*` classes used by both routes.

- [ ] **Step 1: Add failing source-contract tests for the shared presentation boundary**

```ts
const controls = readSource('src/lib/components/HistoryRangeControls.svelte');
const styles = readSource('src/lib/styles/history.css');
expect(controls).toContain("start = $bindable('')");
expect(controls).toContain("end = $bindable('')");
expect(controls).toContain('aria-pressed');
expect(controls).toContain('invalid={resolution.kind === \'invalid\'}');
expect(controls).toContain('errorId={errorId}');
expect(styles).toContain('grid-template-columns: auto minmax(8rem, 1fr) 11ch auto');
expect(styles).toContain('white-space: nowrap');
expect(styles).toContain('@container (max-width: 820px)');
```

- [ ] **Step 2: Run the presentation contract and verify RED**

Run: `npm test -- --run src/lib/components/historyPresentationContract.test.ts`

Expected: FAIL because the component and stylesheet do not exist.

- [ ] **Step 3: Build the controlled toolbar and stylesheet**

`HistoryRangeControls` mutates only its bindable props and uses this concrete state boundary; it does not mirror dates in local state:

```svelte
<script lang="ts">
  import DatePicker from './DatePicker.svelte';
  import { historyPresets, resolveHistoryRange, type ClosedDateRange } from '$lib/history/history';

  interface Props {
    start?: string;
    end?: string;
    exportLabel: string;
    busyLabel?: string;
    onExport: () => void;
  }
  let {
    start = $bindable(''), end = $bindable(''), exportLabel,
    busyLabel = '', onExport,
  }: Props = $props();
  const presets = historyPresets(new Date());
  const resolution = $derived(resolveHistoryRange(start, end));
  const errorId = 'history-range-error';
  const selected = (range: ClosedDateRange) => start === range.start && end === range.end;
  function choose(range: ClosedDateRange | null) {
    start = range?.start ?? '';
    end = range?.end ?? '';
  }
</script>

<fieldset class="history-toolbar">
  <legend>Filter and export by date</legend>
  <div class="history-presets">
    <button type="button" aria-pressed={!start && !end} onclick={() => choose(null)}>All time</button>
    <button type="button" aria-pressed={selected(presets.thisYear)} onclick={() => choose(presets.thisYear)}>This year</button>
    <button type="button" aria-pressed={selected(presets.lastYear)} onclick={() => choose(presets.lastYear)}>Last year</button>
    <button type="button" aria-pressed={selected(presets.thisQuarter)} onclick={() => choose(presets.thisQuarter)}>This quarter</button>
  </div>
  <label for="history-range-start">From</label>
  <DatePicker fieldId="history-range-start" ariaLabel="From date" bind:value={start}
    invalid={resolution.kind === 'invalid'} errorId={errorId} />
  <label for="history-range-end">To</label>
  <DatePicker fieldId="history-range-end" ariaLabel="To date" bind:value={end}
    invalid={resolution.kind === 'invalid'} errorId={errorId} />
  <button type="button" class="history-export" disabled={resolution.kind === 'invalid' || !!busyLabel}
    onclick={onExport}>{busyLabel || exportLabel}</button>
  {#if resolution.kind === 'invalid'}<p id={errorId} role="alert">{resolution.error}</p>{/if}
</fieldset>
```

The shared stylesheet defines `.history-head`, `.history-search`, `.history-toolbar`, `.history-year-bar`, `.history-row`, `.history-amount`, `.history-actions`, `.history-error`, `.history-status`, and `.history-cancelled`, including:

```css
.history-list { container-type: inline-size; list-style: none; margin: var(--sp-2) 0 0; padding: 0; }
.history-row {
  display: grid;
  grid-template-columns: auto minmax(8rem, 1fr) 11ch auto;
  align-items: center;
  gap: var(--sp-4);
}
.history-amount { width: 11ch; text-align: right; white-space: nowrap; font-weight: 700; }
@container (max-width: 820px) {
  .history-row { grid-template-columns: auto minmax(0, 1fr) 11ch; }
  .history-actions { grid-column: 1 / -1; }
}
```

- [ ] **Step 4: Run the presentation contract and Svelte check**

Run: `npm test -- --run src/lib/components/historyPresentationContract.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: 0 errors and 0 warnings.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/lib/components/HistoryRangeControls.svelte src/lib/styles/history.css src/lib/components/historyPresentationContract.test.ts
git commit -m "Add shared history range presentation"
```

---

### Task 6: Refactor Invoice History onto the Shared Contract

**Files:**
- Modify: `src/routes/history/+page.svelte`
- Create: `src/routes/history/historyContract.test.ts`

**Interfaces:**
- Consumes: fixed invoice repository operations, pure History helpers, `HistoryRangeControls`, shared History CSS, and range-aware invoice summary PDF.
- Produces: All-time-first invoice UI, range-filtered groups/rollups, status-aware asynchronous search, a separate filtered cancelled section, immutable exports, and page-scoped action locking.

- [ ] **Step 1: Add failing route contract tests**

Assert the route imports `listFinalizedInvoices`, `HistoryRangeControls`, and `history.css`; contains `loadState`, `searchState`, `createLatestRequestGate`, `openYears`, and `busyAction`; labels the page **Invoice History**; supplies `aria-controls`; focuses the cancelled disclosure; keeps View outside action disabling; and exports calendar years through `calendarYearRange(group.year)`.

- [ ] **Step 2: Run the invoice route contract and verify RED**

Run: `npm test -- --run src/routes/history/historyContract.test.ts`

Expected: FAIL against the current year-query route.

- [ ] **Step 3: Replace route state and loading**

Use this state shape:

```ts
type LoadState = 'loading' | 'ready' | 'error';
type SearchState = 'idle' | 'loading' | 'ready' | 'error';
let loadState = $state<LoadState>('loading');
let finalized = $state<InvoiceListItem[]>([]);
let cancelled = $state<InvoiceListItem[]>([]);
let searchRows = $state<InvoiceListItem[]>([]);
let searchState = $state<SearchState>('idle');
let openYears = $state<Record<number, boolean>>({});
let cancelledOpen = $state(false);
let rangeStart = $state('');
let rangeEnd = $state('');
let busyAction = $state('');
let errorMessage = $state('');
const searchGate = createLatestRequestGate();
```

`loadAll()` performs exactly `Promise.all([listFinalizedInvoices(db), listVoided(db)])`. Derived values resolve the effective range, filter finalized/cancelled arrays, group by year, compute chips, and split repository search results by status before range filtering.

- [ ] **Step 4: Implement latest-request search, action lock, cancelled focus, and exports**

Search clears stale rows immediately, announces **Searching…**, publishes only when `searchGate.isCurrent(requestId)`, and renders no-match only in `ready`. Restore reloads arrays and reruns a non-empty query.

At export start:

```ts
const resolution = resolveHistoryRange(rangeStart, rangeEnd);
if (resolution.kind === 'invalid') return;
const range = resolution.range ? Object.freeze({ ...resolution.range }) : null;
const rangeLabel = historyRangeLabel(range);
```

Use that frozen `range` and label through every await. A year action uses `calendarYearRange(year)` and `historyRangeLabel(range, year)`, independent of toolbar/search state. Keep per-year filenames unchanged.

- [ ] **Step 5: Implement semantic markup and shared classes**

Render mutually exclusive loading, retryable load error, true empty source, and loaded states. Keep controls visible whenever either source array is nonempty. Preserve a distinct cancelled section and auto-open it for cancelled search matches. Cancelled shortcut uses reduced-motion-aware scroll and then focuses the disclosure button. Range rollups ignore text search; no-active copy says **No active invoices…**.

- [ ] **Step 6: Run invoice route/repository/PDF tests and check**

Run: `npm test -- --run src/routes/history/historyContract.test.ts src/lib/history/history.test.ts src/lib/db/invoice-repo.test.ts src/lib/pdf/yearSummaryDoc.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: 0 errors and 0 warnings.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/routes/history/+page.svelte src/routes/history/historyContract.test.ts
git commit -m "Unify invoice history filtering and exports"
```

---

### Task 7: Refactor Expense History and Add Summary Export

**Files:**
- Modify: `src/routes/expense-history/+page.svelte`
- Modify: `src/routes/expense-history/expenseHistoryContract.test.ts`

**Interfaces:**
- Consumes: fixed expense repository operations, pure helpers, shared controls/styles, and expense summary PDF generator.
- Produces: matching All-time/range/search/cancelled behavior, current-year and per-year rollups, toolbar/year expense-summary exports, and preserved individual report actions.

- [ ] **Step 1: Expand the existing route contract test and verify RED**

Assert `listFinalizedExpenses`, `expenseSummaryForRange`, `HistoryRangeControls`, `history.css`, explicit load/search states, request gate, range snapshot, **Export expense summary**, full-year export label, `aria-controls`, focus restoration, shared `history-amount`, and absence of obsolete `listExpenseYears`/`expenseYearRollup` route calls.

Run: `npm test -- --run src/routes/expense-history/expenseHistoryContract.test.ts`

Expected: FAIL against the current route.

- [ ] **Step 2: Refactor loading, derivation, search, and cancelled handling**

Use an explicit expense-owned state machine and selectors:

```ts
type LoadState = 'loading' | 'ready' | 'error';
type SearchState = 'idle' | 'loading' | 'ready' | 'error';
let loadState = $state<LoadState>('loading');
let finalized = $state<ExpenseListItem[]>([]);
let cancelled = $state<ExpenseListItem[]>([]);
let searchRows = $state<ExpenseListItem[]>([]);
let searchState = $state<SearchState>('idle');
let openYears = $state<Record<number, boolean>>({});
let cancelledOpen = $state(false);
let rangeStart = $state('');
let rangeEnd = $state('');
let busyAction = $state('');
let errorMessage = $state('');
const searchGate = createLatestRequestGate();

const resolution = $derived(resolveHistoryRange(rangeStart, rangeEnd));
const rangedFinalized = $derived(filterHistoryRows(finalized, (row) => row.reportDate, resolution.range));
const rangedCancelled = $derived(filterHistoryRows(cancelled, (row) => row.reportDate, resolution.range));
const grouped = $derived(groupHistoryRows(rangedFinalized, (row) => row.reportDate));
```

`loadAll()` calls `Promise.all([listFinalizedExpenses(db), listVoidedExpenses(db)])`. Search immediately clears `searchRows`, enters `loading`, and publishes only the latest request; restore reloads both arrays and reruns a non-empty query. Preserve expense-specific View, Download PDF, Duplicate, and Restore actions.

- [ ] **Step 3: Add immutable toolbar and calendar-year expense exports**

For both export scopes, freeze the range first, then call `expenseSummaryForRange(db, range)`, reject zero qualifying reports with a visible no-data message, load settings, and call:

```ts
saveExpenseSummaryPdf({
  rangeLabel,
  preparedOn: toIsoDate(new Date()),
  businessName: settings.inspectorName || 'My business',
  reports: summary.reports,
  items: summary.items,
}, fileName)
```

Toolbar filenames identify All time or ISO bounds; year actions use `Expense-Summary-${year}.pdf` and the full calendar-year range.

- [ ] **Step 4: Run expense route/repository/PDF tests and check**

Run: `npm test -- --run src/routes/expense-history/expenseHistoryContract.test.ts src/lib/history/history.test.ts src/lib/db/expense-repo.test.ts src/lib/pdf/expenseSummaryDoc.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: 0 errors and 0 warnings.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/routes/expense-history/+page.svelte src/routes/expense-history/expenseHistoryContract.test.ts
git commit -m "Unify expense history filtering and exports"
```

---

### Task 8: Responsive Invoice Completion and End-to-End Verification

**Files:**
- Modify: `src/lib/components/InvoiceView.svelte`
- Modify: `src/lib/components/invoiceApprovalContract.test.ts`
- Modify: `docs/superpowers/plans/2026-07-21-unified-history-layout.md` only to check completed boxes during execution.

**Interfaces:**
- Consumes: existing `InvoiceView` markup and mileage approval regression contract.
- Produces: comfortable `1040px` invoice sheet, compact `860px` fallback, preserved wrapping, and final verified branch.

- [ ] **Step 1: Tighten the existing failing-first invoice layout contract**

The regression test must assert:

```ts
expect(view).toContain('max-width: 1040px');
expect(view).toContain('container-type: inline-size');
expect(view).toContain('@container (max-width: 860px)');
expect(view).toContain('overflow-wrap: anywhere');
expect(view).toContain('white-space: nowrap');
```

Temporarily confirm RED for the new max-width/breakpoint assertions before editing the component.

- [ ] **Step 2: Implement comfortable default and compact fallback CSS**

```css
.invoice {
  width: 100%;
  max-width: 1040px;
  container-type: inline-size;
}
th, td { padding: var(--sp-2) var(--sp-3); overflow-wrap: anywhere; }
td.r, th.r { white-space: nowrap; }
@container (max-width: 860px) {
  th, td { padding-inline: var(--sp-1); }
  td { font-size: var(--fs-sm); }
}
```

Keep the existing mileage approval row and pdfmake invoice untouched.

- [ ] **Step 3: Run the focused invoice regression and verify GREEN**

Run: `npm test -- --run src/lib/components/invoiceApprovalContract.test.ts`

Expected: PASS.

- [ ] **Step 4: Run the full automated gate from a fresh command**

Run: `npm run check`

Expected: 0 errors and 0 warnings.

Run: `npm test -- --run`

Expected: all test files and tests pass with zero failures.

Run: `npm run build`

Expected: exit 0.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: exit 0.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 7 native tests pass with zero failures, unless new native tests intentionally increase the count.

- [ ] **Step 5: Perform native/layout smoke verification**

Verify invoice preview/detail and both History routes at `1100×760` and `900×600`, with text scales `1`, `1.12`, and `1.28`. Check mileage row containment, two- through five-digit totals, toolbar/year wrapping, no horizontal page scroll, keyboard focus order, All-time defaults, invalid/incomplete range fallback, active/cancelled search matches, retry/no-results states, and both summary PDF types. Smoke-open an existing database and confirm no migration or backup rewrite occurs.

- [ ] **Step 6: Run independent review gates and fix findings test-first**

Request separate UX/accessibility, data/PDF correctness, and architecture/testability reviews of the complete diff. For each confirmed defect, add or tighten a failing test, observe RED, implement the minimal fix, rerun the focused test, and repeat the full automated gate.

- [ ] **Step 7: Commit final responsive/layout and review fixes**

```bash
git add src/lib/components/InvoiceView.svelte src/lib/components/invoiceApprovalContract.test.ts
git commit -m "Complete responsive invoice and history layout"
```

- [ ] **Step 8: Finish the feature branch**

Use `superpowers:finishing-a-development-branch`, present the verified integration options, and follow the user’s established preference to merge the branch back into `dev` only after approval. Re-run the full automated gate on merged `dev` before reporting completion.
