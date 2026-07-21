# Grouped Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat desktop sidebar with four labelled, always-visible navigation groups while preserving every existing route and shell behavior.

**Architecture:** Keep navigation configuration and rendering inside `AppShell.svelte`. Replace the flat item array with a `navGroups` array, render each group as a labelled list, and retain the existing `isActive` function and link styling. Add a source contract test dedicated to the sidebar hierarchy and route uniqueness.

**Tech Stack:** Svelte 5, TypeScript, scoped CSS, Vitest source-contract tests.

## Global Constraints

- The only production file modified is `src/lib/components/AppShell.svelte`.
- Do not change route URLs, page components, sidebar width, shell layout, or footer behavior.
- Groups are always visible; add no icons, collapse controls, badges, or persisted state.
- Preserve existing link target sizes, hover styles, active styles, and text scaling.

---

### Task 1: Group the Sidebar Navigation

**Files:**
- Modify: `src/lib/components/AppShell.svelte`
- Create: `src/lib/components/AppShellContract.test.ts`

**Interfaces:**
- Consumes: existing SvelteKit `$page.url.pathname`, `settings`, `lastBackupAt`, and `backupFailed` stores.
- Produces: `navGroups`, an ordered array whose entries contain `id`, `label`, and `items`; accessible grouped navigation markup.

- [ ] **Step 1: Write the failing sidebar contract test**

Create `src/lib/components/AppShellContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync('src/lib/components/AppShell.svelte', 'utf8').replace(/\r\n/g, '\n');
const config = source.slice(source.indexOf('const navGroups'), source.indexOf('const isActive'));

describe('grouped sidebar navigation', () => {
  test('defines the approved groups and routes once in product order', () => {
    const labels = ['Invoices', 'Expenses', 'Lists', 'Settings'];
    const positions = labels.map((label) => config.indexOf(`label: '${label}'`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    for (const href of ['/', '/history', '/expenses', '/expense-history', '/clients', '/locations', '/approvers', '/settings', '/backups']) {
      expect(config.match(new RegExp(`href: '${href.replace('/', '\\/')}'`, 'g')) ?? []).toHaveLength(1);
    }
    expect(config).toContain("{ href: '/expenses', label: 'New Expense Report' }");
  });

  test('renders non-collapsible headings that label each route list', () => {
    expect(source).toContain('aria-label="Primary navigation"');
    expect(source).toContain('id={`nav-group-${group.id}`}');
    expect(source).toContain('aria-labelledby={`nav-group-${group.id}`}');
    expect(source).toContain('<h2');
    expect(source).not.toContain('<details');
  });

  test('keeps grouped navigation scrollable above the unchanged footer', () => {
    expect(source).toContain('class="nav-groups"');
    expect(source).toContain('.nav-groups { flex:1; min-height:0; overflow-y:auto;');
    expect(source.indexOf('class="nav-groups"')).toBeLessThan(source.indexOf('class="rail-footer"'));
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- --run src/lib/components/AppShellContract.test.ts`

Expected: FAIL because `AppShell.svelte` still defines a flat `nav` array and has no labelled group markup.

- [ ] **Step 3: Implement grouped navigation in `AppShell.svelte`**

Replace the flat navigation configuration with:

```ts
const navGroups = [
  { id: 'invoices', label: 'Invoices', items: [
    { href: '/', label: 'New Invoice' },
    { href: '/history', label: 'History' },
  ] },
  { id: 'expenses', label: 'Expenses', items: [
    { href: '/expenses', label: 'New Expense Report' },
    { href: '/expense-history', label: 'History' },
  ] },
  { id: 'lists', label: 'Lists', items: [
    { href: '/clients', label: 'Clients' },
    { href: '/locations', label: 'Locations' },
    { href: '/approvers', label: 'Approvers' },
  ] },
  { id: 'settings', label: 'Settings', items: [
    { href: '/settings', label: 'General' },
    { href: '/backups', label: 'Backups' },
  ] },
];
```

Render `navGroups` inside `<nav aria-label="Primary navigation">`. Put all groups inside `.nav-groups`; render a non-interactive `<h2 id={`nav-group-${group.id}`}>` and a `<ul aria-labelledby={`nav-group-${group.id}`}>` for each group. Keep `.rail-footer` as the next sibling after `.nav-groups`.

Move scroll ownership from the old top-level `ul` rule to `.nav-groups` and add:

```css
.nav-groups { flex:1; min-height:0; overflow-y:auto; padding:var(--sp-3); }
.nav-group + .nav-group { margin-top:var(--sp-5); }
.nav-group h2 {
  margin:0 0 var(--sp-1); padding:0 calc(var(--sp-4) + 4px);
  color:var(--text-muted); font-size:var(--fs-xs); font-weight:700;
  letter-spacing:.08em; text-transform:uppercase;
}
ul { list-style:none; margin:0; padding:0; }
```

Leave the existing `li`, `a`, active-link, footer, shell, nav, and main rules unchanged.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run: `npm test -- --run src/lib/components/AppShellContract.test.ts src/routes/approvers/approverCatalogContract.test.ts src/routes/expense-history/expenseHistoryContract.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: `svelte-check found 0 errors and 0 warnings`.

- [ ] **Step 5: Run the full regression gate**

Run: `npm test -- --run`

Expected: all test files and tests pass.

Run: `npm run build`

Expected: production build succeeds; the existing large-chunk advisory may remain.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/lib/components/AppShell.svelte src/lib/components/AppShellContract.test.ts
git commit -m "Group sidebar navigation"
```
