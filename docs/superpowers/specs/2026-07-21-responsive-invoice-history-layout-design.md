# Responsive Invoice and Unified History Layout Design

## Goal

Use the available desktop space so mileage-bearing invoices remain comfortable to read, and make Invoice History and Expense History look and behave like two views of the same product.

Both History pages must:

- open on **All time**;
- support one visible, inclusive, closed date range that filters rows and drives the toolbar summary PDF;
- keep text search results inside the effective date range;
- preserve cancelled records in a separate, clearly identified section; and
- align row actions for totals from `$10.00` through `$99,999.99`.

The app has one desktop user. Responsive behavior is a focused fallback for constrained windows and larger text settings, not a separate mobile design.

## Chosen Approach

Keep the invoice detail and both domain routes separate, but share the small pieces whose behavior must remain identical:

1. `InvoiceView` owns one desktop width and one compact container breakpoint.
2. A controlled `HistoryRangeControls` component renders the All time state, two dates, presets, validation, and export action; each route owns the actual range state.
3. Pure History helpers normalize a valid closed range, apply inclusive date bounds, group filtered rows, and calculate in-memory rollups without mutating loaded data.
4. One small shared History stylesheet defines the page hierarchy, year bars, row grid, amount track, buttons, and compact wrapping. Route markup, actions, loading, and PDF orchestration remain domain-specific.
5. Each domain loads active history with one ordered repository query and cancelled history with one ordered repository query, then groups and rolls up those rows in memory.

Do not build a generic History framework, introduce CSS subgrid, or add pagination. The routes have different financial data and actions; sharing only stable controls, helpers, and visual rules keeps the implementation understandable.

## Invoice Detail View

- Set the invoice sheet to `width: 100%` with a desktop maximum width of `1040px`.
- At normal desktop widths, restore the comfortable table body size and horizontal cell padding so the row-number marker and **Inspection #** remain visually distinct.
- Keep long text wrappable while keeping right-aligned Mileage and Fee values on one line.
- Add one `860px` container-based compact breakpoint on the invoice sheet. At and below that content width, reduce horizontal cell padding and table body text size to the already verified compact values.
- Apply the shared `InvoiceView` behavior to draft Preview and finalized History detail views.
- Leave the separate pdfmake invoice layout unchanged.

The row-number column remains as-is. Additional header renaming or removal is unnecessary once normal desktop spacing is restored.

## Unified History Page Structure

Both pages use this order and visual treatment:

1. page title and short domain-specific subtitle;
2. current-year summary banner when applicable;
3. search field;
4. shared date-range and toolbar-export controls;
5. filtered year sections with rollup chips and a full-year export action;
6. consistently aligned history rows; and
7. a separate cancelled section with a shortcut near the page heading.

Use these labels:

- **Invoice History** — “Finalized invoices, kept separately from expense reports.”
- **Expense History** — retain the equivalent existing expense subtitle.
- Search placeholders refer to finalized invoices or finalized expense reports.
- Toolbar actions read **Export tax summary** and **Export expense summary**.
- A year action identifies its scope, for example **Export 2026 summary**.

Invoice chips continue to show invoice count, billed, HST, and pre-tax income. Expense chips show report count and total expenses. Domain-specific information does not need placeholder equivalents merely to make the pages visually symmetrical.

## Date Range Model

### State and Presets

The only valid effective states are:

- **All time**, represented by `null`; or
- a closed inclusive range `{ start: YYYY-MM-DD, end: YYYY-MM-DD }`.

Open-ended ranges are not supported. The controls provide **All time**, **This year**, **Last year**, and **This quarter** plus two date pickers.

- Both routes initialize to All time.
- Selecting All time clears both dates.
- Selecting a dated preset fills both dates.
- A dated preset exposes `aria-pressed="true"` only when both dates exactly match it.
- All time exposes `aria-pressed="true"` only when both dates are blank.
- A valid custom range leaves every preset unpressed and is visibly represented by the two date fields.
- Custom date changes apply immediately; there is no Apply button.

Each route owns the draft start and end values. `HistoryRangeControls` receives and updates those values without keeping a mirrored internal copy.

### Invalid or Incomplete Input

One blank date or a start after the end is invalid/incomplete input:

- show one stable range error with `role="alert"`;
- associate both labelled date controls with the error and expose their invalid state;
- disable toolbar summary export;
- treat the effective list range as All time; and
- continue applying the current text query to active and cancelled rows.

This preserves discoverability while making it impossible to export an ambiguous range.

### Range Labels

One pure formatter supplies titles, document copy, and filenames without timezone conversion:

- `All time`
- `Calendar year 2026`
- `July 1, 2026 – July 31, 2026`

At export click, the route validates, normalizes, and freezes one immutable range snapshot. Repository calls, PDF title, displayed range label, and filename all use that snapshot and never reread reactive date state after an `await`.

## Filtering, Search, and Disclosure State

### Visible Filtering

- Filter finalized invoices by issue date and finalized expense reports by report date.
- Search operates within the effective date range.
- Preserve year grouping and omit years with no matching active rows.
- Recalculate year chips from range-filtered finalized rows.
- Recalculate the current-year banner from range-filtered finalized rows only. Omit it when the effective range excludes the current year or the filtered current-year count is zero.
- Text search narrows row discovery but does not change the current-year banner, range rollups, or PDF contents.
- Search mode may flatten matching rows, but it must retain separate active and cancelled presentations.

The loaded rows remain source data. Filtering and grouping produce derived arrays and never mutate or discard those records. Year disclosure state is route-owned in a separate `openYears` map keyed by year, so range and search changes do not unexpectedly reset expansion choices.

### Search Lifecycle

Search has explicit `idle`, `loading`, `ready`, and `error` states.

- A monotonic request ID makes the latest request the only one allowed to publish results.
- On query change, suppress stale results and show **Searching…** with `role="status"` and `aria-busy` while the current request is pending.
- Show no-match copy only after the latest request reaches `ready`.
- Show a visible alert on search failure rather than presenting a false no-match state.
- After restore or another mutation, rerun the active query so results cannot remain stale.
- Empty-query mode uses the already-loaded history arrays and makes no search request.

A short debounce may be added only to reduce redundant requests; correctness comes from latest-request-wins, not timing.

### Loading and Empty States

Initial loading states are mutually exclusive:

1. loading;
2. load error with **Retry**;
3. true empty source dataset; or
4. loaded history.

After a successful load with any finalized or cancelled source records, keep search and range/export controls visible even when the current filters yield zero active rows. Only a truly empty source dataset receives the first-record empty state. No-active-results copy explicitly says **No active…** so it does not contradict cancelled matches below it.

### Cancelled Records

- Cancelled invoices and expense reports always remain in their own labelled section below active records.
- Apply the same effective range and text query to that section.
- Repository search returns finalized and void records with explicit status; the route splits them. Drafts never appear.
- Invoice search supports number, date, client, location, VIN, and inspection number for both statuses. Expense search supports number, report date, and item description for both statuses.
- A cancelled search match automatically reveals the cancelled section.
- The cancelled shortcut count reflects matching cancelled rows. Activating it expands the section, scrolls to it with reduced-motion respected, and focuses its disclosure button.
- Cancelled and year disclosures expose `aria-expanded` and `aria-controls`; decorative arrows are hidden from assistive technology.
- Cancelled rows never contribute to current-year banners, year chips, active no-results copy, or financial PDFs.

## History Row Alignment and Responsiveness

- Keep each route’s existing semantic row content and action group.
- Reserve `11ch` for the amount, right-align it, and prevent the formatted value from wrapping.
- The track supports two through five whole-dollar digits, including currency symbol, thousands separator, decimal point, and two decimals: `$10.00` through `$99,999.99`.
- Because every row uses the same amount track, the action group begins at the same horizontal position regardless of total.
- Toolbars and year bars wrap in DOM/focus order without horizontal scrolling at standard, large, and extra-large application text settings.
- At the existing approximately `820px` content threshold, row actions move beneath row details and year-export actions take a full-width next line.
- The invoice uses its wider presentation whenever its container permits and falls back at the `860px` invoice breakpoint.

## Summary PDF Behavior

Text search never changes PDF contents. Cancelled and draft records are always excluded.

### Scope Rules

- The toolbar export uses the frozen active range: All time or the current valid closed custom/preset range.
- A year-section export always uses that entire calendar year, independent of the toolbar range or text query.
- A valid range with no finalized records reports clear no-data feedback and does not create a blank PDF.
- Preserve existing per-year invoice filename and subfolder behavior.

### Invoice Summary

Retain the current tax-summary contents: invoice count, billed total, HST, pre-tax income, and per-client pre-tax breakdown.

Generalize repository summary/client-breakdown queries to accept either `null` for All time or one normalized closed range. All-time SQL omits date predicates; bounded SQL uses parameterized inclusive predicates. Both paths select finalized records only. Use a deterministic client-name tie-breaker when totals are equal.

The generator receives the exact frozen `rangeLabel` so All time, custom ranges, and calendar years are described consistently.

### Expense Summary

Add an expense-summary document containing:

- the frozen range label;
- finalized report count;
- grand total expenses; and
- item-level rows with expense date, description, expense-report number, and amount.

An expense report qualifies solely by `expense_reports.report_date`. Once a finalized report qualifies, include all of its stored items; an item date is display and ordering data, not a second qualification filter.

The repository export operation returns qualifying finalized report headers and all corresponding items using the same report-date predicate. Derive the PDF report count and grand total from those qualifying headers rather than adding a separate duplicate rollup query. The detail sum must equal the header-derived grand total.

Order item rows deterministically by item date, report year, report sequence, stored item position, then item ID. Use the same generator for toolbar and year exports. Individual expense-report PDFs remain unchanged.

## Data and Component Contracts

### Invoice History Read Model

`InvoiceListItem` gains:

- `status: 'finalized' | 'void'`; and
- `taxCents: number`.

Every history and search query/constructor that produces this type selects and maps those fields. New fixed-query repository operations load finalized and void invoices with the newest year first and invoice numbers ascending within each year. Issue dates are display and filter data, not the primary history order. The route no longer performs sequential per-year list/summary requests. Any retained year-list helper must exclude drafts explicitly.

Invoice search returns finalized and void rows and excludes drafts. Repository summary/client-breakdown functions support `null` or a closed range and remain responsible for line-level client aggregation.

### Expense History Read Model

New fixed-query operations load finalized and void reports with the newest year first and report numbers ascending within each year. Report dates are display and filter data, not the primary history order. Search returns finalized and void reports while excluding drafts. The export repository operation accepts `null` or a closed report-date range and returns qualifying finalized headers plus all their items under the semantics above.

### Shared Helpers and Styles

- Keep all money as integer cents.
- Put ISO date validation, inclusive range filtering, preset matching, range labels, grouping, and in-memory rollups in pure helpers with small domain-specific selectors.
- Keep request-ID gating in a separately testable helper.
- Use one controlled range component and one small semantic `.history-*` stylesheet.
- Keep route actions, disclosures, document generation, and repository orchestration domain-specific.

No migration, snapshot rewrite, or stored-data change is required.

## Async Actions and Errors

Use one page-scoped action lock for PDF generation, duplicate, restore, toolbar export, and year export.

- While locked, disable competing mutation/export actions.
- Keep search, range controls, disclosures, and View actions available.
- The initiating control receives its specific in-progress label.
- Reset the lock in `finally` on success or failure.
- Show database, PDF, and filesystem failures in the existing page alert/toast surface.

## Testing and Verification

Use test-driven changes with tests at the narrowest useful layer.

### Unit Tests

- `null` All time, valid inclusive closed ranges, incomplete input, and reversed ranges;
- exact preset matching and timezone-free range labels;
- immutable range snapshots used after asynchronous work;
- range filtering that preserves source arrays and recalculates domain rollups;
- current-year banner inclusion rules and text search not changing rollups;
- latest-request-wins search and `idle/loading/ready/error` transitions;
- active/cancelled splitting and cancelled exclusion from all financial totals; and
- disclosure state remaining independent of derived filtered groups.

### Repository Tests

- all-history queries are fixed-count, ordered, and draft-free;
- every `InvoiceListItem` path maps `status` and `taxCents`;
- invoice All time omits date predicates and closed ranges remain inclusive/parameterized;
- search covers both finalized and void status without drafts;
- expense report qualification uses report date only and includes every item from qualifying reports;
- expense detail sum equals qualifying header total;
- deterministic expense-item ordering; and
- cancelled records never enter summary results.

Use sql.js-backed repository tests where practical. Source-contract tests cover only wiring and CSS contracts; do not add a full browser component-test stack.

### Layout and Application Verification

Render and measure:

- a mileage-bearing invoice at wide and compact widths at the largest text setting;
- Invoice and Expense History at desktop and compact widths;
- History totals with two-, three-, four-, and five-digit whole-dollar amounts;
- active and cancelled matches under range and search filtering; and
- loading, failure, no-active-match, and true-empty states.

Verify the native Tauri window at its actual `1100×760` default and `900×600` minimum at text scales `1`, `1.12`, and `1.28`. Confirm no horizontal page scrolling and preserved keyboard focus order. Smoke-test an existing database to confirm no migration or snapshot rewrite occurs.

Run focused tests, `npm run check`, the full Vitest suite, `npm run build`, `cargo check`, and `cargo test`. Complete an independent review gate before handoff.

## Out of Scope

- A mobile-specific invoice or History redesign.
- Open-ended date ranges.
- Pagination or virtual scrolling.
- User-saved ranges or filter persistence between launches.
- A generic History framework or domain adapter.
- Category-based expense reporting; expense items currently have free-text descriptions only.
- Combining invoice and expense records into one list or one PDF.
- Including cancelled or draft records in financial summaries.
- Supporting displayed totals above `$99,999.99` in the reserved History amount track.
- Changes to individual invoice or expense-report PDFs.
- A new browser component-test stack.
- Database migrations or schema changes.
