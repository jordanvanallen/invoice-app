# Preview Sorts the Invoice Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Preview sort the visible Completed and No-Show editor sections before rendering so closing Preview returns to the same order the user reviewed.

**Architecture:** Reuse the existing tested `sortInvoiceSections()` helper through one Svelte `sortInvoiceRows()` function shared by the manual sort button and `openPreview()`. Route Preview through a small synchronous `prepareInvoicePreview()` seam that calls the editor sort action before snapshot construction. A behavioral test executes that transition and confirms the retained editor arrays match the snapshot, while a source-contract test protects the Svelte wiring; the existing unit, database, snapshot, Svelte, and build checks cover the surrounding behavior and integration boundaries.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, Vitest 4.

## Global Constraints

- Preview is an explicit sorting action.
- Sort Completed and No-Show rows separately from oldest to newest.
- Assign the sorted editor arrays before building the Preview snapshot.
- Closing Preview leaves the editor in the same sorted order that was reviewed.
- Never sort reactively while the user edits a date or adds a row.
- Preserve current relative order for equal dates and place blank dates last.
- Reuse the existing ordering helper; add no dependency, schema change, or secondary sorting rule.

---

## File Structure

- Create `src/lib/ui/preview.ts`: execute the sort action before building the Preview snapshot.
- Create `src/lib/ui/preview.test.ts`: behaviorally verify the editor and snapshot retain the same sorted section order.
- Create `src/lib/ui/previewSortContract.test.ts`: assert the Svelte Preview handler sorts visible rows before snapshot construction.
- Modify `src/routes/+page.svelte`: share one explicit editor-sort function between the button and Preview.
- Modify `USER_GUIDE.md`: explain that Preview leaves the editor matching the reviewed order.

### Task 1: Align Preview and Editor Order

**Files:**
- Create: `src/lib/ui/preview.ts`
- Create: `src/lib/ui/preview.test.ts`
- Create: `src/lib/ui/previewSortContract.test.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `USER_GUIDE.md`

**Interfaces:**
- Consumes: `sortInvoiceSections<T extends { date: string }>(completed, noshow)` from `src/lib/lineOrder.ts`.
- Produces: `sortInvoiceRows(): void`, used by the manual sort button and supplied to Preview.
- Produces: `prepareInvoicePreview<T>({ sortRows, buildSnapshot }): T`, which guarantees synchronous sort-before-snapshot sequencing.

- [ ] **Step 1: Write the failing Preview behavioral and wiring tests**

Create `src/lib/ui/preview.test.ts` to execute the transition with unsorted Completed and No-Show rows and assert that the returned snapshot and retained editor arrays contain the same sorted order. Create `src/lib/ui/previewSortContract.test.ts` to verify that the Svelte page supplies `sortInvoiceRows` and its draft snapshot builder to `prepareInvoicePreview`, and that the manual button uses the same sort action.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/lib/ui/preview.test.ts src/lib/ui/previewSortContract.test.ts
```

Expected: FAIL because `prepareInvoicePreview()` and the shared Svelte Preview wiring do not exist.

- [ ] **Step 3: Share the explicit editor sort between the button and Preview**

In `src/routes/+page.svelte`, add this function after `buildDraft()`:

```ts
  function sortInvoiceRows() {
    const sorted = sortInvoiceSections(completed, noshow);
    completed = sorted.completed;
    noshow = sorted.noshow;
  }
```

Create `src/lib/ui/preview.ts`:

```ts
export type PreviewPreparation<T> = {
  sortRows: () => void;
  buildSnapshot: () => T;
};

export function prepareInvoicePreview<T>({
  sortRows,
  buildSnapshot,
}: PreviewPreparation<T>): T {
  sortRows();
  return buildSnapshot();
}
```

In `openPreview()`, capture the click-time settings and sequence, then pass the shared sort action and snapshot builder through the tested transition:

```ts
  async function openPreview() {
    const currentSettings = settings;
    const draftSeq = seqState.draftSeq;
    if (!currentSettings) return;
    if (seqState.status !== 'ready' || draftSeq === null) return;
    previewSnap = prepareInvoicePreview({
      sortRows: sortInvoiceRows,
      buildSnapshot: () => buildFinalizedSnapshot(buildDraft(), currentSettings, draftSeq),
    });
    showPreview = true;
  }
```

Replace the sort button's inline `onclick` block with:

```svelte
      onclick={sortInvoiceRows}
```

- [ ] **Step 4: Update the user guide**

Replace the date-order paragraph in `USER_GUIDE.md` with:

```markdown
Rows stay exactly where they are while you type. When you are ready, click **Sort rows by date** to arrange Completed Inspections and No-Shows separately from oldest to newest. Opening Preview also sorts the visible rows first, so closing Preview returns to the same order you reviewed. Lock & Save uses this date order automatically. Rows from the same day stay in their current order.
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/lib/ui/preview.test.ts src/lib/ui/previewSortContract.test.ts
```

Expected: both focused tests pass.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test
npm run check
npm run build
```

Expected: all tests pass, Svelte reports 0 errors and 0 warnings, and the production build exits 0.

- [ ] **Step 7: Commit the behavior revision**

```bash
git add src/lib/ui/preview.ts src/lib/ui/preview.test.ts src/lib/ui/previewSortContract.test.ts src/routes/+page.svelte USER_GUIDE.md
git commit -m "Keep invoice editor aligned with preview"
```

### Task 2: Review Loops and Final Gate

**Files:**
- Review the complete range from design revision `180a407` through the implementation head.
- Modify only files required to address verified findings.

**Interfaces:**
- Consumes: Task 1 and the revised design spec.
- Produces: a reviewer-approved Preview/editor alignment change ready for integration.

- [ ] **Step 1: Request an independent read-only review**

Review `180a407..HEAD` against:

- `docs/superpowers/specs/2026-07-14-invoice-row-date-sorting-design.md`;
- `docs/superpowers/plans/2026-07-15-preview-sorts-editor.md`; and
- the explicit requirement that Preview sorts visible editor state before snapshot construction and leaves the editor matching the reviewed order.

- [ ] **Step 2: Resolve every valid finding with TDD**

For each finding that affects correctness, accessibility, clarity, or regression risk:

1. Add or strengthen the smallest failing regression test.
2. Run it and confirm the expected RED failure.
3. Apply the smallest production fix.
4. Run the focused test and full suite to confirm GREEN.
5. Commit the fix with a specific message.

- [ ] **Step 3: Repeat review until clean**

Request a fresh review after fixes. Repeat Step 2 until a reviewer reports no Critical or Important issues and assesses the revision ready to merge.

- [ ] **Step 4: Run the fresh final verification gate**

Run:

```bash
git diff --check 180a407..HEAD
npm test
npm run check
npm run build
git status --short --branch
```

Expected: no whitespace errors, all tests pass, Svelte reports 0 errors and 0 warnings, the production build exits 0, and the worktree has no uncommitted implementation changes.

## Plan Self-Review

- Spec coverage: Task 1 covers the visible Preview/editor order, shared control path, behavioral transition test, Svelte wiring contract, and user documentation; Task 2 covers repeated review and final verification.
- Completeness scan: no unresolved markers, deferred implementation text, or undefined interfaces remain.
- Type consistency: `EditorRow` satisfies the existing generic `sortInvoiceSections<T extends { date: string }>` contract, and the Svelte assignments preserve `EditorRow[]` types.
- Scope: no live sorting, schema change, new dependency, drag-and-drop behavior, or unrelated refactor is included.
