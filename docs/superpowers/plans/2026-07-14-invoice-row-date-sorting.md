# Invoice Row Date Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add predictable, action-triggered chronological sorting for completed and no-show invoice rows while guaranteeing sorted previews, persisted final positions, finalized snapshots, and PDFs.

**Architecture:** A pure shared ordering module owns all date and section-order rules. The Svelte editor calls it only from the explicit sort button and final-save action, while finalized snapshot construction calls it defensively for preview, finalization, PDF, and reprint consistency. Existing `position` values persist the result, so no schema change is needed.

**Tech Stack:** TypeScript 5.6, Svelte 5 runes, SvelteKit 2, Vitest 4, SQLite through the existing database adapters, pdfmake.

## Global Constraints

- Completed inspections and no-shows remain separate lists.
- Sort each list from oldest to newest.
- Never sort reactively while the user edits a date or adds a row.
- Preserve the current relative order for equal dates.
- Place blank dates after dated rows.
- Use the existing `position` field; do not add a database column or migration.
- Preview must be sorted without rearranging the open editor.
- Lock & Save must persist sorted positions and finalized snapshots.
- Do not add drag-and-drop, up/down controls, sort-direction settings, or secondary tie-breakers.
- Use one clearly labelled `Sort rows by date` button, not an icon-only control.

---

## File Structure

- Create `src/lib/lineOrder.ts`: pure, non-mutating date and invoice-section ordering helpers.
- Create `src/lib/lineOrder.test.ts`: focused ordering, stability, blank-date, position, and immutability tests.
- Modify `src/lib/snapshot.ts`: enforce canonical ordering at the immutable snapshot boundary.
- Modify `src/lib/snapshot.test.ts`: prove snapshot ordering and source-draft immutability.
- Modify `src/lib/db/invoice-repo.test.ts`: prove finalization stores and reprints the canonical snapshot.
- Modify `src/routes/+page.svelte`: add the explicit editor action and persist canonical positions on final save.
- Modify `USER_GUIDE.md`: document the button and automatic preview/final ordering.

### Task 1: Pure Invoice Line Ordering

**Files:**
- Create: `src/lib/lineOrder.ts`
- Create: `src/lib/lineOrder.test.ts`

**Interfaces:**
- Consumes: `LineItem` and `LineType` from `src/lib/types.ts`.
- Produces: `sortRowsByDate<T extends { date: string }>(rows: readonly T[]): T[]` and `orderInvoiceLines(lines: readonly LineItem[]): LineItem[]`.

- [ ] **Step 1: Write the failing ordering tests**

Create `src/lib/lineOrder.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { orderInvoiceLines, sortRowsByDate } from './lineOrder';
import type { LineItem, LineType } from './types';

function line(
  inspectionNumber: string,
  date: string,
  type: LineType = 'completed',
  position = 0,
): LineItem {
  return {
    type,
    position,
    inspectionNumber,
    clientId: null,
    clientName: 'Test Client',
    locationId: null,
    location: 'Test Location',
    date,
    vin8: '12345678',
    mileageCents: 0,
    feeCents: 3800,
  };
}

describe('sortRowsByDate', () => {
  test('sorts oldest to newest, keeps equal dates stable, and puts blanks last', () => {
    const rows = [
      line('same-1', '2026-07-12'),
      line('blank-1', ''),
      line('newest', '2026-07-14'),
      line('same-2', '2026-07-12'),
      line('oldest', '2026-07-10'),
      line('blank-2', ''),
    ];

    const sorted = sortRowsByDate(rows);

    expect(sorted.map((row) => row.inspectionNumber)).toEqual([
      'oldest', 'same-1', 'same-2', 'newest', 'blank-1', 'blank-2',
    ]);
    expect(rows.map((row) => row.inspectionNumber)).toEqual([
      'same-1', 'blank-1', 'newest', 'same-2', 'oldest', 'blank-2',
    ]);
    expect(sorted).not.toBe(rows);
  });
});

describe('orderInvoiceLines', () => {
  test('orders completed and no-show sections independently and rewrites positions', () => {
    const lines = [
      line('completed-new', '2026-07-14', 'completed', 8),
      line('noshow-new', '2026-07-13', 'noshow', 3),
      line('completed-old', '2026-07-10', 'completed', 6),
      line('noshow-old', '2026-07-09', 'noshow', 2),
    ];

    const ordered = orderInvoiceLines(lines);

    expect(ordered.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(ordered.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(lines.map((row) => row.position)).toEqual([8, 3, 6, 2]);
    expect(ordered[0]).not.toBe(lines[2]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/lib/lineOrder.test.ts
```

Expected: FAIL because `./lineOrder` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

Create `src/lib/lineOrder.ts`:

```ts
import type { LineItem, LineType } from './types';

export function sortRowsByDate<T extends { date: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (!a.row.date && !b.row.date) return a.index - b.index;
      if (!a.row.date) return 1;
      if (!b.row.date) return -1;
      return a.row.date.localeCompare(b.row.date) || a.index - b.index;
    })
    .map(({ row }) => row);
}

export function orderInvoiceLines(lines: readonly LineItem[]): LineItem[] {
  const sectionOrder: LineType[] = ['completed', 'noshow'];
  const ordered = sectionOrder.flatMap((type) =>
    sortRowsByDate(lines.filter((line) => line.type === type)),
  );
  return ordered.map((line, position) => ({ ...line, position }));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/lib/lineOrder.test.ts
```

Expected: 2 tests pass with no warnings or errors.

- [ ] **Step 5: Run the full unit suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit the pure ordering unit**

```bash
git add src/lib/lineOrder.ts src/lib/lineOrder.test.ts
git commit -m "Add stable invoice row date ordering"
```

### Task 2: Snapshot and Finalization Boundary Guarantee

**Files:**
- Modify: `src/lib/snapshot.ts`
- Modify: `src/lib/snapshot.test.ts`
- Modify: `src/lib/db/invoice-repo.test.ts`

**Interfaces:**
- Consumes: `orderInvoiceLines(lines)` from Task 1.
- Produces: every `FinalizedSnapshot.lines` array is completed-first, no-show-second, chronologically ordered within each section, and reindexed.

- [ ] **Step 1: Write a failing snapshot-order test**

Add this test inside `describe('buildFinalizedSnapshot', ...)` in `src/lib/snapshot.test.ts`:

```ts
  test('orders each invoice section by date without mutating the draft', () => {
    const source = draft();
    source.lines = [
      { ...completed(), inspectionNumber: 'completed-new', date: '2026-05-27', position: 0 },
      { ...completed(), type: 'noshow', inspectionNumber: 'noshow-new', date: '2026-05-26', position: 1 },
      { ...completed(), inspectionNumber: 'completed-old', date: '2026-05-21', position: 2 },
      { ...completed(), type: 'noshow', inspectionNumber: 'noshow-old', date: '2026-05-20', position: 3 },
    ];

    const snap = buildFinalizedSnapshot(source, settings(), 8);

    expect(snap.lines.map((line) => line.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(snap.lines.map((line) => line.position)).toEqual([0, 1, 2, 3]);
    expect(source.lines.map((line) => line.inspectionNumber)).toEqual([
      'completed-new', 'noshow-new', 'completed-old', 'noshow-old',
    ]);
  });
```

- [ ] **Step 2: Write a failing repository finalization/reprint test**

Add this test to `src/lib/db/invoice-repo.test.ts` near the existing finalization tests:

```ts
  test('finalize stores a date-ordered snapshot that reprints identically', async () => {
    const db = await freshDb();
    const id = await createDraft(db, {
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
    });
    await saveDraft(db, id, {
      seq: null,
      year: 2026,
      issueDate: '2026-07-14',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-14',
      lines: [
        line({ inspectionNumber: 'completed-new', date: '2026-07-14', position: 0 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-new', date: '2026-07-13', position: 1 }),
        line({ inspectionNumber: 'completed-old', date: '2026-07-01', position: 2 }),
        line({ type: 'noshow', inspectionNumber: 'noshow-old', date: '2026-07-02', position: 3 }),
      ],
    });

    const finalized = await finalizeInvoice(db, id);
    const reprinted = await reprintSnapshot(db, id);

    expect(finalized.lines.map((row) => row.inspectionNumber)).toEqual([
      'completed-old', 'completed-new', 'noshow-old', 'noshow-new',
    ]);
    expect(reprinted.lines).toEqual(finalized.lines);
  });
```

- [ ] **Step 3: Run both focused files and verify RED**

Run:

```bash
npm test -- src/lib/snapshot.test.ts src/lib/db/invoice-repo.test.ts
```

Expected: the two new tests fail because snapshot construction still preserves incoming order.

- [ ] **Step 4: Enforce ordering in snapshot construction**

Modify `src/lib/snapshot.ts`:

```ts
import type { DraftInvoice, FinalizedSnapshot, Settings } from './types';
import { orderInvoiceLines } from './lineOrder';
import { computeTotals } from './totals';
import { formatInvoiceNumber } from './numbering';

export function buildFinalizedSnapshot(
  draft: DraftInvoice,
  settings: Settings,
  seq: number,
): FinalizedSnapshot {
  const lines = orderInvoiceLines(draft.lines);
  const totals = computeTotals(lines, settings.taxRateBp);

  return {
    invoiceNumber: formatInvoiceNumber(seq, draft.year),
    seq,
    year: draft.year,
    issueDate: draft.issueDate,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    inspectorName: settings.inspectorName,
    inspectorAddress: settings.inspectorAddress,
    inspectorNumber: settings.inspectorNumber,
    gstHstRegistrationNumber: settings.gstHstRegistrationNumber,
    billToName: settings.billToName,
    billToAddress: settings.billToAddress,
    registered: settings.registered,
    taxRateBp: settings.taxRateBp,
    paymentEmail: settings.paymentEmail,
    footerNotes: settings.footerNotes,
    logoDataUrl: settings.logoDataUrl,
    lines,
    totals,
  };
}
```

- [ ] **Step 5: Run focused and full tests and verify GREEN**

Run:

```bash
npm test -- src/lib/snapshot.test.ts src/lib/db/invoice-repo.test.ts
npm test
```

Expected: all tests pass with no warnings or errors.

- [ ] **Step 6: Commit the boundary guarantee**

```bash
git add src/lib/snapshot.ts src/lib/snapshot.test.ts src/lib/db/invoice-repo.test.ts
git commit -m "Sort invoice rows in finalized snapshots"
```

### Task 3: Explicit Editor Action and Sorted Final Persistence

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `USER_GUIDE.md`

**Interfaces:**
- Consumes: `sortRowsByDate()` for the manual editor action and `orderInvoiceLines()` for the final draft save.
- Produces: a visible `Sort rows by date` action, sorted preview snapshots, and persisted canonical positions before finalization.

- [ ] **Step 1: Import the shared helpers**

Add this import to `src/routes/+page.svelte`:

```ts
  import { orderInvoiceLines, sortRowsByDate } from '$lib/lineOrder';
```

- [ ] **Step 2: Persist canonical positions during Lock & Save**

In `doFinalize()`, replace the final draft save:

```ts
      await saveDraft(db, invoiceId, buildDraft());
```

with:

```ts
      const draft = buildDraft();
      draft.lines = orderInvoiceLines(draft.lines);
      await saveDraft(db, invoiceId, draft);
```

This sorts the data being committed without causing editor rows to move during ordinary editing. `buildFinalizedSnapshot()` independently enforces the same order for defense in depth.

- [ ] **Step 3: Add the explicit sort control**

Immediately before `<div class="sections">`, add:

```svelte
  <div class="row-tools">
    <button
      type="button"
      class="sort-rows"
      disabled={completed.length < 2 && noshow.length < 2}
      onclick={() => {
        completed = sortRowsByDate(completed);
        noshow = sortRowsByDate(noshow);
      }}
    >Sort rows by date</button>
  </div>
```

The existing keyed `{#each rows as row, i (row.uid)}` block in `InvoiceSection.svelte` preserves each row's component/input identity when the explicit action changes array order.

- [ ] **Step 4: Add accessible, visually consistent control styling**

Add these rules to the `<style>` block in `src/routes/+page.svelte` near `.sections`:

```css
  .row-tools { display: flex; justify-content: flex-end; margin: 0 0 var(--sp-3); }
  .sort-rows { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong);
    border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong);
    font-size: var(--fs-sm); font-weight: 600; cursor: pointer; }
  .sort-rows:hover:not(:disabled) { background: var(--accent-tint); }
  .sort-rows:disabled { color: var(--text-muted); cursor: default; opacity: .65; }
```

- [ ] **Step 5: Document the behavior**

In `USER_GUIDE.md`, add this paragraph after the completed/no-show entry instructions and before totals:

```markdown
**Put rows in date order**

Rows stay exactly where they are while you type. When you are ready, click **Sort rows by date** to arrange Completed Inspections and No-Shows separately from oldest to newest. Preview and Lock & Save also use this date order automatically. Rows from the same day stay in their current order.
```

- [ ] **Step 6: Run static and production verification**

Run:

```bash
npm run check
npm run build
npm test
```

Expected: Svelte reports 0 errors and 0 warnings, the production build exits 0, and all tests pass.

- [ ] **Step 7: Manually verify the user flow in the browser**

Start the app with `npm run dev -- --host 127.0.0.1`, then verify:

1. Add at least three Completed rows with dates in nonchronological order and two No-Show rows in nonchronological order.
2. Edit dates and confirm no row moves while typing or selecting a date.
3. Click **Sort rows by date** and confirm only then do both sections reorder oldest-to-newest.
4. Give two rows the same date and confirm they retain their prior relative order after sorting.
5. Reorder the draft again by editing dates, open Preview, and confirm Preview is sorted while closing it returns to the unchanged editor order.
6. Lock & Save and confirm the final invoice/PDF view is sorted in both sections.
7. Reopen or reprint the finalized invoice and confirm the same ordering remains.

- [ ] **Step 8: Commit the complete user-facing feature**

```bash
git add src/routes/+page.svelte USER_GUIDE.md
git commit -m "Add explicit invoice row date sorting"
```

### Task 4: Review Loops and Final Regression Gate

**Files:**
- Review all files changed since the design-spec commit.
- Modify only files necessary to address verified findings.

**Interfaces:**
- Consumes: the complete implementation from Tasks 1-3 and the approved design spec.
- Produces: a reviewer-approved, regression-tested feature ready for integration.

- [ ] **Step 1: Run the first independent code-review pass**

Request a read-only reviewer against the range from `c56d13d` to current `HEAD`, supplying:

- approved design: `docs/superpowers/specs/2026-07-14-invoice-row-date-sorting-design.md`;
- implementation plan: `docs/superpowers/plans/2026-07-14-invoice-row-date-sorting.md`; and
- requirements: explicit-only editor movement, separate chronological sections, stable equal dates, sorted preview/final persistence/snapshot, no migration, no drag-and-drop.

- [ ] **Step 2: Resolve every Critical and Important finding with TDD**

For each valid finding:

1. Add or strengthen the smallest failing regression test.
2. Run it and confirm the expected RED failure.
3. Apply the smallest production fix.
4. Run the focused test and the full suite to confirm GREEN.
5. Commit the fix with a specific message.

If a finding is invalid, record the concrete code/test evidence showing why before declining it.

- [ ] **Step 3: Repeat review until clean**

Request another independent review of the updated range. Repeat Step 2 until a reviewer reports no Critical or Important issues and assesses the feature ready to merge. Minor findings that affect correctness, accessibility, clarity, or regression risk must also be fixed; purely stylistic preferences may be documented without churn.

- [ ] **Step 4: Run the fresh final verification gate**

Run:

```bash
git diff --check c56d13d..HEAD
npm test
npm run check
npm run build
git status --short --branch
```

Expected: no whitespace errors, all tests pass, Svelte reports 0 errors and 0 warnings, the production build exits 0, and the worktree contains no uncommitted implementation changes.

## Plan Self-Review

- Spec coverage: Tasks 1-3 cover every ordering, interaction, persistence, snapshot, testing, and documentation requirement; Task 4 covers the requested repeated review gate.
- Completeness scan: no unresolved markers, deferred implementation text, or undefined interfaces remain.
- Type consistency: both consumers use the Task 1 signatures exactly; `EditorRow` satisfies `{ date: string }`, and `DraftInvoice.lines` satisfies `readonly LineItem[]`.
- Scope: no schema, drag-and-drop, live sorting, new dependency, or unrelated refactor is included.
