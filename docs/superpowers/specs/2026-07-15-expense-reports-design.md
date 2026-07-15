# Expense Reports Design

## Goal

Add a simple expense-report workflow that feels like the existing invoice workflow. A user can build one autosaved report from dated expense rows, deliberately sort and preview it, finalize it into an immutable PDF, and manage finalized or cancelled reports from a dedicated history screen.

Consistency and ease of use take priority over adding accounting features. The first version records only the total amount paid for each expense; it does not calculate or track tax.

## Chosen Approach

Create a dedicated expense-report domain with its own tables, repository, routes, snapshots, PDF, and history screen. Reuse or extract only focused lifecycle behavior that is genuinely shared with invoices, such as sequence validation, autosave coordination, stable date ordering, status transitions, confirmation patterns, and PDF save feedback.

Do not store expenses in the invoice tables. Invoice-only concepts such as clients, inspection numbers, VINs, mileage, no-shows, billing totals, and HST must not leak into expense records.

## Navigation and Routes

Add two top-level sidebar entries for now:

- **New Expense Report** at `/expenses`
- **Expense History** at `/expense-history`

Add a read-only detail route at `/expense/[id]` for viewing and managing a finalized or cancelled report.

Keep the current **History** item for invoices unchanged. Combining the two history links under a collapsible parent is explicitly deferred.

## Draft Editor

The expense editor follows the New Invoice page's interaction model:

- The full expense report is one autosaved draft, not a collection of independently saved expenses.
- On launch, reopen the most recently created expense draft when one exists.
- Show the existing save-status feedback so the user can tell when autosave is complete.
- Never reorder rows merely because a date was edited or a row was added.
- Use large, clearly labelled controls and reuse the application's existing form, confirmation, date-picker, money-entry, and accessibility patterns.

The header contains:

- **Expense Report #** with an editable sequence and year;
- **Reporting period** start and end dates; and
- **Report date**.

Each expense row contains exactly:

- **Date**;
- **Description**; and
- **Total Amount**.

The page supports adding and removing rows. The running total is the sum of the row amounts. Money is converted to integer cents at the input boundary and stored only as integer cents; floating-point dollar values are never persisted.

## Numbering

Expense reports have an independent yearly sequence. Their numbers use the same visible `sequence-year` format as invoices, such as `11-2026`, but invoice and expense sequences do not consume or block one another.

The sequence control behaves like the existing editable invoice-number control:

- A new draft defaults to the next available expense-report sequence for the report-date year.
- The user may enter a different positive integer before finalization, including skipping ahead when starting mid-year.
- Preview and confirmation show the exact selected report number.
- A manually selected number already used by another expense report in that year is rejected.
- Finalizing a manually selected number advances the expense counter to at least that value, so finalizing `11-2026` makes `12-2026` the next default.
- Changing the report date to another year loads that year's next default unless the user has deliberately edited the current draft's sequence, matching invoice behavior.
- Cancelled reports continue to reserve their original numbers. Permanent deletion does not move a counter backward or make old numbers automatically reusable.

## Ordering, Preview, and Finalization

Provide a clearly labelled **Sort rows by date** button near the expense rows. It sorts from oldest to newest only when clicked.

The shared expense ordering rule is:

- valid dates sort oldest to newest;
- rows with equal dates keep their current relative order;
- blank dates sort after dated rows; and
- sorting returns a new array rather than mutating its input.

The rows' existing `position` values represent same-day order, so no additional tie-breaker column or drag-and-drop feature is needed.

Preview builds a sorted snapshot without mutating or visibly rearranging the open editor. Closing Preview returns the user to the same editing order.

Finalization performs the following steps as one deliberate workflow:

1. Settle any pending autosave.
2. Validate the header, sequence, and every expense row.
3. Save rows in canonical date order with recalculated positions.
4. Reserve the selected yearly expense sequence.
5. Build and persist the immutable finalized snapshot and total in one database transaction.
6. Generate the expense-report PDF from that stored snapshot.
7. Trigger the existing post-finalization backup behavior.

The snapshot builder applies date ordering defensively as a boundary guarantee, even if a future caller finalizes without using the page's sort action.

## Finalized Snapshot and PDF

A finalized expense snapshot freezes everything needed for an identical future reprint:

- report number, sequence, year, report date, and reporting period;
- the business name, address, inspector number, and logo currently stored in Settings;
- all expense rows in canonical order; and
- the total amount.

Do not include invoice-specific bill-to, payment, inspection, or HST fields. Later Settings changes must not alter previously finalized expense-report PDFs.

The PDF and on-screen finalized view use the same snapshot and presentation component. The document shows the identifying header, the Date/Description/Amount table, and a single report total. Finalization automatically offers to save the PDF, and the report can be downloaded again from its detail page.

## Expense History and Lifecycle Controls

Expense History mirrors the simple, familiar parts of invoice History:

- Group finalized reports by report-date year, newest year first.
- Show each report number, report date, and total.
- Show a yearly count and total using finalized reports only.
- Search finalized reports by report number, report date, or expense description.
- Open a report to view it or download its PDF.
- Duplicate a finalized or cancelled report into a new editable draft with a fresh, unreserved report number.

Duplicating copies the expense rows and amounts but creates a new draft header using the normal current-period defaults, matching the invoice duplication model. The user can adjust any copied values before finalizing.

Lifecycle controls match invoices:

- **Cancel expense report** changes `finalized` to `void` after destructive confirmation. The report remains stored but is excluded from normal History and totals.
- Cancelled reports appear in a separate collapsible **Cancelled** section.
- **Restore** changes `void` back to `finalized`, preserving the original number, snapshot, and PDF contents.
- **Delete permanently** is available only for a cancelled report and requires a second explicit destructive confirmation. It deletes the report and its expense items but never rewinds numbering.
- Finalized reports cannot be edited in place. **Duplicate** is the safe way to create a revised report.

## Data Model and Migration

Add one append-only schema migration containing three dedicated tables:

### `expense_year_counters`

- `year` integer primary key
- `last_seq` positive integer counter state

### `expense_reports`

- `id` integer primary key
- `year` integer
- nullable `seq` for drafts and required-by-lifecycle sequence for finalized reports
- `status` constrained to `draft`, `finalized`, or `void`
- `report_date`, `period_start`, and `period_end` ISO date strings
- nullable `finalized_at`
- `total_cents` integer
- nullable `snapshot_json`
- unique `(year, seq)` constraint

### `expense_items`

- `id` integer primary key
- `expense_report_id` foreign key with cascading delete
- `position` integer
- `date` ISO date string
- `description` text
- `amount_cents` integer

Add indexes for report-year/history queries and item lookup by report. Existing shipped migrations remain untouched.

Backups already copy the entire SQLite database, so the new tables are included automatically. Restore validation must be schema-version aware: a version-4-or-newer candidate must contain the expense tables, while a valid pre-expense backup remains acceptable and receives the new migration when the restored database opens after relaunch. The restore confirmation summary shows finalized expense-report count and latest report date when those tables are present, using zero/none for an older backup. Tests must verify both backward-compatible restoration and preservation of expense data. Backups from a schema newer than the running app remain rejected.

## Component and Code Boundaries

Keep the feature separated into small, testable units:

- Expense domain types describe drafts, rows, list items, rollups, and finalized snapshots.
- A pure expense-order helper owns stable chronological ordering and position normalization.
- Pure validation and total helpers own row completeness, sequence rules, period checks, and integer-cent summation.
- An expense repository owns draft persistence, independent numbering, transactions, history queries, duplication, and lifecycle status changes.
- A snapshot builder freezes settings and ordered rows.
- An expense PDF document builder renders snapshots without querying live data.
- Expense editor, view, and history components handle presentation and call these boundaries.

Reuse existing generic primitives where their contracts already fit. If invoice code contains a small reusable rule but is named or coupled specifically to invoices, extract a narrowly generic helper with regression tests for invoices. Do not build a speculative generic "document framework" in this feature.

## Validation and Error Behavior

Draft autosave accepts partially entered rows so normal typing is never blocked. Finalization requires:

- a valid positive, unused integer sequence;
- a report date;
- reporting-period start and end dates in chronological order;
- at least one expense row;
- a date and non-empty description on every row; and
- a valid amount greater than zero on every row.

A row date outside the reporting period receives the same visible warning style used by invoice rows. Missing or invalid required values prevent finalization and provide a plain-language message with focus or navigation to the first problem row. Preview remains available once there is at least one row and the sequence is valid, even while other draft details are incomplete.

Repository-level validation repeats critical invariants so a future non-UI caller cannot finalize invalid or duplicate-numbered data. Failed finalization leaves the report as a draft and does not partially reserve a number or persist a partial snapshot. Save, PDF, history, cancel, restore, delete, and duplication failures display actionable error feedback without silently discarding the draft.

All finalization, duplication, and destructive actions guard against repeated clicks while work is in progress. Cancel, restore, and delete operations only transition from their expected current status.

## Testing and Review

Implementation uses test-driven development. Add focused tests for:

### Pure domain behavior

- integer-cent total calculation, including several rows and zero rows;
- oldest-to-newest stable date ordering;
- equal-date stability, blank dates last, recalculated positions, and input immutability;
- draft versus finalization validation and clear missing-field results;
- snapshot ordering, total calculation, and freezing of business identity/logo;
- invoice behavior remaining unchanged if any helper is shared or extracted.

### Repository and migration behavior

- migrating an existing version-3 database creates the new tables without changing invoice data;
- a fresh database reaches the new schema version;
- draft create/save/load and most-recent-draft reopening;
- incomplete draft persistence;
- independent invoice and expense counters for the same year;
- manual mid-year sequence selection, next-number advancement, duplicate rejection, year changes, and cancelled-number reservation;
- transactional finalization with canonical persisted order and frozen snapshot;
- rollback when finalization fails;
- history grouping, search, yearly totals, and exclusion of cancelled reports;
- duplicate, cancel, restore, status-guard, and permanent-delete behavior;
- backup validation accepts the new schema and preserved expense data;
- a valid pre-expense backup remains restorable and migrates forward on open; and
- a version claiming the expense schema but missing expense tables is rejected.

### Presentation and PDF behavior

- editor autosave and explicit sorting interactions;
- preview sorting without editor mutation;
- finalization blockers and confirmation flow;
- sidebar navigation and expense routes;
- expense history actions and cancelled section;
- PDF content, chronological row order, total, page generation, and stable snapshot-based reprints;
- accessible labels, keyboard operation, focus handling, large controls, and destructive confirmations.

Run the entire existing unit suite throughout implementation. Before completion, run the unit tests, Svelte/type checks, production build, Rust/Tauri checks, and any existing release-workflow checks. Then perform a review loop covering correctness, regression risk, usability consistency, accessibility, data migration/backup safety, and PDF visual quality. Fix every substantive issue and rerun the relevant focused and full verification suites.

## Out of Scope

- Separate subtotal, tax, tip, category, vendor, receipt, payment method, or reimbursement fields.
- Automatic tax calculation or tax reporting.
- Drag-and-drop or manual same-day reordering controls.
- Live row sorting while editing.
- Multiple sort directions or user-defined secondary sorting.
- Editing a finalized report in place.
- Sharing invoice and expense database tables.
- A generic document framework.
- A combined or collapsible History navigation parent.
- Expense analytics beyond report counts, report totals, and simple search.
