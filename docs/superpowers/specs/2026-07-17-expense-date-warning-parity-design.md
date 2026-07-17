# Expense Date Warning Parity Design

## Goal

Make out-of-range expense dates read and appear like the equivalent invoice warning while preserving the expense report's stricter Lock & Save enforcement.

## Approved behavior

This follow-up supersedes only the bounds-heavy message and dock-only presentation in the earlier reporting-period validation design. Its inclusive validation and hard-finalization requirements remain authoritative.

- Each out-of-range expense row displays `⚠ Date is outside the reporting period` directly below that row.
- When the first blocker belongs to a row, the sticky action matches invoices with `Fix N rows to finish →` and still focuses the first blocking field.
- Header-level blockers retain their specific sticky guidance because they do not have an invoice-style row warning.
- Every affected row displays its own warning; correcting one row leaves warnings on any remaining affected rows.
- Reporting-period boundaries remain inclusive.
- Preview remains available under its current prerequisites.
- Lock & Save and repository finalization remain blocked until every expense date is valid and within the reporting period.

## Architecture

`expenseFinalizeBlockers` remains the single source of validation truth. It will emit a shared concise out-of-range message instead of formatting row numbers and period bounds. Small UI helpers will select that warning for the matching row and count unique blocked rows. The expense route will render the warning and row-level sticky action using the invoice editor's established patterns.

This deliberately separates validation from presentation: the same blocker continues to drive finalization, repository rejection, Fix it, and the new inline warning. The UI will not recompute date ranges independently.

## Scope boundaries

This change will not alter date validity, inclusive bounds, blocker order, sorting, Preview prerequisites, autosave, PDF output, or invoice behavior. Missing and malformed expense dates keep their current Fix it messages; this follow-up adds invoice-style inline presentation only for the out-of-range case.

## Verification

- Exact blocker and repository rejection messages use `Date is outside the reporting period`.
- Row-level sticky guidance uses a unique blocked-row count, while header blockers keep their specific message.
- A UI helper returns warnings for all and only matching out-of-range rows.
- The expense route contains the same warning markup and CSS declarations as the invoice row component.
- Focused tests fail before implementation and pass afterward.
- Full unit tests, Svelte checks, production build, and diff whitespace checks pass before integration into `dev`.
