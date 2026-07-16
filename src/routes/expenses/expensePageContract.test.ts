import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('expense report editor route', () => {
  test('provides autosave, explicit sort, snapshot Preview, and guarded finalization', () => {
    const page = readFileSync('src/routes/expenses/+page.svelte', 'utf8');

    expect(page).toContain('New Expense Report');
    expect(page).toContain('SaveStatusChip');
    expect(page).toContain('createAutosaveController');
    expect(page).toContain('Sort rows by date');
    expect(page).toContain('onclick={sortExpenseRows}');
    expect(page).toContain('prepareExpensePreview');
    expect(page).toContain('ExpenseView');
    expect(page).toContain('Preview');
    expect(page).toContain('Lock &amp; Save');
    expect(page).toContain('settleAutosaveBeforeManualSave');
    expect(page).toContain('finalizeExpenseReport');
  });

  test('matches the invoice editor hierarchy for shared document fields', () => {
    const page = readFileSync('src/routes/expenses/+page.svelte', 'utf8');
    const headStart = page.indexOf('<div class="head">');
    const periodStart = page.indexOf('<div class="period">');
    const rowsStart = page.indexOf('<div class="row-tools">');
    const head = page.slice(headStart, periodStart);
    const period = page.slice(periodStart, rowsStart);

    expect(headStart).toBeGreaterThan(-1);
    expect(head).toContain('New Expense Report');
    expect(head).toContain('StatusPill status="draft"');
    expect(head).toContain('Expense report #');
    expect(head).toContain('expense-sequence-help');
    expect(head).toContain('SaveStatusChip');
    expect(period.indexOf('Reporting period')).toBeGreaterThan(-1);
    expect(period.indexOf('Reporting period')).toBeLessThan(period.indexOf('Report date'));
    expect(period).toContain('<span class="dates">');
    expect(page).not.toContain('class="card report-details"');
  });

  test('shows row-order guidance contextually instead of below the page title', () => {
    const page = readFileSync('src/routes/expenses/+page.svelte', 'utf8');

    expect(page).toContain('const showExpenseHint = $derived(');
    expect(page).toContain('{#if showExpenseHint}');
    expect(page).toContain('class="empty-hint"');
    expect(page).not.toContain('<p class="muted">Your work saves automatically.');
  });

  test('keeps formatted row dates on one line with a text-scale-aware column', () => {
    const page = readFileSync('src/routes/expenses/+page.svelte', 'utf8');
    const datePicker = readFileSync('src/lib/components/DatePicker.svelte', 'utf8');

    expect(datePicker).toContain('.field > span { white-space: nowrap; }');
    expect(page).toContain('grid-template-columns: calc(220px * var(--fs-scale))');
    expect(page).toContain('grid-template-columns: calc(200px * var(--fs-scale))');
    expect(page).toContain('@media (max-width: 760px)');
    expect(page).toContain('.row { grid-template-columns: 1fr;');
    const mobileStyles = page.slice(page.indexOf('@media (max-width: 760px)'));
    expect(mobileStyles).toContain('.head { flex-wrap: wrap; }');
  });

  test('sorts the visible editor rows before building Preview', () => {
    const page = readFileSync('src/routes/expenses/+page.svelte', 'utf8');
    const previewStart = page.indexOf('function openPreview()');
    const previewEnd = page.indexOf('\n  }', previewStart);
    const previewHandler = page.slice(previewStart, previewEnd);

    expect(previewStart).toBeGreaterThan(-1);
    expect(previewHandler.indexOf('sortExpenseRows();')).toBeGreaterThan(-1);
    expect(previewHandler.indexOf('sortExpenseRows();')).toBeLessThan(
      previewHandler.indexOf('prepareExpensePreview('),
    );
  });
});
