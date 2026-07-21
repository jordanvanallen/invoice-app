# Grouped Sidebar Navigation Design

## Goal

Make the desktop sidebar easier to scan by grouping related destinations without changing routes, page behavior, or the existing fixed-sidebar layout.

## Navigation Structure

The sidebar uses four always-visible groups in this order:

1. **Invoices**
   - New Invoice (`/`)
   - History (`/history`)
2. **Expenses**
   - New Expense Report (`/expenses`)
   - History (`/expense-history`)
3. **Lists**
   - Clients (`/clients`)
   - Locations (`/locations`)
   - Approvers (`/approvers`)
4. **Settings**
   - General (`/settings`)
   - Backups (`/backups`)

The shorter `History` and `General` labels rely on their group headings for context. `Expense Reports` becomes `New Expense Report` so its create-page purpose matches `New Invoice`.

## Presentation

- Group headings are small, muted, uppercase, and non-interactive.
- Groups receive clear vertical separation while links within a group retain the existing compact spacing.
- Links keep the existing minimum target height, hover treatment, active background, accent border, typography, and no-wrap behavior.
- The user/backup-status footer remains unchanged and pinned below the scrollable navigation area.
- The sidebar width, main-content layout, and text-scale behavior remain unchanged.
- The first cut adds no icons, collapsible sections, badges, or mobile-navigation redesign.

## Component Structure

`AppShell.svelte` replaces the flat navigation array with a grouped data structure. Each group provides a label and its route items. The template renders groups from that structure, keeping one source of truth for ordering and labels.

The navigation element receives an accessible label. Each visible group heading has a stable ID, and its list references that heading with `aria-labelledby`. Headings are text, not buttons, because groups do not collapse.

The existing `isActive` route logic is retained, including expense-detail matching under Expense History. No route or page component changes are required.

## Testing

Update navigation contract coverage to verify:

- the four groups and their order;
- every route appears exactly once under the intended group;
- compact labels and the `New Expense Report` rename;
- group headings are non-interactive and semantically label their lists;
- existing active-route behavior remains intact; and
- the footer remains outside the scrollable grouped navigation list.

Run the full Svelte check, Vitest suite, and production build before merge.

## Non-Goals

- Changing any route URL.
- Combining invoice and expense histories.
- Adding sidebar preferences or persisted collapsed state.
- Redesigning the footer, active-link appearance, or desktop shell dimensions.
