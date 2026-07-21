# Sidebar Section Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove apparent dividers between sidebar rows and render each navigation group title as an inset background bar.

**Architecture:** Keep the existing data-driven navigation and semantics unchanged. Strengthen the source contract around the relevant CSS, then make the minimal styling-only change inside `AppShell.svelte` using existing theme tokens.

**Tech Stack:** Svelte 5, TypeScript, CSS custom properties, Vitest

## Global Constraints

- The only production file modified is `src/lib/components/AppShell.svelte`.
- Preserve group labels, routes, ordering, active matching, `aria-current`, rail width, scrolling, and footer behavior.
- Use existing theme, spacing, and radius tokens; add no new global tokens or dependencies.
- Header bars remain noninteractive `h2` elements and continue to label their lists.

---

### Task 1: Style the grouped sidebar

**Files:**
- Modify: `src/lib/components/AppShellContract.test.ts`
- Modify: `src/lib/components/AppShell.svelte`

**Interfaces:**
- Consumes: Existing `.nav-group h2`, sidebar anchor styles, `--bg-sunken`, `--text-secondary`, `--sp-2`, `--sp-3`, `--sp-4`, and `--r-sm`.
- Produces: Inset section-title bars and borderless item rows while preserving the active left border.

- [ ] **Step 1: Write the failing CSS contract test**

Add a focused test to `src/lib/components/AppShellContract.test.ts`:

```ts
test('uses inset section bars without horizontal row dividers', () => {
  expect(source).toContain('margin:0 0 var(--sp-2); padding:var(--sp-2) var(--sp-4);');
  expect(source).toContain('border-radius:var(--r-sm); background:var(--bg-sunken); color:var(--text-secondary);');
  expect(source).toContain('border:0; border-left:4px solid transparent; border-radius:var(--r-sm);');
  expect(source).toContain('a.active { background:var(--accent-tint); border-left-color:var(--accent);');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/lib/components/AppShellContract.test.ts
```

Expected: FAIL because the heading lacks the inset-bar declarations and anchors do not explicitly reset all borders.

- [ ] **Step 3: Implement the minimal sidebar CSS**

Update the existing rules in `src/lib/components/AppShell.svelte`:

```css
.nav-group h2 {
  display:flex; align-items:center; min-height:calc(36px * var(--fs-scale));
  margin:0 0 var(--sp-2); padding:var(--sp-2) var(--sp-4);
  border-radius:var(--r-sm); background:var(--bg-sunken); color:var(--text-secondary);
  font-size:var(--fs-xs); font-weight:700; letter-spacing:.08em; text-transform:uppercase;
}

a {
  display:flex; align-items:center; min-height:calc(56px * var(--fs-scale)); padding:0 var(--sp-4);
  border:0; border-left:4px solid transparent; border-radius:var(--r-sm);
  color:var(--text-primary); text-decoration:none;
  font-size:var(--fs-base); white-space:nowrap;
}
```

Do not modify markup, active matching, or any route/page component.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --run src/lib/components/AppShellContract.test.ts
```

Expected: the grouped-sidebar contract passes.

- [ ] **Step 5: Run the complete verification gate**

Run each command independently:

```bash
npm run check
npm test -- --run
npm run build
git diff --check
```

Expected: zero Svelte diagnostics, all tests pass, the static production build succeeds, and the diff has no whitespace errors.

- [ ] **Step 6: Review scope and commit**

Confirm `git diff --stat` shows only the two planned source/test files beyond this plan and its approved design document. Then commit:

```bash
git add src/lib/components/AppShell.svelte src/lib/components/AppShellContract.test.ts
git commit -m "Style sidebar section bars"
```
