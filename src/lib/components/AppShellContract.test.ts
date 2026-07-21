import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync('src/lib/components/AppShell.svelte', 'utf8').replace(/\r\n/g, '\n');
const config = source.slice(source.indexOf('const navGroups'), source.indexOf('const isActive'));
type NavGroup = { id: string; label: string; items: Array<{ href: string; label: string }> };

const navGroups = Function(`"use strict"; ${config}\nreturn navGroups;`)() as NavGroup[];

function extractIsActive() {
  const match = source.match(/const isActive = \(href: string, path: string\) => \{\n([\s\S]*?)\n  \};/);
  if (!match) throw new Error('Unable to find isActive in AppShell.svelte');
  return Function('href', 'path', match[1]) as (href: string, path: string) => boolean;
}

describe('grouped sidebar navigation', () => {
  test('defines the approved groups with their routes in product order', () => {
    expect(navGroups).toEqual([
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
    ]);
  });

  test('preserves active matching for root, nested, and expense detail routes', () => {
    const isActive = extractIsActive();
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/', '/history')).toBe(false);
    expect(isActive('/clients', '/clients')).toBe(true);
    expect(isActive('/clients', '/clients/archived')).toBe(true);
    expect(isActive('/expense-history', '/expense-history')).toBe(true);
    expect(isActive('/expense-history', '/expense/42')).toBe(true);
    expect(isActive('/expense-history', '/expenses')).toBe(false);
  });

  test('renders non-collapsible headings that label each route list and marks the active page', () => {
    expect(source).toContain('aria-label="Primary navigation"');
    expect(source).toContain('id={`nav-group-${group.id}`}');
    expect(source).toContain('aria-labelledby={`nav-group-${group.id}`}');
    expect(source).toContain("aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}");
    expect(source).toContain('<h2');
    expect(source).not.toContain('<details');
  });

  test('uses inset section bars without horizontal row dividers', () => {
    expect(source).toContain('margin:0 0 var(--sp-2); padding:var(--sp-2) var(--sp-4);');
    expect(source).toContain('border-radius:var(--r-sm); background:var(--bg-sunken); color:var(--text-secondary);');
    expect(source).toContain('.nav-group li { margin-bottom:var(--sp-1); border:0; }');
    expect(source).toContain('border:0; border-left:4px solid transparent; border-radius:var(--r-sm);');
    expect(source).toContain('a.active { background:var(--accent-tint); border-left-color:var(--accent);');
  });

  test('keeps grouped navigation scrollable above the unchanged footer', () => {
    expect(source).toContain('class="nav-groups"');
    expect(source).toContain('.nav-groups { flex:1; min-height:0; overflow-y:auto;');
    expect(source).toContain('.nav-group + .nav-group { margin-top:var(--sp-6); }');
    expect(source.indexOf('class="nav-groups"')).toBeLessThan(source.indexOf('class="rail-footer"'));
    expect(source).toContain('{$settings?.inspectorName');
    expect(source).toContain('{$lastBackupAt}');
  });
});
