# Expense Row Validation Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every expense row blocker inline with concise field-level copy while preserving the shared validator and existing finalization behavior.

**Architecture:** Replace the date-only presentation helper with a pure `expenseRowWarnings` helper that filters the already-derived blocker list by `itemIndex` and maps each structured row blocker to concise display text. Render its returned array with the invoice editor's established multi-warning loop.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, Vitest 4.

## Global Constraints

- `expenseFinalizeBlockers` remains the only validation source.
- Every blocker belonging to a row appears below that row in existing blocker order.
- Missing date displays `Choose a date`.
- Invalid date displays `Choose a valid date`.
- An out-of-range date displays `Date is outside the reporting period`.
- Missing description displays `Enter a description`.
- Invalid amount displays `Enter an amount greater than $0.00`.
- Multiple blockers on one row still count as one blocked row in the footer.
- Header guidance, Fix targeting, Preview, sorting, autosave, Lock & Save, and repository finalization remain unchanged.

---

## File Structure

- Modify `src/lib/ui/expenseEditor.ts`: replace the date-only selector with an all-row warning selector and concise display mapping.
- Modify `src/lib/ui/expenseEditor.test.ts`: prove blank descriptions and multiple blockers render in validation order.
- Modify `src/routes/expenses/+page.svelte`: render every returned row warning.
- Modify `src/routes/expenses/expensePageContract.test.ts`: prevent regression to a date-only warning.

### Task 1: Render Every Expense Row Blocker

**Files:**
- Modify: `src/lib/ui/expenseEditor.ts`
- Modify: `src/lib/ui/expenseEditor.test.ts`
- Modify: `src/routes/expenses/+page.svelte`
- Modify: `src/routes/expenses/expensePageContract.test.ts`

**Interfaces:**
- Produces: `expenseRowWarnings(blockers: readonly ExpenseBlocker[], itemIndex: number): string[]`
- Removes: `expenseRowDateRangeWarning(blockers: readonly ExpenseBlocker[], itemIndex: number): string | null`
- Preserves: `expenseBlockingRowCount(blockers: readonly ExpenseBlocker[]): number`

- [ ] **Step 1: Write the failing helper and route tests**

Update `src/lib/ui/expenseEditor.test.ts` to call the wished-for helper:

```ts
expect(expenseRowWarnings(blockers, 0)).toEqual([
  'Date is outside the reporting period',
  'Enter a description',
  'Enter an amount greater than $0.00',
]);
expect(expenseRowWarnings(blockers, 1)).toEqual([
  'Date is outside the reporting period',
]);
expect(expenseRowWarnings(blockers, 2)).toEqual(['Choose a date']);
```

Add a dedicated valid-row assertion returning `[]`. Update the route contract to require `expenseRowWarnings(blockers, index)`, an `{#each rowWarnings as warning}` loop, and `<span>⚠ {warning}</span>`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/lib/ui/expenseEditor.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: FAIL because `expenseRowWarnings` and the route warning loop do not exist.

- [ ] **Step 3: Implement the minimal presentation helper**

Replace the date-only helper with:

```ts
function rowWarningMessage(blocker: ExpenseBlocker): string {
  if (blocker.field === 'description') return 'Enter a description';
  if (blocker.field === 'amountCents') return 'Enter an amount greater than $0.00';
  if (blocker.field === 'date') {
    if (blocker.message === EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE) {
      return EXPENSE_DATE_OUTSIDE_PERIOD_MESSAGE;
    }
    return blocker.message.startsWith('Choose a valid date')
      ? 'Choose a valid date'
      : 'Choose a date';
  }
  return blocker.message;
}

export function expenseRowWarnings(
  blockers: readonly ExpenseBlocker[],
  itemIndex: number,
): string[] {
  return blockers
    .filter((blocker) => blocker.itemIndex === itemIndex)
    .map(rowWarningMessage);
}
```

This maps existing structured blockers without running any new validation.

- [ ] **Step 4: Render all messages using the invoice warning loop**

Inside the keyed expense-row loop, compute:

```svelte
{@const rowWarnings = expenseRowWarnings(blockers, index)}
```

Replace the single warning with:

```svelte
{#if rowWarnings.length}
  <div class="warns">
    {#each rowWarnings as warning}<span>⚠ {warning}</span>{/each}
  </div>
{/if}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/lib/ui/expenseEditor.test.ts src/routes/expenses/expensePageContract.test.ts
```

Expected: both focused test files pass.

- [ ] **Step 6: Run full verification**

```bash
npm test
npm run check
npm run build
git diff --check
```

Expected: the full suite passes, Svelte reports zero errors and warnings, the production build succeeds, and the diff has no whitespace errors.

- [ ] **Step 7: Commit and integrate**

```bash
git add src/lib/ui/expenseEditor.ts src/lib/ui/expenseEditor.test.ts src/routes/expenses/+page.svelte src/routes/expenses/expensePageContract.test.ts
git add -f docs/superpowers/plans/2026-07-17-expense-row-validation-messages.md
git commit -m "Show all expense row validation messages"
git checkout dev
git merge --ff-only codex/expense-row-validation-messages
npm test
git branch -d codex/expense-row-validation-messages
```

Expected: the reviewed implementation fast-forwards into local `dev`, the post-merge suite passes, and the short-lived branch is removed.
