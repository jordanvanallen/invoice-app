# Expense Row Validation Messages Design

## Goal

Show every expense row problem directly beneath the affected row so the visible warnings agree with the footer's blocked-row count.

## Approved behavior

- Every blocker whose `itemIndex` matches a displayed expense row appears below that row.
- Row warnings use concise field-level copy because their location already identifies the affected expense:
  - Missing date: `Choose a date`
  - Invalid date: `Choose a valid date`
  - Date outside the reporting period: `Date is outside the reporting period`
  - Missing description: `Enter a description`
  - Invalid amount: `Enter an amount greater than $0.00`
- A row with multiple blockers shows every warning in the validator's existing `date`, `description`, then `amount` order.
- The footer continues to count unique blocked rows, so several warnings on one row still count as one row.
- Fix guidance continues focusing the first blocker.
- Preview behavior, sorting, autosave, Lock & Save enforcement, and repository finalization do not change.

## Architecture

`expenseFinalizeBlockers` remains the only validation source. The expense-editor presentation helper will accept the derived blocker array and select every blocker for one `itemIndex`; it will translate the structured `field` and existing date message into concise display copy without recomputing validity.

The expense route will replace its single `dateRangeWarning` value with a `rowWarnings` array and render it using the same multi-warning loop already established by `InvoiceSection.svelte`.

## Scope boundaries

This change does not alter blocker creation, validation order, inclusive reporting-period bounds, finalization rules, repository error messages, or header-level error presentation. It does not add field borders or live focus changes.

## Verification

- A blank description produces `Enter a description` on its row.
- A row with date, description, and amount blockers returns all three messages in validation order.
- A valid row returns no messages.
- The route contract requires a warning loop rather than the date-only helper.
- Focused tests fail before implementation and pass afterward.
- The full unit suite, Svelte checks, production build, and independent review pass before integration into `dev`.
