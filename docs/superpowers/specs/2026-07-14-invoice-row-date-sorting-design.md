# Invoice Row Date Sorting Design

## Goal

Keep invoice rows predictable while editing and guarantee that previews and finalized invoices show rows in chronological order. Completed inspections and no-shows remain separate lists.

## Chosen Approach

Provide one explicit **Sort rows by date** action for the draft editor. Also apply the same ordering automatically when building a preview and when finalizing an invoice.

Sorting is never triggered merely by editing a date or adding a row. Rows must not move while the user is entering data.

## Ordering Rules

- Sort completed inspections from oldest to newest.
- Sort no-shows from oldest to newest.
- Never mix completed inspections and no-shows into one list.
- Keep rows with the same date in their current relative order.
- Put rows without a date after dated rows. Missing dates continue to block finalization under the existing validation rules.
- Recalculate each row's existing `position` after an explicit editor sort or before the final draft save. No database migration or additional ordering field is required.

The same-day rule uses the order already represented by the editor arrays and persisted `position` values. The shared sort helper must return a new array and must not mutate its input.

## User Experience

Place a clearly labelled **Sort rows by date** button near the two invoice sections. Avoid an icon-only control. Clicking it sorts both visible lists immediately, after which the existing autosave flow persists the new positions.

Opening **Preview** shows both sections sorted without rearranging the open editor. Closing Preview returns the user to the unchanged editing layout.

Confirming **Lock & Save** sorts both editor lists, saves their positions, and then finalizes the invoice. The finalization/snapshot layer also applies the ordering defensively so every finalized snapshot and PDF is sorted even if finalization is invoked from another code path.

No drag-and-drop ordering is included in this change.

## Components and Data Flow

1. A pure shared ordering helper compares ISO date strings and preserves the input order for equal dates.
2. The editor's sort action calls the helper separately for `completed` and `noshow` rows and assigns the returned arrays to the visible state.
3. Preview snapshot construction orders completed and no-show rows independently without mutating draft state.
4. Finalization sorts the visible arrays before the final `saveDraft` call, causing existing `position` values to be rewritten in canonical order.
5. Finalized snapshot construction repeats the pure ordering step as a boundary guarantee.
6. PDF and on-screen invoice rendering continue to filter the snapshot into their existing Completed Inspections and No-Shows tables; they require no independent sorting logic.

Keeping the rule in one shared helper prevents the editor, preview, stored draft, finalized snapshot, and PDF from developing different date-order behavior.

## Error and Edge-Case Behavior

- Blank dates sort after valid dates so incomplete rows remain easy to find.
- Equal dates retain their existing order; no secondary sort by inspection number, client, or another field is introduced.
- Sorting does not alter totals or any row data other than `position` during persistence.
- Preview remains available under its existing rules and may show incomplete rows, while finalization continues to enforce all current required-field validation.
- The sort button is a no-op when both sections have fewer than two rows and does not need a special confirmation dialog.

## Testing

Add focused tests that verify:

- oldest-to-newest ordering;
- separate ordering of completed inspections and no-shows;
- stable relative order for equal dates;
- blank dates placed after dated rows;
- input arrays are not mutated;
- preview snapshots are sorted without changing draft/editor order;
- finalized snapshots are sorted defensively;
- the final draft save persists recalculated positions before finalization; and
- totals and row contents are unchanged by sorting.

Run the existing unit suite, Svelte checks, and production build after implementation.

## Out of Scope

- Live sorting while a date is edited or a row is added.
- Drag-and-drop or up/down row controls.
- User-selectable ascending/descending order.
- Secondary sorting of rows that share a date.
- Database schema changes.
