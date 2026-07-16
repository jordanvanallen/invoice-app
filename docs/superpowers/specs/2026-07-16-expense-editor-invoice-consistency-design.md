# Expense Editor and Invoice Consistency Design

## Goal

Make the expense-report editor follow the invoice editor wherever the two workflows share the same concepts. The screen should feel familiar to a user who already knows how to create an invoice, while retaining expense-specific rows and totals.

## Approved approach

Mirror the invoice editor's existing structure in the expense editor without introducing a new shared header abstraction. This keeps the change small and makes the proven invoice screen the source of the visual pattern.

The alternatives considered were:

- Reorder fields inside the current expense details card. This would fix the date sequence but leave the document number and overall hierarchy inconsistent.
- Extract a configurable document-editor header shared by both screens. This could prevent future drift, but it adds component and API complexity that is unnecessary for this focused correction.

## Editor layout

The expense editor will use the same two-part hierarchy as the invoice editor.

The heading row will contain, in order:

1. `New Expense Report`
2. The existing draft status presentation used by the invoice editor
3. `Expense report #` with its sequence input and year suffix
4. The sequence validation or helper message
5. Flexible space
6. Autosave status

The date row below the heading will contain:

1. A grouped `Reporting period` control with the start date, the word `to`, and the end date
2. `Report date`

The expense-specific details card and permanent instructional sentence below the title will be removed. Number validation, sequence assignment, date bindings, autosave, preview, and finalization behavior will not change.

## Contextual guidance

The sentence about automatic saving and row order will not occupy permanent space below the page title. Guidance will instead use the invoice editor's contextual hint-bubble treatment near the rows.

Because a new expense report begins with one blank starter row, the hint will be shown only while no row has substantive expense content. It will disappear after the user enters a description or amount. The wording will remain brief and will explain that rows keep their entered order until the user sorts, previews, or finalizes.

## Expense-row date width

The desktop and tablet expense-row grid will reserve enough width for a formatted date such as `Jul 16, 2026`, including the calendar icon and scaled spacing. Date text inside the picker will not wrap.

At the mobile breakpoint, expense rows will continue to stack into a single full-width column. The date control remains full width and the formatted date remains on one line.

The width correction will be scoped so it does not reduce the flexible description column more than necessary. The amount and remove controls will retain their current behavior.

## Scope boundaries

This change does not alter:

- Expense-report or invoice persistence
- Document numbering rules
- Autosave timing
- Row sorting behavior
- Preview or finalization behavior
- PDF output
- Expense history or finalized-report screens

## Accessibility and responsive behavior

Existing accessible labels and sequence help associations will be preserved when their markup moves. The heading and date rows may wrap at narrower widths in the same manner as the invoice editor. Expense rows will keep their existing mobile labels and stacked layout.

## Verification

Automated regression coverage will verify:

- The expense number is part of the heading row rather than the date/details container
- The reporting-period start and end controls appear before the report date
- The two reporting-period dates are grouped under one label
- Contextual guidance is no longer permanently attached to the page heading
- Existing autosave, sorting, preview, and finalization contracts remain present

Visual verification will cover standard, large, and extra-large text settings at desktop width, plus the mobile breakpoint. In each desktop and tablet case, a date such as `Jul 16, 2026` must render on one line.
