import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = () => readFileSync('src/routes/history/+page.svelte', 'utf8').replace(/\r\n/g, '\n');

describe('invoice history route contract', () => {
  test('uses fixed history reads, shared controls, and route-owned derivation state', () => {
    const page = source();

    expect(page).toContain('listFinalizedInvoices');
    expect(page).not.toContain('listInvoicesForYear');
    expect(page).not.toContain('listYears');
    expect(page).toContain('HistoryRangeControls');
    expect(page).toContain("import '$lib/styles/history.css'");
    expect(page).toContain("type LoadState = 'loading' | 'ready' | 'error'");
    expect(page).toContain("type SearchState = 'idle' | 'loading' | 'ready' | 'error'");
    expect(page).toContain('createLatestRequestGate');
    expect(page).toContain('openYears');
    expect(page).toContain('busyAction');
  });

  test('freezes toolbar exports and keeps year exports calendar-scoped', () => {
    const page = source();

    expect(page).toContain('Object.freeze({ ...resolution.range })');
    expect(page).toContain('historyRangeLabel(range)');
    expect(page).toContain('calendarYearRange(year)');
    expect(page).toContain('historyRangeLabel(range, year)');
    expect(page).toContain('Tax-Summary-${year}.pdf');
  });

  test('keeps cancelled invoices separate, discoverable, and focusable', () => {
    const page = source();

    expect(page).toContain('Invoice History');
    expect(page).toContain('aria-controls="cancelled-invoices"');
    expect(page).toContain('bind:this={cancelledToggle}');
    expect(page).toContain('cancelledToggle?.focus()');
    expect(page).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(page).toContain("aria-controls={`invoice-year-${group.year}`}");
    expect(page).toContain('No active invoices');
  });

  test('keeps View available while mutation and export actions are locked', () => {
    const page = source();
    const row = page.slice(page.indexOf('{#snippet invoiceRow'), page.indexOf('{/snippet}') + 10);

    expect(row).toContain('>View</button>');
    expect(row).toContain('disabled={!!busyAction}');
    expect(row).not.toContain('disabled={!!busyAction} onclick={() => goto');
  });
});
