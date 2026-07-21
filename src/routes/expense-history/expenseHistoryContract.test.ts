import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('expense history route', () => {
  test('uses fixed history reads and shared range presentation', () => {
    const page = readSource('src/routes/expense-history/+page.svelte');

    expect(page).toContain('Expense History');
    expect(page).toContain('listFinalizedExpenses');
    expect(page).toContain('expenseSummaryForRange');
    expect(page).not.toContain('listExpenseYears');
    expect(page).not.toContain('expenseYearRollup');
    expect(page).not.toContain('listExpensesForYear');
    expect(page).toContain('HistoryRangeControls');
    expect(page).toContain("import '$lib/styles/history.css'");
    expect(page).toContain('Export expense summary');
  });

  test('has explicit load/search lifecycle and immutable export scope', () => {
    const page = readSource('src/routes/expense-history/+page.svelte');

    expect(page).toContain("type LoadState = 'loading' | 'ready' | 'error'");
    expect(page).toContain("type SearchState = 'idle' | 'loading' | 'ready' | 'error'");
    expect(page).toContain('createLatestRequestGate');
    expect(page).toContain('Object.freeze({ ...resolution.range })');
    expect(page).toContain('calendarYearRange(year)');
    expect(page).toContain('Expense-Summary-${year}.pdf');
  });

  test('navigation keeps invoice and expense workflows distinct', () => {
    const shell = readSource('src/lib/components/AppShell.svelte');
    expect(shell).toContain("{ href: '/expenses', label: 'Expense Reports' }");
    expect(shell).toContain("{ href: '/expense-history', label: 'Expense History' }");
  });

  test('cancelled shortcut reveals, scrolls, and focuses the disclosure', () => {
    const page = readSource('src/routes/expense-history/+page.svelte');

    expect(page).toContain('aria-controls="cancelled-expense-reports"');
    expect(page).toContain('bind:this={cancelledToggle}');
    expect(page).toContain('cancelledToggle?.focus()');
    expect(page).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(page).toContain('Cancelled expense reports');
  });

  test('report rows use the shared amount track and retain domain actions', () => {
    const page = readSource('src/routes/expense-history/+page.svelte');

    expect(page).toContain('class="history-amount tnum"');
    expect(page).toContain('Download PDF');
    expect(page).toContain('Duplicate');
    expect(page).toContain('Restore');
    expect(page).toContain('title="View expense report #{report.reportNumber}"');
    expect(page).toContain('No active expense reports');
  });
});
