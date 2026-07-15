# Expense Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete, offline expense-report workflow with autosaved drafts, independent numbering, explicit sorting, preview, transactional finalization, immutable PDFs, history, and safe lifecycle controls.

**Architecture:** Keep expenses in a dedicated domain and three new SQLite tables. Pure helpers own ordering, totals, validation, and snapshots; one repository owns persistence and status transitions; Svelte routes call those boundaries and reuse the app's existing autosave, confirmation, date, money, toast, and backup patterns.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, SQLite through the existing `Db` abstraction, Vitest 4, pdfmake 0.3, Tauri 2.

## Global Constraints

- Do not modify shipped migrations 1-3; append schema version 4.
- Store monetary values only as integer cents and require finalized item amounts greater than zero.
- Keep invoice and expense tables, counters, history, and snapshots independent.
- Never sort live while the user types. Manual sort changes the editor; Preview sorts only a snapshot; finalization persists canonical order.
- Preserve equal-date order, place blank dates last, and never mutate ordering inputs.
- Finalization, duplication, cancel, restore, and delete operations must reject invalid status transitions and repeated UI clicks.
- A finalized snapshot is the sole source for display and PDF reprints.
- Keep all current invoice behavior and existing backup compatibility intact.

---

## File Structure

- Create `src/lib/expense/types.ts`: expense draft, row, snapshot, history, and rollup contracts.
- Create `src/lib/expense/order.ts`: stable date order and normalized positions.
- Create `src/lib/expense/validation.ts`: draft totals and finalization blockers.
- Create `src/lib/expense/snapshot.ts`: frozen business identity, canonical rows, and total.
- Create `src/lib/db/expense-repo.ts`: drafts, counters, finalization transaction, history, duplication, and lifecycle transitions.
- Create `src/lib/pdf/expenseDoc.ts`: pdfmake document definition from a frozen expense snapshot.
- Create `src/lib/components/ExpenseView.svelte`: shared Preview and finalized presentation.
- Create `src/routes/expenses/+page.svelte`: autosaved expense editor and finalization workflow.
- Create `src/routes/expense-history/+page.svelte`: grouped/searchable history and cancelled section.
- Create `src/routes/expense/[id]/+page.svelte`: immutable detail, PDF, duplicate, cancel, restore, and delete controls.
- Modify `src/lib/db/schema.ts`, `src/lib/db/restore.ts`, `src/lib/pdf/generate.ts`, `src/lib/components/AppShell.svelte`, and `USER_GUIDE.md` at their existing boundaries.

### Task 1: Pure Expense Domain

**Files:**
- Create: `src/lib/expense/types.ts`
- Create: `src/lib/expense/order.ts`
- Create: `src/lib/expense/order.test.ts`
- Create: `src/lib/expense/validation.ts`
- Create: `src/lib/expense/validation.test.ts`
- Create: `src/lib/expense/snapshot.ts`
- Create: `src/lib/expense/snapshot.test.ts`

**Interfaces:**
- Produces: `ExpenseItem`, `ExpenseDraft`, `ExpenseSnapshot`, `ExpenseListItem`, and `ExpenseRollup`.
- Produces: `sortExpenseItems(items): ExpenseItem[]` and `orderExpenseItems(items): ExpenseItem[]`.
- Produces: `expenseTotal(items): number` and `expenseFinalizeBlockers(draft): ExpenseBlocker[]`.
- Produces: `buildExpenseSnapshot(draft, settings, seq): ExpenseSnapshot`.

- [x] **Step 1: Add failing ordering and total tests**

```ts
expect(sortExpenseItems([
  item('new', '2026-02-01', 300),
  item('old', '2026-01-01', 200),
  item('blank', '', 100),
]).map((row) => row.description)).toEqual(['old', 'new', 'blank']);
expect(expenseTotal([item('a', '', 125), item('b', '', 375)])).toBe(500);
```

- [x] **Step 2: Run `npm test -- src/lib/expense/order.test.ts src/lib/expense/validation.test.ts` and confirm RED because the modules do not exist**

- [x] **Step 3: Implement immutable stable ordering, position normalization, integer-cent totals, and plain-language blockers**

```ts
export function sortExpenseItems(items: readonly ExpenseItem[]): ExpenseItem[];
export function orderExpenseItems(items: readonly ExpenseItem[]): ExpenseItem[];
export function expenseTotal(items: readonly ExpenseItem[]): number;
export function expenseFinalizeBlockers(draft: ExpenseDraft): ExpenseBlocker[];
```

- [x] **Step 4: Add the failing snapshot test proving canonical order, deep copies, frozen settings/logo, formatted report number, and total**

- [x] **Step 5: Implement `buildExpenseSnapshot()` and run all Task 1 tests GREEN**

- [ ] **Step 6: Commit Task 1 as `Build expense report domain rules`**

### Task 2: Schema Version 4 and Restore Compatibility

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/migrate.test.ts`
- Modify: `src/lib/db/restore.ts`
- Modify: `src/lib/db/restore.test.ts`
- Modify: `src/lib/components/RestoreBackup.svelte`

**Interfaces:**
- Produces tables `expense_year_counters`, `expense_reports`, and `expense_items` plus history/item indexes.
- Extends `BackupSummary` with `expenseReportCount: number` and `latestExpenseReportDate: string | null`.
- Requires expense tables only when `PRAGMA user_version >= 4`; accepts schema versions 1-3 and reports zero/none expense content.

- [x] **Step 1: Add failing migration tests for a fresh v4 database and a v3-to-v4 database that preserves invoice rows**

```ts
expect(await tableNames(db)).toEqual(expect.arrayContaining([
  'expense_year_counters', 'expense_reports', 'expense_items',
]));
expect(await userVersion(db)).toBe(4);
```

- [x] **Step 2: Run `npm test -- src/lib/db/migrate.test.ts` and confirm RED**

- [x] **Step 3: Append migration 4 with constrained statuses, positive counter checks, unique `(year, seq)`, cascading item deletion, and indexes**

- [x] **Step 4: Add failing restore tests for valid v3, valid v4 with expense data, v4 missing expense tables, and newer-than-v4 rejection**

- [x] **Step 5: Implement version-aware restore validation and show expense counts/dates in the existing confirmation summary**

- [x] **Step 6: Run migration and restore tests GREEN, then run all existing DB tests**

- [ ] **Step 7: Commit Task 2 as `Add expense report database migration`**

### Task 3: Transactional Expense Repository

**Files:**
- Create: `src/lib/db/expense-repo.ts`
- Create: `src/lib/db/expense-repo.test.ts`

**Interfaces:**
- Produces `createExpenseDraft`, `loadExpenseDraft`, `saveExpenseDraft`, `latestExpenseDraftId`, and `peekNextExpenseSeq`.
- Produces `finalizeExpenseReport` and `reprintExpenseSnapshot`.
- Produces `listExpenseYears`, `expenseYearRollup`, `listExpensesForYear`, `searchExpenses`, and `listVoidedExpenses`.
- Produces `duplicateExpenseReport`, `voidExpenseReport`, `restoreExpenseReport`, `deleteVoidedExpenseReport`, and `getExpenseStatus`.

- [ ] **Step 1: Add failing tests for create/save/load, incomplete drafts, latest-draft reopening, and independent invoice/expense next numbers**

- [ ] **Step 2: Run `npm test -- src/lib/db/expense-repo.test.ts` and confirm RED**

- [ ] **Step 3: Implement draft persistence and independent counter queries using `runInTransaction()`**

- [ ] **Step 4: Add failing finalization tests for validation, selected sequences, duplicate rejection, counter advancement, canonical stored order, frozen snapshot, and rollback**

- [ ] **Step 5: Implement one-transaction finalization with repository-level blocker checks and guarded counter reservation**

- [ ] **Step 6: Add failing history/search/rollup/duplicate/cancel/restore/delete/status-guard tests**

- [ ] **Step 7: Implement history and lifecycle functions; assert affected status before reporting success**

- [ ] **Step 8: Run `npm test -- src/lib/db/expense-repo.test.ts src/lib/db/invoice-repo.test.ts` GREEN**

- [ ] **Step 9: Commit Task 3 as `Add expense report persistence lifecycle`**

### Task 4: Expense PDF and Shared Finalized View

**Files:**
- Create: `src/lib/pdf/expenseDoc.ts`
- Create: `src/lib/pdf/expenseDoc.test.ts`
- Modify: `src/lib/pdf/generate.ts`
- Modify: `src/lib/pdf/generate.test.ts`
- Create: `src/lib/components/ExpenseView.svelte`

**Interfaces:**
- Produces `buildExpenseDoc(snapshot): Record<string, unknown>`.
- Produces `expensePdfBytes(snapshot): Promise<Uint8Array>` and `saveExpensePdf(snapshot): Promise<SaveResult>`.
- `ExpenseView` accepts one `ExpenseSnapshot` and renders the same identifying fields, rows, and total represented in the PDF.

- [ ] **Step 1: Add a failing document test for business identity, report number/date/period, chronological table rows, amount formatting, total, and optional logo**

- [ ] **Step 2: Run `npm test -- src/lib/pdf/expenseDoc.test.ts` and confirm RED**

- [ ] **Step 3: Implement the focused pdfmake definition without invoice bill-to, HST, mileage, or payment fields**

- [ ] **Step 4: Add failing PDF byte-generation coverage, then wire `expensePdfBytes` and `saveExpensePdf` through the existing private PDF helpers**

- [ ] **Step 5: Build `ExpenseView.svelte` from snapshot data only and run PDF tests GREEN**

- [ ] **Step 6: Commit Task 4 as `Add expense report snapshot PDF view`**

### Task 5: Autosaved Expense Editor

**Files:**
- Create: `src/lib/ui/expenseSequence.ts`
- Create: `src/lib/ui/expenseSequence.test.ts`
- Create: `src/lib/ui/expenseEditor.ts`
- Create: `src/lib/ui/expenseEditor.test.ts`
- Create: `src/routes/expenses/+page.svelte`
- Create: `src/routes/expenses/expensePageContract.test.ts`

**Interfaces:**
- `expenseSequence.ts` validates editable positive sequences against `peekNextExpenseSeq` results without changing invoice sequence behavior.
- `expenseEditor.ts` supplies pure Preview snapshot preparation and first-blocker targeting data.
- The route reopens/creates one draft, uses `createAutosaveController`, and calls repository/PDF/backup boundaries.

- [ ] **Step 1: Add failing tests for sequence parsing, deliberate override retention across year changes, Preview sorting without editor mutation, and first blocker selection**

- [ ] **Step 2: Run the focused UI helper tests and confirm RED**

- [ ] **Step 3: Implement the pure helpers and run them GREEN**

- [ ] **Step 4: Add the Svelte route with labelled report number/date/period controls, Date/Description/Total Amount rows, add/remove, running total, explicit Sort, Preview, and Lock & Save**

- [ ] **Step 5: Wire autosave to partial drafts; settle it before finalization; guard repeated finalization; persist canonical order; save PDF; trigger backup; then open a fresh draft**

- [ ] **Step 6: Add a route contract test asserting navigation labels, sort/preview/finalize handlers, SaveStatusChip, ExpenseView, and destructive-free editor behavior**

- [ ] **Step 7: Run focused tests plus `npm run check` GREEN**

- [ ] **Step 8: Commit Task 5 as `Add autosaved expense report editor`**

### Task 6: History, Detail, Navigation, and Documentation

**Files:**
- Modify: `src/lib/components/AppShell.svelte`
- Create: `src/routes/expense-history/+page.svelte`
- Create: `src/routes/expense/[id]/+page.svelte`
- Create: `src/routes/expense-history/expenseHistoryContract.test.ts`
- Create: `src/routes/expense/[id]/expenseDetailContract.test.ts`
- Modify: `USER_GUIDE.md`

**Interfaces:**
- Sidebar adds `/expenses` and `/expense-history` while preserving existing invoice History.
- History consumes repository grouping/search/rollup/cancelled functions.
- Detail consumes frozen snapshot and guarded lifecycle functions; finalized reports remain read-only.

- [ ] **Step 1: Add failing source-contract tests for both routes and sidebar entries**

- [ ] **Step 2: Run focused contract tests and confirm RED**

- [ ] **Step 3: Implement grouped finalized history, live search, yearly counts/totals, Download/View/Duplicate actions, and a separate collapsible Cancelled section**

- [ ] **Step 4: Implement detail loading, frozen `ExpenseView`, PDF re-save, duplicate, cancel, restore, and double-confirmed permanent delete with busy guards and actionable errors**

- [ ] **Step 5: Add sidebar links and concise user-guide instructions for creating, previewing, finalizing, finding, restoring, and duplicating expense reports**

- [ ] **Step 6: Run focused route tests, all expense tests, and `npm run check` GREEN**

- [ ] **Step 7: Commit Task 6 as `Add expense history and lifecycle screens`**

### Task 7: Review Loop and Merge Gate

**Files:**
- Review every file changed from `dev..feature/expense-reports`.
- Modify only files needed to resolve verified findings.

**Interfaces:**
- Produces a review-clean feature branch ready for local fast-forward or merge into `dev`.

- [ ] **Step 1: Review correctness and regression risk across domain, transaction boundaries, statuses, numbering, and rollback behavior**

- [ ] **Step 2: Review usability and accessibility for large controls, labels, keyboard flow, focus-to-blocker, errors, confirmation wording, and non-moving rows**

- [ ] **Step 3: Review migration/restore compatibility and immutable snapshot/PDF reprint guarantees**

- [ ] **Step 4: Render representative PDFs and visually inspect logo, long descriptions, totals, page breaks, and chronological order**

- [ ] **Step 5: For every substantive finding, add a failing regression test, confirm RED, apply the smallest fix, and confirm GREEN**

- [ ] **Step 6: Repeat review until no Critical or Important findings remain**

- [ ] **Step 7: Run the final gate**

```bash
git diff --check dev..HEAD
npm test
npm run check
npm run build
npm run tauri -- build --debug
git status --short --branch
```

- [ ] **Step 8: Merge locally into `dev` only after every gate passes, then rerun `npm test` on merged `dev`**

## Plan Self-Review

- Spec coverage: every design section maps to Tasks 1-7, including independent counters, immutable snapshots, backup compatibility, PDF reprints, lifecycle guards, accessibility, and out-of-scope constraints.
- Placeholder scan: no TBD, TODO, deferred implementation marker, or undefined follow-up remains.
- Type consistency: `ExpenseDraft` flows through validation, persistence, and snapshot construction; `ExpenseSnapshot` is the sole input to view/PDF/reprint; repository list and rollup contracts directly feed history.
- Scope: no tax fields, receipts, categories, vendors, drag-and-drop, live sorting, finalized editing, combined history navigation, or generic document framework is introduced.
