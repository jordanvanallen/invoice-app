import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('expense report detail route', () => {
  test('uses the frozen snapshot and guarded lifecycle actions', () => {
    const page = readFileSync('src/routes/expense/[id]/+page.svelte', 'utf8');

    expect(page).toContain('reprintExpenseSnapshot');
    expect(page).toContain('<ExpenseView {snap} />');
    expect(page).toContain('saveExpensePdf');
    expect(page).toContain('duplicateExpenseReport');
    expect(page).toContain('voidExpenseReport');
    expect(page).toContain('restoreExpenseReport');
    expect(page).toContain('deleteVoidedExpenseReport');
    expect(page).toContain('busyAction');
    expect(page).toContain('deleteStep = 2');
    expect(page).toContain("This can't be undone");
  });
});
