# Expense Date Warning Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present every out-of-range expense date as the same concise, row-level warning pattern used by invoices while preserving hard expense finalization enforcement.

**Architecture:** Keep `expenseFinalizeBlockers` as the validation source and export one stable out-of-range message. A pure expense-editor helper selects that blocker for a given row, and the Svelte route renders it with the invoice component's exact warning markup and styles.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, Vitest 4, SQLite through the existing database adapters.

## Global Constraints

- The exact out-of-range message is `Date is outside the reporting period`.
- Every affected expense row shows `⚠ Date is outside the reporting period` below that row.
- Row-level sticky guidance matches invoices with `Fix N rows to finish →` and keeps focusing the first blocker.
- Header-level sticky guidance keeps its specific message and Fix it label.
- Reporting-period boundaries stay inclusive.
- Preview prerequisites do not change.
- Lock & Save and repository finalization remain hard-blocked by every out-of-range row.
- The route must consume shared blockers rather than reimplement date comparisons.
- Missing and malformed date presentation does not change.

---

## File Structure

- Modify `src/lib/expense/validation.ts`: export and emit the concise out-of-range message.
- Modify `src/lib/expense/validation.test.ts`: lock exact concise messages and all-row coverage.
- Modify `src/lib/ui/expenseEditor.ts`: select an out-of-range blocker for a displayed row.
- Modify `src/lib/ui/expenseEditor.test.ts`: cover matching, nonmatching, and multiple row warnings plus concise Fix it targeting.
- Modify `src/lib/db/expense-repo.test.ts`: preserve repository rejection with the concise message.
- Modify `src/routes/expenses/+page.svelte`: render the shared warning per row using invoice markup and styles.
- Modify `src/routes/expenses/expensePageContract.test.ts`: lock declaration-for-declaration invoice warning parity.

### Task 1: Concise Row-Level Expense Date Warning

**Files:**
- Modify: `src/lib/expense/validation.ts`
- Modify: `src/lib/expense/validation.test.ts`
- Modify: `src/lib/ui/expenseEditor.ts`
- Modify: `src/lib/ui/expenseEditor.test.ts`
- Modify: `src/lib/db/expense-repo.test.ts`
- Modify: `src/routes/expenses/+page.svelte`
- Modify: `src/routes/expenses/expensePageContract.test.ts`

**Interfaces:**
- Produces: `EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE: 'Date is outside the reporting period'`
- Produces: `expenseRowDateRangeWarning(blockers: readonly ExpenseBlocker[], itemIndex: number): string | null`
- Produces: `expenseBlockingRowCount(blockers: readonly ExpenseBlocker[]): number`
- Preserves: `expenseFinalizeBlockers(draft: ExpenseDraft): ExpenseBlocker[]`
- Preserves: `firstExpenseBlockerTarget(draft: ExpenseDraft): ExpenseBlockerTarget | null`

- [ ] **Step 1: Write the failing tests**

Change all out-of-range expectations to the concise message. Add helper assertions proving row 0 and row 1 both resolve independently while unrelated row/date blockers return `null`, and that multiple blockers on one row count as one blocked row. Add a route contract that requires the helper call, `⚠ {dateRangeWarning}`, invoice-style `Fix N rows to finish →`, and the same two `.warns` declarations found in `InvoiceSection.svelte`.

```ts
expect(expenseRowDateRangeWarning(blockers, 0)).toBe('Date is outside the reporting period');
expect(expenseRowDateRangeWarning(blockers, 1)).toBe('Date is outside the reporting period');
expect(expenseRowDateRangeWarning(blockers, 2)).toBeNull();
expect(expenseBlockingRowCount(blockers)).toBe(2);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: FAIL because the concise message, selection helper, and inline route warning do not exist.

- [ ] **Step 3: Implement the shared message and selection helper**

```ts
export const EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE = 'Date is outside the reporting period';

export function expenseRowDateRangeWarning(
  blockers: readonly ExpenseBlocker[],
  itemIndex: number,
): string | null {
  return blockers.find((blocker) =>
    blocker.field === 'date'
      && blocker.itemIndex === itemIndex
      && blocker.message === EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE
  )?.message ?? null;
}
```

Use the constant when constructing the existing out-of-range blocker and remove the now-unused date formatter import.

- [ ] **Step 4: Render the warning with the invoice pattern**

Inside each expense row, compute `dateRangeWarning` from the derived blocker list and row index. After the delete control, render:

```svelte
{#if dateRangeWarning}
  <div class="warns"><span>⚠ {dateRangeWarning}</span></div>
{/if}
```

Copy these invoice declarations exactly:

```css
.warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
.warns span { color: var(--amber-600); font-size: var(--fs-sm); }
```

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Run full verification**

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: the full unit suite passes; Svelte reports zero errors and warnings; the production build succeeds; the diff has no whitespace errors.

- [ ] **Step 7: Commit and integrate**

```bash
git add docs/superpowers/specs/2026-07-17-expense-date-warning-parity-design.md docs/superpowers/plans/2026-07-17-expense-date-warning-parity.md src/lib/expense/validation.ts src/lib/expense/validation.test.ts src/lib/ui/expenseEditor.ts src/lib/ui/expenseEditor.test.ts src/lib/db/expense-repo.test.ts src/routes/expenses/+page.svelte src/routes/expenses/expensePageContract.test.ts
git commit -m "Match expense date warnings to invoices"
git checkout dev
git merge --ff-only codex/expense-date-error-parity
```

Expected: the feature commit fast-forwards cleanly into local `dev`.
