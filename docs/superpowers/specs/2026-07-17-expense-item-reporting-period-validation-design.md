# Expense Item Reporting-Period Validation Design

## Goal

Prevent an expense report from being locked and saved while any expense line date falls outside the report's reporting period. Keep the correction workflow simple, predictable, and consistent with the expense editor's existing validation guidance.

## Approved behavior

An expense line date is valid when it falls within the inclusive range from `periodStart` through `periodEnd`. A date equal to either boundary is valid.

When a non-empty expense line date falls before the reporting-period start or after its end:

- The line contributes a row-level `date` blocker.
- The editor's existing Fix it action displays the first blocker and focuses that expense's date control.
- Lock & Save remains disabled until all expense dates and other required data are valid.
- Repository finalization rejects the draft if the UI validation is bypassed.
- Expense date-range blockers do not add a Preview restriction; Preview retains its existing row-count and sequence-readiness prerequisites.

The blocker message will identify the affected row and valid bounds in plain language: `Expense 1 date must be between Jul 1, 2026 and Jul 15, 2026.`

## Validation boundary

The rule will be added to `expenseFinalizeBlockers`, the shared expense-report validator already consumed by the editor and `finalizeExpenseReport`. It will reuse the existing inclusive ISO-date comparison helper rather than introduce separate UI-only date logic.

All report and expense date values must first be canonical, real calendar dates in `YYYY-MM-DD` format. Blank or whitespace-only header values retain the existing missing-header blockers; malformed report or reporting-period dates receive header-level blockers. Row-range validation runs only when both reporting-period boundaries are canonical valid dates and the start is on or before the end. The inclusive ISO-date comparison helper is called only after those conditions are satisfied.

Within each row's existing validation order, date validation emits exactly one blocker: missing or blank date first, malformed date second, or out-of-range date third. Description and amount blockers follow that row's date blocker before validation advances to the next row. Row-range blockers therefore remain in current item and display order. Fix it surfaces the first current blocker; after correction, it advances to the next blocker.

This central placement ensures the following paths share one rule:

1. The editor's Fix it guidance
2. The editor's Lock & Save enabled state
3. The repository's defensive finalization check

## Alternatives considered

### Date-picker restriction only

Setting minimum and maximum selectable dates would improve input guidance but would not protect existing drafts, loaded data, or repository calls that bypass the picker. It is therefore insufficient as the enforcement mechanism.

### Warning without blocking finalization

This would resemble the invoice editor's current date warning, but it would still allow an internally inconsistent expense report to become permanent. The requested behavior is a hard finalization rule, so warning-only validation is rejected.

### Automatically change out-of-range dates

Clamping a line date to the nearest boundary would silently alter user-entered financial records. The editor will instead explain the problem and let the user correct it explicitly.

## Scope boundaries

This change will not:

- Change reporting-period dates automatically
- Prevent Preview from opening
- Add drag-and-drop or row reordering behavior
- Change expense sorting, numbering, autosave, PDF output, or history
- Change invoice date validation behavior
- Add date-picker minimum or maximum constraints in this pass
- Add a duplicate inline row warning; the dock blocker and focused date control remain the correction path

## Verification

Automated coverage will verify:

- A date before the reporting period creates a row-level date blocker
- A date after the reporting period creates a row-level date blocker
- Dates equal to the start and end boundaries remain valid
- Multiple out-of-range rows are all represented in blocker order
- Missing or reversed reporting-period dates do not add misleading row-range blockers
- Malformed and non-canonical report or reporting-period dates block finalization and suppress row-range blockers
- Missing, whitespace-only, malformed, and impossible expense dates each produce exactly one appropriate date blocker
- Mixed row errors preserve exact row-major `date`, `description`, then `amount` blocker ordering
- The first out-of-range blocker targets the correct expense date input
- Repository finalization rejects an out-of-range draft while preserving draft status and item order and writing no counter, finalized timestamp, totals, or snapshot
- Existing valid expense reports, Preview prerequisites, and the full regression suite remain unchanged

Tests will be added at the existing ownership seams:

- `src/lib/expense/validation.test.ts` will assert exact blocker arrays for dates before and after the period, inclusive boundaries, two invalid rows in source order, missing or reversed periods, malformed header dates, and missing, malformed, impossible, or whitespace-only item dates.
- `src/lib/ui/expenseEditor.test.ts` will use a valid first row and an out-of-range second row and assert that Fix it targets `expense-row-1-date` with the Expense 2 message.
- `src/lib/db/expense-repo.test.ts` will assert rejection and confirm that status, finalized timestamp, total, snapshot, sequence counter, persisted item order, and reprint availability are all unchanged.
- Preview coverage will exercise `prepareExpensePreview` with an out-of-range row and confirm that it still produces a snapshot without mutating the draft. The existing route contract will narrowly preserve the distinction between Preview prerequisites and `!canFinalize` on Lock & Save.
- Red-green TDD will run the focused validation, editor-helper, repository, and route-contract tests before production changes and confirm failure because the new validation behavior is absent.
