import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync('src/lib/components/AppShell.svelte', 'utf8').replace(/\r\n/g, '\n');
const config = source.slice(source.indexOf('const navGroups'), source.indexOf('const isActive'));

describe('grouped sidebar navigation', () => {
  test('defines the approved groups and routes once in product order', () => {
    const labels = ['Invoices', 'Expenses', 'Lists', 'Settings'];
    const positions = labels.map((label) => config.indexOf(`label: '${label}'`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));

    const routes = [
      '/', '/history', '/expenses', '/expense-history',
      '/clients', '/locations', '/approvers', '/settings', '/backups',
    ];
    for (const href of routes) {
      expect(config.split(`href: '${href}'`)).toHaveLength(2);
    }

    expect(config).toContain("{ href: '/', label: 'New Invoice' }");
    expect(config).toContain("{ href: '/history', label: 'History' }");
    expect(config).toContain("{ href: '/expenses', label: 'New Expense Report' }");
    expect(config).toContain("{ href: '/expense-history', label: 'History' }");
    expect(config).toContain("{ href: '/settings', label: 'General' }");
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
    expect(source).toContain('{$settings?.inspectorName');
    expect(source).toContain('{$lastBackupAt}');
  });
});
