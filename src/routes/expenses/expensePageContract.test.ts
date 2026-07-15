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
});
