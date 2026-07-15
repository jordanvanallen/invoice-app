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
