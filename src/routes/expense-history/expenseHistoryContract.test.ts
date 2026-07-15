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
});
