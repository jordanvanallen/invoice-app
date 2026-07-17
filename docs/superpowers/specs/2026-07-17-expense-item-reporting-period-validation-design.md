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
- Preview remains available, matching the editor's existing treatment of incomplete draft data.

The blocker message will identify the affected row in plain language: `Expense 1 date must be within the reporting period.`

## Validation boundary

The rule will be added to `expenseFinalizeBlockers`, the shared expense-report validator already consumed by the editor and `finalizeExpenseReport`. It will reuse the existing inclusive ISO-date comparison helper rather than introduce separate UI-only date logic.

Range validation will run only when both reporting-period dates are present and the start is on or before the end. If the header period is missing or reversed, the existing header blocker remains the actionable error and row-range blockers are deferred until the period itself is valid.

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

## Verification

Automated coverage will verify:

- A date before the reporting period creates a row-level date blocker
- A date after the reporting period creates a row-level date blocker
- Dates equal to the start and end boundaries remain valid
- Multiple out-of-range rows are all represented in blocker order
- Missing or reversed reporting-period dates do not add misleading row-range blockers
- The first out-of-range blocker targets the correct expense date input
- Repository finalization rejects an out-of-range draft and leaves it unfinalized
- Existing valid expense reports, Preview behavior, and the full regression suite remain unchanged
