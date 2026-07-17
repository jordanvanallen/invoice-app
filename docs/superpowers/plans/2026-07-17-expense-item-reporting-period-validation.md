# Expense Item Reporting-Period Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Lock & Save and repository finalization until every expense-report date is a canonical real date and every expense line date falls within the inclusive reporting period.

**Architecture:** Generic date-shape, calendar-validity, and display-label helpers live beside the existing date-range helper in `src/lib/validation.ts`. The shared `expenseFinalizeBlockers` function remains the single expense validation boundary for dock guidance, field focus, Lock & Save, and repository finalization; Preview remains independent of blockers.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, Vitest 4, SQLite through the existing database adapters.

## Global Constraints

- Reporting-period start and end dates are inclusive.
- Lock & Save stays disabled until report date, period boundaries, and every expense date are canonical real `YYYY-MM-DD` calendar dates.
- Every non-empty expense date must fall within the reporting period.
- Missing, malformed, and out-of-range dates produce exactly one date blocker per field.
- Header blockers precede row blockers; row blockers remain in displayed row order as `date`, `description`, then `amount`.
- Fix it shows the first current blocker, focuses its existing input, and advances after correction.
- Out-of-range messages identify the row and formatted valid bounds.
- Expense blockers do not add a Preview restriction; existing row-count and sequence-readiness prerequisites remain unchanged.
- Repository rejection must occur before row sorting, counter reservation, snapshots, totals, timestamps, or status changes.
- Do not auto-correct dates, add date-picker limits, add duplicate inline warnings, or change invoice validation behavior.

---

## File Structure

- Modify `src/lib/validation.ts`: add canonical real-date validation and deterministic display formatting beside `isDateOutsidePeriod`.
- Modify `src/lib/validation.test.ts`: cover canonical, non-canonical, impossible, leap-day, and formatted-date behavior.
- Modify `src/lib/expense/validation.ts`: validate headers and each row at the shared blocker boundary.
- Modify `src/lib/expense/validation.test.ts`: lock exact blocker messages, precedence, inclusive boundaries, and row-major order.
- Modify `src/lib/ui/expenseEditor.test.ts`: prove Preview remains available and Fix it targets a second-row date blocker.
- Modify `src/lib/db/expense-repo.test.ts`: prove repository rejection has no finalization side effects.
- Modify `src/routes/expenses/expensePageContract.test.ts`: preserve the Preview-versus-Lock enablement distinction.

### Task 1: Canonical ISO Date Helpers

**Files:**
- Modify: `src/lib/validation.ts:45-48`
- Modify: `src/lib/validation.test.ts:3-5,61-67`

**Interfaces:**
- Produces: `isValidIsoDate(value: string): boolean`
- Produces: `formatIsoDate(value: string): string`
- Preserves: `isDateOutsidePeriod(date: string, start: string, end: string): boolean`

- [ ] **Step 1: Write the failing helper tests**

Add both exports to the existing import from `./validation`, then add this block immediately before `describe('isDateOutsidePeriod', ...)`:

```ts
describe('isValidIsoDate / formatIsoDate', () => {
  test('accepts canonical real dates including leap day', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  test('rejects blank, non-canonical, impossible, and arbitrary values', () => {
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('   ')).toBe(false);
    expect(isValidIsoDate('2026-7-01')).toBe(false);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
  });

  test('formats a validated ISO date without timezone conversion', () => {
    expect(formatIsoDate('2026-07-01')).toBe('Jul 1, 2026');
    expect(formatIsoDate('2026-12-15')).toBe('Dec 15, 2026');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/lib/validation.test.ts
```

Expected: FAIL because `isValidIsoDate` and `formatIsoDate` are not exported.

- [ ] **Step 3: Implement the minimal generic helpers**

Add this immediately before `isDateOutsidePeriod` in `src/lib/validation.ts`:

```ts
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** A canonical YYYY-MM-DD string that represents a real calendar date. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Deterministic display label for a validated ISO date. */
export function formatIsoDate(value: string): string {
  if (!isValidIsoDate(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return `${SHORT_MONTHS[month - 1]} ${day}, ${year}`;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/lib/validation.test.ts
```

Expected: the validation test file passes with no warnings.

- [ ] **Step 5: Commit the helper task**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "Add canonical ISO date helpers"
```

### Task 2: Expense Reporting-Period Enforcement

**Files:**
- Modify: `src/lib/expense/validation.ts:1-59`
- Modify: `src/lib/expense/validation.test.ts:1-59`
- Modify: `src/lib/ui/expenseEditor.test.ts:12-45`
- Modify: `src/lib/db/expense-repo.test.ts:88-150`
- Modify: `src/routes/expenses/expensePageContract.test.ts:4-18,84-98`

**Interfaces:**
- Consumes: `isValidIsoDate`, `formatIsoDate`, and `isDateOutsidePeriod` from `src/lib/validation.ts`.
- Preserves: `expenseFinalizeBlockers(draft: ExpenseDraft): ExpenseBlocker[]`.
- Preserves: `firstExpenseBlockerTarget(draft: ExpenseDraft): ExpenseBlockerTarget | null`.
- Preserves: `prepareExpensePreview(draft, settings, seq): ExpenseSnapshot` without blocker enforcement.

- [ ] **Step 1: Add failing expense blocker tests**

Add these exact tests to `src/lib/expense/validation.test.ts`:

```ts
test('blocks dates before and after the reporting period in displayed row order', () => {
  expect(expenseFinalizeBlockers(draft({
    items: [
      row({ position: 0, date: '2026-06-30', description: '', amountCents: 0 }),
      row({ position: 1, date: '2026-07-16' }),
    ],
  }))).toEqual([
    { field: 'date', itemIndex: 0, message: 'Expense 1 date must be between Jul 1, 2026 and Jul 15, 2026.' },
    { field: 'description', itemIndex: 0, message: 'Enter a description for expense 1.' },
    { field: 'amountCents', itemIndex: 0, message: 'Enter an amount greater than $0.00 for expense 1.' },
    { field: 'date', itemIndex: 1, message: 'Expense 2 date must be between Jul 1, 2026 and Jul 15, 2026.' },
  ]);
});

test('accepts dates equal to both inclusive reporting-period boundaries', () => {
  expect(expenseFinalizeBlockers(draft({
    items: [row({ date: '2026-07-01' }), row({ position: 1, date: '2026-07-15' })],
  }))).toEqual([]);
});

test('validates header dates before row range and emits one date blocker per field', () => {
  expect(expenseFinalizeBlockers(draft({
    reportDate: '2026-02-30',
    periodStart: '2026-7-01',
    periodEnd: 'not-a-date',
    items: [row({ date: '2026-07-30' })],
  }))).toEqual([
    { field: 'reportDate', itemIndex: null, message: 'Choose a valid report date.' },
    { field: 'periodStart', itemIndex: null, message: 'Choose a valid reporting period start date.' },
    { field: 'periodEnd', itemIndex: null, message: 'Choose a valid reporting period end date.' },
  ]);

  expect(expenseFinalizeBlockers(draft({ items: [row({ date: '   ' })] }))).toEqual([
    { field: 'date', itemIndex: 0, message: 'Choose a date for expense 1.' },
  ]);
  expect(expenseFinalizeBlockers(draft({ items: [row({ date: '2026-02-30' })] }))).toEqual([
    { field: 'date', itemIndex: 0, message: 'Choose a valid date for expense 1.' },
  ]);
});
```

Keep the existing reversed-period test. Its row date must continue to emit only its missing-date blocker, with no out-of-range blocker.

- [ ] **Step 2: Add failing editor target and Preview regression tests**

Add this exact test to `src/lib/ui/expenseEditor.test.ts`:

```ts
test('keeps Preview available while targeting an out-of-range second row', () => {
  const rangeDraft: ExpenseDraft = {
    seq: 4,
    year: 2026,
    reportDate: '2026-07-15',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-15',
    items: [
      { position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
      { position: 1, date: '2026-07-16', description: 'Fuel', amountCents: 5_000 },
    ],
  };

  expect(firstExpenseBlockerTarget(rangeDraft)).toEqual({
    id: 'expense-row-1-date',
    message: 'Expense 2 date must be between Jul 1, 2026 and Jul 15, 2026.',
  });

  const preview = prepareExpensePreview(rangeDraft, settings, 4);
  expect(preview.items.map((entry) => entry.description)).toEqual(['Parking', 'Fuel']);
  expect(rangeDraft.items.map((entry) => entry.description)).toEqual(['Parking', 'Fuel']);
});
```

The Preview assertions are expected to pass before production changes because Preview intentionally ignores blockers; the target assertion must fail because the date-range blocker is absent.

- [ ] **Step 3: Add the failing repository no-side-effect test**

Add this test under `describe('expense finalization', ...)` in `src/lib/db/expense-repo.test.ts`:

```ts
test('rejects an out-of-range item without any finalization side effects', async () => {
  const db = await freshDb();
  const id = await createExpenseDraft(db, header());
  await saveExpenseDraft(db, id, draft({
    seq: 9,
    items: [
      item({ position: 0, date: '2026-07-10', description: 'Parking' }),
      item({ position: 1, date: '2026-07-16', description: 'Fuel' }),
    ],
  }));

  await expect(finalizeExpenseReport(db, id)).rejects.toThrow(
    'Expense 2 date must be between Jul 1, 2026 and Jul 15, 2026.',
  );

  expect(await db.select(
    'SELECT status, finalized_at, total_cents, snapshot_json FROM expense_reports WHERE id = ?',
    [id],
  )).toEqual([{
    status: 'draft', finalized_at: null, total_cents: 0, snapshot_json: null,
  }]);
  expect((await loadExpenseDraft(db, id)).items.map((entry) => entry.description)).toEqual([
    'Parking', 'Fuel',
  ]);
  expect(await db.select('SELECT * FROM expense_year_counters')).toEqual([]);
  await expect(reprintExpenseSnapshot(db, id)).rejects.toThrow(/not finalized/i);
});
```

- [ ] **Step 4: Preserve the Preview-versus-Lock route contract**

Add these assertions to the existing `provides autosave, explicit sort, snapshot Preview, and guarded finalization` test:

```ts
expect(page).toContain('const blockers = $derived(expenseFinalizeBlockers(draftForDisplay));');
expect(page).toContain('const canFinalize = $derived(blockers.length === 0');
expect(page).toContain('disabled={!canFinalize}>Lock &amp; Save</BigButton>');
```

Add these assertions to the existing `sorts the visible editor rows before building Preview` test after `previewHandler` is created:

```ts
expect(previewHandler).not.toContain('blockers');
expect(previewHandler).not.toContain('canFinalize');
```

- [ ] **Step 5: Run all focused tests and verify RED**

Run:

```bash
npm test -- src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: validation, second-row target, and repository finalization assertions FAIL because out-of-range dates are not yet blockers. Preview and route-preservation assertions may already pass.

- [ ] **Step 6: Implement shared expense date validation**

Import the generic helpers in `src/lib/expense/validation.ts`:

```ts
import { formatIsoDate, isDateOutsidePeriod, isValidIsoDate } from '../validation';
```

Replace the existing header date checks with missing-versus-malformed checks. Compute valid period boundaries only from canonical real dates, and apply the existing reversed-period blocker only when both boundaries are individually valid.

```ts
const reportDateValid = isValidIsoDate(draft.reportDate);
if (!draft.reportDate.trim()) {
  blockers.push({ field: 'reportDate', itemIndex: null, message: 'Choose a report date.' });
} else if (!reportDateValid) {
  blockers.push({ field: 'reportDate', itemIndex: null, message: 'Choose a valid report date.' });
}

const periodStartValid = isValidIsoDate(draft.periodStart);
const periodEndValid = isValidIsoDate(draft.periodEnd);

if (!draft.periodStart.trim()) {
  blockers.push({
    field: 'periodStart', itemIndex: null,
    message: 'Choose a reporting period start date.',
  });
} else if (!periodStartValid) {
  blockers.push({
    field: 'periodStart', itemIndex: null,
    message: 'Choose a valid reporting period start date.',
  });
}

if (!draft.periodEnd.trim()) {
  blockers.push({
    field: 'periodEnd', itemIndex: null,
    message: 'Choose a reporting period end date.',
  });
} else if (!periodEndValid) {
  blockers.push({
    field: 'periodEnd', itemIndex: null,
    message: 'Choose a valid reporting period end date.',
  });
} else if (periodStartValid && draft.periodStart > draft.periodEnd) {
  blockers.push({
    field: 'periodEnd', itemIndex: null,
    message: 'The reporting period end must be on or after its start.',
  });
}

const periodAllowsRows = periodStartValid
  && periodEndValid
  && draft.periodStart <= draft.periodEnd;
```

Inside the existing `draft.items.forEach`, replace the independent missing-date `if` with a single date `if / else if` chain before description and amount validation:

```ts
if (!item.date.trim()) {
  blockers.push({
    field: 'date', itemIndex,
    message: `Choose a date for expense ${itemIndex + 1}.`,
  });
} else if (!isValidIsoDate(item.date)) {
  blockers.push({
    field: 'date', itemIndex,
    message: `Choose a valid date for expense ${itemIndex + 1}.`,
  });
} else if (periodAllowsRows && isDateOutsidePeriod(
  item.date, draft.periodStart, draft.periodEnd,
)) {
  blockers.push({
    field: 'date', itemIndex,
    message: `Expense ${itemIndex + 1} date must be between ${formatIsoDate(draft.periodStart)} and ${formatIsoDate(draft.periodEnd)}.`,
  });
}
```

Do not modify the Svelte page, `firstExpenseBlockerTarget`, `prepareExpensePreview`, or repository finalization code; their existing consumption of `expenseFinalizeBlockers` is the intended integration.

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: all focused test files pass with no warnings.

- [ ] **Step 8: Run full verification**

Run each command and require a zero exit status:

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: full tests pass, Svelte reports zero errors and warnings, the production build succeeds, and the diff has no whitespace errors.

- [ ] **Step 9: Commit the validated feature**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts src/lib/expense/validation.ts src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/expensePageContract.test.ts
git commit -m "Validate expense dates against reporting period"
```

- [ ] **Step 10: Run multi-agent implementation review**

Provide reviewers the reviewed design, this plan, the implementation commit range, and test evidence. Require explicit satisfaction on validation correctness, invoice/UX consistency, test coverage, and repository non-mutation. Resolve every Critical or Important finding and re-review until all reviewers return satisfied.
