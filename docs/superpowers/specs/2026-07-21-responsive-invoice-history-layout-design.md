# Responsive Invoice and History Layout Design

## Goal

Use the available desktop space so mileage-bearing invoices remain comfortable to read, while keeping invoice totals and action buttons aligned in History for amounts from `$10.00` through `$99,999.99`.

The app has one desktop user. Responsive behavior should therefore be a small fallback for constrained windows and larger text settings, not a separate mobile layout.

## Chosen Approach

Make the shared on-screen invoice view desktop-first with one compact breakpoint. Give History invoice totals one reserved, right-aligned character-width track.

This preserves the existing components and markup. It does not change invoice data, totals, PDFs, or database behavior.

## Invoice View

- Set the invoice sheet to `width: 100%` with a desktop maximum width of `1040px`.
- At normal desktop widths, use the original table body size and horizontal cell padding so adjacent headings such as the row-number marker and **Inspection #** remain visually distinct.
- Keep long text wrappable and keep right-aligned Mileage and Fee values on one line.
- Add one `860px` container-based compact breakpoint on the invoice sheet. At and below that content width, reduce horizontal cell padding and table body text size to the already verified compact values.
- Apply the same shared `InvoiceView` behavior to draft Preview and finalized History detail views.
- Leave the separate pdfmake invoice layout unchanged.

The row-number column remains as-is. Additional header renaming or removal is unnecessary once normal desktop spacing is restored.

## History Rows

- Keep the existing four-track row grid and shared `.total` element used by active, search-result, and cancelled invoice rows.
- Reserve `11ch` for `.total`, align its contents to the right, and prevent the formatted amount from wrapping.
- The reserved track supports two through five whole-dollar digits, including the currency symbol, thousands separator, decimal point, and two decimal places: `$10.00` through `$99,999.99`.
- Because every row uses the same amount width, its action group begins at the same horizontal position regardless of the displayed total.
- Do not hard-code every row column or introduce CSS subgrid; those approaches add complexity without improving this single-user desktop workflow.

## Responsive and Accessibility Behavior

- Standard, large, and extra-large application text settings remain supported.
- The invoice uses its wider presentation whenever the containing area permits it and falls back through one compact breakpoint.
- History's `ch`-based amount width scales with the active font rather than relying on a fixed pixel measurement.
- Existing button labels, focus behavior, semantic markup, and keyboard interactions remain unchanged.

## Testing and Verification

Use test-driven changes with focused source-contract coverage for:

- the wider invoice maximum width and `width: 100%`;
- the container-based compact breakpoint;
- comfortable default cell typography and padding;
- wrapping text while keeping right-aligned monetary values unbroken; and
- the `11ch`, right-aligned, non-wrapping History total column.

Render a mileage-bearing invoice at the largest text setting and confirm the table remains within the sheet at both wide and compact widths. Render History rows containing two-, three-, four-, and five-digit whole-dollar totals and confirm their action groups share one horizontal start position.

Run the focused tests, `npm run check`, the full Vitest suite, and `npm run build`. Complete an independent review gate before handoff.

## Out of Scope

- A mobile-specific invoice or History design.
- Restructuring History with CSS subgrid.
- Supporting totals above `$99,999.99` in the reserved History track.
- PDF layout changes.
- Data-model, database, calculation, or formatting changes.
