# Editable Invoice Number Design

## Goal

Allow a user who starts using Invoice Maker mid-year to set the next invoice sequence number manually on the New Invoice screen. If they finalize invoice `11-2026`, the next default invoice number for 2026 should be `12-2026`.

## Chosen Approach

Use an editable sequence field on the current draft invoice. The invoice year remains derived from the invoice date, and the editable value controls only the `X` portion of `X-year`.

Example:

- Invoice date: `2026-06-21`
- Editable sequence: `11`
- Finalized invoice number: `11-2026`
- Next default for 2026: `12-2026`

## User Experience

On the New Invoice page, replace the passive `Will be #1-2026` label with a compact invoice-number control in the creation header or date area:

`Invoice # [11] - 2026`

The sequence defaults to the next available number for the selected invoice year. A user can edit it before locking and saving. If the invoice date changes to another year, the sequence refreshes to that year's next default unless the user has manually edited the field for the current draft.

The preview and confirmation dialog should use the selected sequence so the user sees the exact number before finalizing.

## Data Model

The existing `invoices.seq` column stores finalized invoice sequence numbers. Drafts already load a nullable `seq`, but draft saves currently ignore it. This feature should persist the selected draft sequence so autosave, reload, preview, and finalization agree.

No schema migration is needed because `seq` already exists and can remain nullable for drafts.

## Finalization Rules

When finalizing a draft:

- If the draft has a selected sequence, use it.
- If the draft does not have one, allocate the normal next sequence.
- Reject non-positive or non-integer sequences.
- Reject a sequence already used by another invoice in the same year.
- Allow skipping ahead.
- After using a manual sequence, update `year_counters.last_seq` to at least that sequence so the next default follows it.

Voided invoices still count as used numbers. Deleted voided invoices should not make the counter move backward.

## Supporting Repo Changes

Add or update repository helpers so numbering logic is testable outside the Svelte page:

- Fetch used sequences for a year.
- Preview the next default sequence.
- Finalize with a chosen draft sequence.
- Advance the counter to at least a manually chosen sequence.

The existing `checkOverride()` helper should be reused or lightly adjusted for validation messaging.

## Testing

Use TDD for implementation. Tests should cover:

- Manually finalizing `11-2026` stores that exact invoice number.
- The next default for 2026 becomes `12`.
- Reusing `11-2026` is rejected.
- Draft save/load preserves the selected sequence.
- Preview snapshot uses the selected sequence.
- Date/year changes still fetch the correct default for that year.

Full verification should run `npm test`, `npm run check`, `cargo check`, and `npm run build`.
