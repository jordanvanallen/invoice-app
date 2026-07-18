import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('expense history route', () => {
  test('groups finalized reports, searches, and keeps cancelled reports separate', () => {
    const page = readFileSync('src/routes/expense-history/+page.svelte', 'utf8');

    expect(page).toContain('Expense History');
    expect(page).toContain('listExpenseYears');
    expect(page).toContain('expenseYearRollup');
    expect(page).toContain('listExpensesForYear');
    expect(page).toContain('searchExpenses');
    expect(page).toContain('listVoidedExpenses');
    expect(page).toContain('Cancelled expense reports');
    expect(page).toContain('Download PDF');
    expect(page).toContain('Duplicate');
    expect(page).toContain('Restore');
  });

  test('navigation keeps invoice and expense workflows distinct', () => {
    const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
    expect(shell).toContain("{ href: '/expenses', label: 'Expense Reports' }");
    expect(shell).toContain("{ href: '/expense-history', label: 'Expense History' }");
  });

  test('the cancelled shortcut reveals and scrolls to the cancelled section', () => {
    const page = readFileSync('src/routes/expense-history/+page.svelte', 'utf8');

    expect(page).toContain("import { onMount, tick } from 'svelte';");
    expect(page).toContain('async function showCancelled()');
    expect(page).toContain('cancelledOpen = true;');
    expect(page).toContain("document.getElementById('cancelled-expenses')?.scrollIntoView");
    expect(page).toContain('onclick={showCancelled}');
    expect(page).toContain('id="cancelled-expenses"');
  });

  test('report number links explain that they open the report', () => {
    const page = readFileSync('src/routes/expense-history/+page.svelte', 'utf8');

    expect(page).toContain('title="View expense report #{report.reportNumber}"');
  });

  test('wraps history actions based on available content width at large text sizes', () => {
    const page = readFileSync('src/routes/expense-history/+page.svelte', 'utf8');

    expect(page).toContain('ul { container-type: inline-size;');
    expect(page).toContain('@container (max-width: 820px)');
    const narrowStyles = page.slice(page.indexOf('@container (max-width: 820px)'));
    expect(narrowStyles).toContain('li { grid-template-columns: auto 1fr auto; }');
    expect(narrowStyles).toContain('.row-actions { grid-column: 1 / -1; }');
  });
});
