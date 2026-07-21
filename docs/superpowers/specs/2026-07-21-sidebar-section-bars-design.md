# Sidebar Section Bars Design

## Goal

Make the grouped sidebar easier to scan by removing the apparent dividers between navigation rows and rendering each group title as a clearly separated header bar.

## Scope

The production change is limited to `src/lib/components/AppShell.svelte`.

- Keep the existing four groups, labels, routes, ordering, active matching, rail width, scrolling, and footer.
- Remove visible horizontal dividers between navigation items.
- Preserve the active item's teal left-edge indicator.
- Give each section heading an inset, rounded background bar.
- Use existing theme and spacing tokens so the treatment works in light, dark, large-text, and extra-large-text modes.

No route, page, catalog, history, data, or responsive-layout behavior changes are included.

## Visual Treatment

Each `h2` section title remains uppercase and noninteractive. It receives:

- `--bg-sunken` as its background;
- `--text-secondary` for readable text in both themes;
- the existing small radius;
- vertically centered content with modest vertical and horizontal padding;
- a small gap below the bar before its first link.

The bar stays inset within the sidebar's existing padding. This keeps it visually quieter than a full-bleed band and prevents it from competing with the active link state.

Navigation links explicitly reset their border before applying the existing transparent left border. This removes any horizontal row border while reserving the same width for the teal active indicator, so links do not shift when active.

## Accessibility and Behavior

- Section headings continue to label their corresponding lists with `aria-labelledby`.
- Active links retain `aria-current="page"`.
- Header bars remain headings, not buttons or collapsible controls.
- Existing focus, hover, and active styles remain unchanged.

## Verification

Extend the `AppShell` contract test first so it requires:

- an explicit no-divider border reset on navigation links;
- the inset header background, radius, and padding;
- preservation of the active left border and semantic heading/list relationship.

Run the focused contract test, `npm run check`, the full test suite, and the production build. Review the final diff for strict sidebar-only production scope and visual/accessibility regressions.
