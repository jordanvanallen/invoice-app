# Mileage Approval Design

## Goal

Require auditable approval details whenever an invoice line bills a non-zero mileage fee. The invoice editor must collect who approved the mileage and when, preserve that evidence on the finalized invoice, and print it directly beneath the affected invoice line.

The feature applies to any completed-inspection or no-show line whose `mileageCents` is greater than zero.

## Chosen Approach

Add a first-class **Approvers** catalog and store one approver plus one approval date on each invoice line. This deliberately avoids a separate approval-event model until the product needs multiple approvers, workflow statuses, notes, or approval change history.

The approver selector follows the existing client and location interaction: fuzzy search, exact selection, and an inline **Add new approver** result. Unlike the existing client/location fields, a free-typed but unlinked approver name does not satisfy finalization.

## Editor Experience

Entering a mileage amount greater than `$0.00` automatically expands an approval strip directly beneath that invoice row. The strip contains:

- **Approved by** — a fuzzy-search selector backed by active Approvers catalog entries, with quick-add;
- **Approval date** — the existing date-picker control, initially blank; and
- a clear **Mileage approval required** heading while either value is incomplete.

Disclosure behavior is deterministic:

- a transition from zero to non-zero mileage renders the strip expanded without moving focus from the Mileage field;
- incomplete or invalid approval is always expanded and has no collapse action;
- completing both fields leaves the strip expanded until the user explicitly collapses it;
- complete rows loaded from a draft start collapsed;
- changing one positive mileage value to another preserves the current disclosure state;
- returning from zero to positive starts expanded and restores retained values; and
- any collapsed approval that becomes incomplete reopens without stealing focus.

The collapsed summary is a real button reading `Approved by Jordan Lee · Jul 18, 2026`. It exposes `aria-expanded` and `aria-controls`, and toggling it leaves focus on that button.

Changing a non-zero mileage amount to another value retains its approval. Setting mileage to `$0.00` hides the strip, removes its validation requirement, and prevents the approval from printing, but keeps the approval values in that draft. Restoring a non-zero mileage amount in the same draft reveals the retained values again.

The row's stable `uid` remains the UI identity for disclosure state. Disclosure state is editor-only and is not persisted.

The approval strip is a `grid-column: 1 / -1` child beneath the existing eight primary row controls; it does not add another main-row column or shrink those controls. Approved by and Approval date sit side-by-side only while both retain usable widths, then stack to one column based on the card's available width. The layout and both popovers must remain usable at the app's 900px minimum window width and at standard, large, and extra-large text settings. The fuzzy menu must escape the card's clipping boundary, including on the final row.

### Keyboard, Focus, and Errors

Approved by has a visible label and accessible combobox semantics: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`. Arrow keys move the active option, Enter selects or quick-adds, Escape closes, and Tab leaves without committing. When mileage is non-zero, Approved by is required. If its ID is null or its name is blank—including an untouched blank field—it uses `aria-invalid="true"`, is associated with its actionable error through `aria-describedby`, and displays `Select a saved approver or choose Add new approver.` It must not reuse the client/location message that promises free text will print. A valid linked value removes the invalid state.

While Approval date is blank or invalid, its button uses `aria-invalid="true"`, includes `required` in its accessible name, and references its actionable error through `aria-describedby`; a valid date removes the invalid state. Jump-to-first-blocker first expands the strip, then focuses the Approved by input when it is invalid; otherwise it focuses the Approval date button. Automatic expansion never moves focus.

## Approvers Catalog

Add an **Approvers** item to the app navigation and an `/approvers` management page using the established catalog presentation. The catalog supports:

- case-insensitive unique names;
- quick-add from an invoice row;
- rename;
- active/inactive status;
- hiding inactive entries from new invoice selectors; and
- deletion only when no finalized or cancelled invoice references the entry.

Approver persistence must use a dedicated repository or explicit per-catalog relation metadata mapping `approvers` to `mileage_approver_id`; simply adding `approvers` to the current two-way catalog union would incorrectly target `location_id`. The non-draft reference check, draft-only detach, and delete execute atomically on one connection. A finalized or cancelled reference returns `false` without detaching anything. If an approver is referenced only by drafts, deletion detaches the catalog ID while preserving the stored name on those drafts. Because an unlinked name does not pass mileage-approval validation, the affected draft must select or add an approver before finalization.

A name quick-added from an invoice becomes an active Approvers entry immediately and the invoice line stores its returned ID. Adding a case-insensitive match for an inactive approver reuses and reactivates that entry rather than creating a duplicate.

Each editable Approvers name input has an accessible name such as `Approver name: Jordan Lee`. Catalog mutation results use a polite `role="status"` announcement. Successful deletion reports that any affected draft approvals must be reselected; a finalized or cancelled reference reports that the approver was made inactive instead.

## Data Model and Migration

Add schema migration version 5. Shipped migrations remain append-only.

Create an `approvers` table:

```sql
CREATE TABLE approvers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_approvers_name_key ON approvers(name_key);
```

Add three columns to `line_items`:

```sql
ALTER TABLE line_items ADD COLUMN mileage_approver_id INTEGER REFERENCES approvers(id);
ALTER TABLE line_items ADD COLUMN mileage_approver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE line_items ADD COLUMN mileage_approval_date TEXT NOT NULL DEFAULT '';
```

Extend `LineItem` and therefore each finalized line snapshot with:

```ts
mileageApproverId: number | null;
mileageApproverName: string;
/** Canonical ISO date, or an empty string while incomplete. */
mileageApprovalDate: string;
```

New rows initialize these values to `null`, `''`, and `''` respectively. Existing rows receive the same migration defaults, so invoices without mileage remain behaviorally and visually unchanged.

## Draft, Snapshot, and History Semantics

Draft save/load round-trips all three approval fields. Loading a linked draft joins `approvers` and resolves the live catalog name, falling back to the stored name if the linked row is unavailable. This matches the existing linked-client behavior.

Finalization deep-copies the resolved approver ID, displayed name, and approval date into `snapshot_json`. Reprint and invoice-detail routes continue to read the immutable snapshot, so later catalog renames or deactivation cannot rewrite issued invoice evidence.

Approval values may remain stored on a zero-mileage draft, but invoice views and document renderers condition their output on `mileageCents > 0`. Finalized snapshots may retain those values without displaying them.

Duplicating any invoice clears all three mileage-approval fields on every copied line. The duplicate mapping applies the clearing overrides after spreading the source row: `mileageApproverId: null`, `mileageApproverName: ''`, and `mileageApprovalDate: ''`. Creation of the destination draft and insertion of all copied rows must be atomic on production and test adapters; a failure must not leave a partial duplicate. A copied mileage charge therefore requires fresh approval before the new draft can finalize.

## Validation and Finalization

Add a pure repository-callable `invoiceFinalizeBlockers(draft: DraftInvoice)` validation boundary. It includes the existing at-least-one-line and required line-field rules plus the mileage approval rules. Both the editor and `finalizeInvoice()` consume this same result; the repository must not depend on UI-derived validation state.

When `mileageCents > 0`, a line is incomplete if:

- `mileageApproverId` is `null`;
- `mileageApproverName` is blank; or
- `mileageApprovalDate` is not a real canonical `YYYY-MM-DD` date.

The stable missing-field labels are **mileage approver** and **mileage approval date**. A missing ID and name produce one approver blocker, not two.

The editor uses these results for its blocked-row count, row warnings, jump-to-first-blocker behavior, and Finalize-button state.

`finalizeInvoice` validates the freshly loaded draft and throws before calling either automatic sequence allocation or manual sequence reservation. Invalid approval data therefore cannot advance a counter, mutate invoice status, store totals, or write a snapshot.

After validation succeeds, sequence allocation or reservation, snapshot persistence, totals, finalization timestamp, and a conditional invoice update constrained by `status = 'draft'` form one single-connection transaction. The conditional update must affect exactly one invoice row; any other affected-row count throws inside the transaction. Any later failure rolls back the counter/reservation and every finalized-state column. The existing pre-finalization draft save may remain persisted. The current production `runInTransaction` callback fallback is not sufficient because the Tauri adapter does not expose callback transaction support; implementation must use or add a production-capable transaction primitive rather than relying on sequential callback writes.

Preview remains available for an incomplete mileage approval. Beneath each affected line it displays the non-evidentiary placeholder `Mileage approval required` until both values are valid; it never synthesizes a partial approval sentence. That placeholder is preview-only and cannot reach a finalized snapshot or persisted PDF.

No additional temporal ordering rule is imposed on the approval date. It must be a real date, but it may precede or follow the inspection date because the business has not specified a tighter constraint.

## Finalized Invoice and PDF

For each mileage-bearing line, the on-screen finalized invoice and generated PDF add a visually secondary row immediately beneath the charge:

`Mileage approved by Jordan Lee on Jul 18, 2026`

Use one shared legacy-safe predicate/formatter that returns approval text only when mileage is non-zero, the approver name is nonblank, and the approval date is a valid canonical date. The secondary row uses the shared formatted-date helper and stays directly adjacent to its owning charge across both completed and no-show tables.

Each table has `columnCount = showMileage ? 8 : 7`. The HTML row uses `<td colspan={columnCount}>`. The pdfmake row uses a leading cell with `colSpan: widths.length` followed by exactly `widths.length - 1` empty placeholder cells, preserving a structurally valid table body. Approval output is omitted when mileage is zero or the legacy-safe predicate fails.

The approval is supporting evidence, not a new billable line. It does not receive a row number and does not affect subtotal, tax, total, sorting, client breakdowns, or invoice search.

## Backup and Restore Compatibility

Existing version 1–4 databases migrate to version 5 on normal startup. Backup validation must remain schema-version-aware:

- backups below version 5 are valid without `approvers` and migrate after restoration;
- version 5 and newer backups must satisfy the mileage-approval schema fingerprint; and
- a backup claiming version 5 with a partial or inconsistent schema is rejected as malformed.

The existing base table checks remain valid for all versions. Add version-5 checks rather than adding `approvers` unconditionally to the base table list, which would incorrectly reject every older backup. The v5 fingerprint verifies through SQLite pragmas:

- the `approvers` table and its `id`, `name`, `name_key`, and `active` columns;
- the three new `line_items` columns;
- the unique `idx_approvers_name_key` index and indexed column;
- the `mileage_approver_id` foreign key relationship; and
- an empty `PRAGMA foreign_key_check` result so dangling approver references cannot pass validation.

Pre-v5 backups retain the current permissive path and migrate only after the restored file is swapped into place.

## Error and Edge-Case Behavior

- A typed name that has not been selected or quick-added remains visibly unlinked and blocks finalization.
- Inactive approvers do not appear in new-row suggestions but remain resolvable on linked drafts and historical records.
- Case-only or whitespace-only duplicate names reuse the existing approver instead of creating another entry.
- Clearing mileage hides the approval strip without deleting work from the current draft.
- Restoring mileage reuses that draft's approval, even if the amount differs, per the approved business rule.
- Removing an invoice row removes its approval fields with the row and preserves them if the existing Undo action restores the row.
- Autosave treats approval fields as persisted data but ignores disclosure-only UI state.
- Legacy snapshot JSON may omit the newly required `LineItem` properties at runtime. The shared legacy-safe predicate prevents historical mileage invoices from rendering `undefined` text.

## Verification

Use test-driven implementation with focused coverage for:

- migration 5 from an existing version-4 database;
- fresh schema creation and case-insensitive approver uniqueness;
- active-only listing, quick-add reuse/reactivation, rename, deactivation, and delete protection;
- atomic approver deletion, including rollback of draft detachment when deletion fails;
- version-aware validation of pre-v5 backups and complete/partial v5 schema fingerprints;
- new-row defaults and editor-row conversion;
- draft save/load round-trips and live linked-name resolution;
- autosave serialization of approval fields;
- conditional missing-field validation, including invalid calendar dates and unlinked names;
- shared draft blockers used by both the editor and repository;
- repository finalization rejecting invalid approval data before both automatic allocation and manual reservation;
- injected post-allocation failure rolling back counters, status, timestamp, totals, and snapshot while leaving the preceding draft save intact;
- a conflicting or non-draft status causing the conditional finalization update to affect zero rows and roll back all finalization writes;
- non-zero mileage changes retaining approval;
- zero mileage hiding output and removing the requirement;
- atomic duplication clearing all three approval fields after the source-row spread for completed/no-show, positive/zero-mileage, and draft/finalized/cancelled sources;
- finalized snapshots remaining stable after catalog rename/deactivation;
- reprints matching the originally finalized snapshot;
- structurally valid, unnumbered approval rows directly beneath the correct charge in eight-column mileage tables in both `InvoiceView` and the PDF document definition;
- seven-column zero-mileage tables containing no approval row;
- incomplete-preview placeholders that never become persisted approval evidence;
- legacy snapshots with all three properties absent in both on-screen and PDF renderers;
- deterministic disclosure, focus, keyboard, clipping, and responsive behavior on first, middle, and final rows;
- completed and no-show mileage rows; and
- totals, sorting, rollups, search, and old invoices remaining unchanged.

Run migration 5 through both sql.js and the native SQLx transaction path. The native test applies the exact v5 statements to a v4 database, verifies the schema fingerprint and enforced foreign-key/delete behavior, and proves `user_version` plus schema changes roll back together on an injected failure.

After focused tests, run `npm run check`, the full Vitest suite, `npm run build`, `cargo check`, and `cargo test` for the Tauri crate.

## Out of Scope

- Multiple approvers on one mileage charge.
- Approval status workflows such as requested, pending, rejected, or revoked.
- Approval notes, attachments, signatures, roles, organizations, or contact details.
- An approval change log or separate approval-events table.
- Automatically clearing approval when a mileage amount changes.
- Approval-date rules relative to inspection or invoice dates.
- Filtering, reporting, or invoice-history search by approver.
