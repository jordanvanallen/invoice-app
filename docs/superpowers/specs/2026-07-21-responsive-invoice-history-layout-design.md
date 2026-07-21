# Responsive Invoice and Unified History Layout Design

## Goal

Use available desktop space so mileage-bearing invoices remain comfortable to read, and make Invoice History and Expense History behave and look like two views of the same product.

Both History pages must:

- open on **All time**;
- support one visible inclusive date range that filters rows and drives summary-PDF generation;
- keep search results inside the active date range;
- preserve cancelled records in a separate, clearly identified section; and
- align row actions for totals from `$10.00` through `$99,999.99`.

The app has one desktop user. Responsive behavior is a focused fallback for constrained windows and larger text settings, not a separate mobile design.

## Chosen Approach

Keep the invoice detail and both domain routes separate, but share the small pieces whose behavior must remain identical:

1. `InvoiceView` owns one desktop width and one compact container breakpoint.
2. A shared History range-control component owns the All time state, two dates, presets, validation, and clear behavior.
3. Pure History helpers apply inclusive date bounds and produce filtered year groups without mutating loaded data.
4. Invoice and expense routes retain their domain-specific loading, summaries, actions, and PDF inputs while using the same page hierarchy and visual rules.

Do not build a generic History framework or introduce CSS subgrid. The two routes have different financial data and actions; sharing only the stable controls and pure filtering rules keeps the implementation understandable.

## Invoice Detail View

- Set the invoice sheet to `width: 100%` with a desktop maximum width of `1040px`.
- At normal desktop widths, restore the original table body size and horizontal cell padding so adjacent headings such as the row-number marker and **Inspection #** remain visually distinct.
- Keep long text wrappable and keep right-aligned Mileage and Fee values on one line.
- Add one `860px` container-based compact breakpoint on the invoice sheet. At and below that content width, reduce horizontal cell padding and table body text size to the already verified compact values.
- Apply the shared `InvoiceView` behavior to draft Preview and finalized History detail views.
- Leave the separate pdfmake invoice layout unchanged.

The row-number column remains as-is. Additional header renaming or removal is unnecessary once normal desktop spacing is restored.

## Unified History Page Structure

Both pages use this order and visual treatment:

1. page title, short domain-specific subtitle, and cancelled-record shortcut;
2. current-year summary banner;
3. search field;
4. shared date-range and export toolbar;
5. filtered year sections with rollup chips and a year-summary export action;
6. consistently aligned history rows; and
7. a separate cancelled section.

Invoice-specific chips continue to show billed, HST, and pre-tax income where applicable. Expense chips show report count and total expenses. Domain-specific information does not need placeholder equivalents merely to make the pages visually symmetrical.

Use the later Expense History interaction states as the reliability baseline: asynchronous actions expose busy labels, mutation errors remain visible, year disclosure buttons expose `aria-expanded`, and rows wrap their action group at the existing compact threshold. Apply matching behavior and styling to Invoice History where it is currently missing.

## Date Range and Search

### Default and Presets

- Both pages initialize with blank bounds and a selected **All time** state.
- Provide **All time**, **This year**, **Last year**, and **This quarter** presets plus the two existing date pickers.
- A blank start is an open lower bound. A blank end is an open upper bound. Both blank means All time.
- Nonblank bounds are inclusive and compare canonical ISO dates.
- Selecting **All time** clears both bounds.
- Selecting a dated preset fills both bounds.
- Custom date changes apply immediately; there is no separate Apply button.
- If both bounds exist and the start is after the end, display an actionable range error, leave the unfiltered All time lists visible, and disable PDF export until the range is valid.

### Visible Filtering

- Filter active finalized rows by invoice issue date or expense report date.
- Search operates within the active date range.
- Preserve year grouping; omit years with no matching active rows.
- Recalculate year chips from the range-filtered active rows. Invoice list records therefore include frozen `taxCents` in addition to total cents so partial-year billed and HST chips can be calculated without asynchronous per-group queries.
- Recalculate the current-year banner from range-filtered current-year active rows. When the active range excludes the current year, omit that banner.
- Text search narrows row discovery inside the active range but does not change range rollups or PDF contents. Search mode hides the year-group presentation, as it does today, so it does not display misleading search-specific rollup chips.
- Show a clear no-results message that distinguishes an empty date range from a text search with no matches.

The loaded, unfiltered groups remain the source data. Range filtering produces derived arrays and never mutates or discards the loaded records.

### Cancelled Records

- Cancelled invoices and expense reports always remain in their own labelled section below active records.
- Apply the same valid date range to that section.
- Apply text search to cancelled records and preserve the separate cancelled heading in search mode.
- Invoice cancelled search supports the same number, date, client, location, VIN, and inspection-number fields as active invoice search. Expense cancelled search supports number, date, and item description.
- The cancelled shortcut and section count reflect cancelled records matching the active range and search.
- Cancelled rows never contribute to the current-year banner, year chips, active no-results copy, or exported financial summaries.

Repository search queries may return both finalized and void records with an explicit status. The routes split those results into active and cancelled presentations. Drafts never appear.

## History Row Alignment

- Keep the existing four-track row structure and shared amount element on each route.
- Reserve `11ch` for the amount, align its contents to the right, and prevent the formatted value from wrapping.
- The reserved track supports two through five whole-dollar digits, including the currency symbol, thousands separator, decimal point, and two decimals: `$10.00` through `$99,999.99`.
- Because every row uses the same amount width, its action group begins at the same horizontal position regardless of the displayed total.
- Retain the existing compact behavior that moves the action group beneath row details when the container cannot support the desktop row.

## Summary PDF Behavior

The active valid date range is the single source of truth for the toolbar export. Text search never changes export contents. All time export includes every finalized record and is labelled **All time**; bounded and open-ended ranges state their actual bounds. Cancelled and draft records are excluded.

### Invoice Summary

Retain the existing invoice tax-summary content: invoice count, billed total, HST, pre-tax income, and per-client pre-tax breakdown. Generalize its input label so the same generator can describe All time, custom ranges, and individual calendar years.

### Expense Summary

Add an expense-summary document containing:

- the selected range label;
- finalized report count;
- grand total expenses; and
- item-level rows with expense date, description, expense-report number, and amount.

Order expense rows by item date, then report number and stored item position for deterministic output. A report can therefore contribute several lines while being counted once in the report count.

Use the same expense-summary generator for toolbar exports and per-year exports. Individual expense-report PDFs remain unchanged.

## Data and Component Boundaries

- Extend invoice list records and list/search SQL with `taxCents` and status where needed for filtered rollups and active/cancelled splitting.
- Extend invoice and expense search to include both finalized and void records while continuing to exclude drafts.
- Add expense range-rollup and range-item-detail repository queries. They accept optional/open ISO bounds or normalized sentinel bounds at the repository boundary; SQL remains parameterized.
- Keep invoice client-breakdown aggregation in the repository because line-level client data is not present in History list records.
- Keep all totals as integer cents.
- Put inclusive range validation/filtering and in-memory rollup calculations in pure helpers with domain-specific adapters rather than duplicating date comparisons in both routes.
- Use one shared range-control component. Keep route-specific row actions and PDF orchestration in their existing routes.

No migration or stored-data change is required.

## Responsive and Accessibility Behavior

- Support standard, large, and extra-large application text settings.
- The invoice uses its wider presentation whenever its containing area permits it and falls back through one compact breakpoint.
- The History `ch`-based amount width scales with the active font rather than relying on a fixed pixel measurement.
- Shared range controls expose visible labels, valid button semantics, and range-error association.
- Year and cancelled disclosure controls expose `aria-expanded`.
- Busy actions are disabled consistently and retain descriptive in-progress labels.
- Existing keyboard navigation and focus indicators remain intact.

## Error and Empty States

- Invalid reversed ranges do not filter records or generate a PDF.
- A valid range containing no active records shows the empty-range message while still allowing matching cancelled records to appear in their separate section.
- Exporting a valid range with no finalized records produces a clear no-data message instead of a blank PDF.
- Database or filesystem failures display the existing page error or save-result toast and reset the busy state.
- Search and range changes do not collapse or merge the cancelled section into active results.

## Testing and Verification

Use test-driven changes with focused coverage for:

- the `1040px` invoice maximum width and `860px` compact container breakpoint;
- comfortable default invoice typography and compact fallback rules;
- wrapping invoice text while keeping monetary values unbroken;
- pure inclusive, open-ended, All time, and reversed-range behavior;
- range filtering that preserves input groups and recalculates invoice and expense rollups;
- text search constrained by the active date range;
- finalized and cancelled search results split into separate sections;
- cancelled records excluded from every financial total and PDF query;
- the `11ch`, right-aligned, non-wrapping History amount track on both pages;
- invoice list queries returning tax and status fields correctly;
- expense range rollup and deterministic item-detail ordering;
- All time, open-ended, custom-range, and per-year summary document labels;
- expense report count remaining distinct from item-row count; and
- consistent busy, error, disclosure, and no-results states.

Render and measure:

- a mileage-bearing invoice at the largest text setting at wide and compact widths;
- Invoice and Expense History at desktop and compact widths;
- History totals with two-, three-, four-, and five-digit whole-dollar amounts; and
- active and cancelled matches under both search and range filtering.

Run focused tests, `npm run check`, the full Vitest suite, `npm run build`, `cargo check`, and `cargo test`. Complete an independent review gate before handoff.

## Out of Scope

- A mobile-specific invoice or History redesign.
- Pagination or virtual scrolling.
- User-saved ranges or filter persistence between launches.
- Category-based expense reporting; expense items currently have free-text descriptions only.
- Combining invoice and expense records into one list or one PDF.
- Including cancelled or draft records in financial summaries.
- Supporting displayed totals above `$99,999.99` in the reserved History amount track.
- Changes to individual invoice or expense-report PDFs.
- Database migrations or schema changes.
