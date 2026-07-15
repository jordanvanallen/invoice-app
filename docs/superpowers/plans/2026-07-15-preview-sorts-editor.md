# Preview Sorts the Invoice Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Preview sort the visible Completed and No-Show editor sections before rendering so closing Preview returns to the same order the user reviewed.

**Architecture:** Reuse the existing tested `sortInvoiceSections()` helper through one Svelte `sortInvoiceRows()` function shared by the manual sort button and `openPreview()`. A source-contract regression test verifies that Preview invokes this function before snapshot construction; the existing unit, database, snapshot, Svelte, and build checks cover the underlying behavior and integration boundaries.

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

- Create `src/lib/ui/previewSortContract.test.ts`: assert the Svelte Preview handler sorts visible rows before snapshot construction.
- Modify `src/routes/+page.svelte`: share one explicit editor-sort function between the button and Preview.
- Modify `USER_GUIDE.md`: explain that Preview leaves the editor matching the reviewed order.

### Task 1: Align Preview and Editor Order

**Files:**
- Create: `src/lib/ui/previewSortContract.test.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `USER_GUIDE.md`

**Interfaces:**
- Consumes: `sortInvoiceSections<T extends { date: string }>(completed, noshow)` from `src/lib/lineOrder.ts`.
- Produces: `sortInvoiceRows(): void`, used by both the manual sort button and `openPreview()`.

- [ ] **Step 1: Write the failing Preview ordering contract test**

Create `src/lib/ui/previewSortContract.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

describe('invoice Preview sorting contract', () => {
  test('sorts visible editor rows before building the Preview snapshot', () => {
    const page = readFileSync('src/routes/+page.svelte', 'utf8');
    const sortStart = page.indexOf('function sortInvoiceRows()');
    const sortEnd = page.indexOf('\n  }', sortStart);
    const previewStart = page.indexOf('async function openPreview()');
    const previewEnd = page.indexOf('\n  }', previewStart);

    expect(sortStart).toBeGreaterThan(-1);
    expect(previewStart).toBeGreaterThan(-1);

    const sortHandler = page.slice(sortStart, sortEnd);
    const previewHandler = page.slice(previewStart, previewEnd);
    const sortCall = previewHandler.indexOf('sortInvoiceRows();');
    const snapshotCall = previewHandler.indexOf('previewSnap = buildFinalizedSnapshot');

    expect(sortHandler).toContain('sortInvoiceSections(completed, noshow)');
    expect(sortHandler).toContain('completed = sorted.completed');
    expect(sortHandler).toContain('noshow = sorted.noshow');
    expect(sortCall).toBeGreaterThan(-1);
    expect(snapshotCall).toBeGreaterThan(-1);
    expect(sortCall).toBeLessThan(snapshotCall);
    expect(page).toContain('onclick={sortInvoiceRows}');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/lib/ui/previewSortContract.test.ts
```

Expected: FAIL because `sortInvoiceRows()` does not exist and `openPreview()` does not sort the visible editor before snapshot construction.

- [ ] **Step 3: Share the explicit editor sort between the button and Preview**

In `src/routes/+page.svelte`, add this function after `buildDraft()`:

```ts
  function sortInvoiceRows() {
    const sorted = sortInvoiceSections(completed, noshow);
    completed = sorted.completed;
    noshow = sorted.noshow;
  }
```

In `openPreview()`, call it after the readiness guards and before snapshot construction:

```ts
  async function openPreview() {
    if (!settings) return;
    if (seqState.status !== 'ready' || seqState.draftSeq === null) return;
    sortInvoiceRows();
    previewSnap = buildFinalizedSnapshot(buildDraft(), settings, seqState.draftSeq);
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
npm test -- src/lib/ui/previewSortContract.test.ts
```

Expected: 1 test passes.

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
git add src/lib/ui/previewSortContract.test.ts src/routes/+page.svelte USER_GUIDE.md
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

- Spec coverage: Task 1 covers the visible Preview/editor order, shared control path, regression test, and user documentation; Task 2 covers repeated review and final verification.
- Completeness scan: no unresolved markers, deferred implementation text, or undefined interfaces remain.
- Type consistency: `EditorRow` satisfies the existing generic `sortInvoiceSections<T extends { date: string }>` contract, and the Svelte assignments preserve `EditorRow[]` types.
- Scope: no live sorting, schema change, new dependency, drag-and-drop behavior, or unrelated refactor is included.
