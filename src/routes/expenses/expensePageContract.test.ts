import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}

function readSource(path: string): string {
  return normalizeLineEndings(readFileSync(path, 'utf8'));
}

describe('expense report editor route', () => {
  test('normalizes Windows line endings before multiline source assertions', () => {
    const windowsPage = normalizeLineEndings(
      readFileSync('src/routes/expenses/+page.svelte', 'utf8'),
    ).replaceAll('\n', '\r\n');

    expect(normalizeLineEndings(windowsPage)).toContain(
      `{#if finalizeError}<p class="error">Couldn't save: {finalizeError}</p>{/if}\n  </div>\n\n  {#if showPreview`,
    );
  });

  test('provides autosave, explicit sort, snapshot Preview, and guarded finalization', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

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
    expect(page).toContain('const blockers = $derived(expenseFinalizeBlockers(draftForDisplay));');
    expect(page).toContain('const canFinalize = $derived(blockers.length === 0');
    expect(page).toContain('disabled={!canFinalize}>Lock &amp; Save</BigButton>');
  });

  test('matches the invoice editor hierarchy for shared document fields', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
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
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain('const showExpenseHint = $derived(');
    expect(page).toContain('{#if showExpenseHint}');
    expect(page).toContain('class="empty-hint"');
    expect(page).not.toContain('<p class="muted">Your work saves automatically.');
  });

  test('keeps formatted row dates on one line with a text-scale-aware column', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const datePicker = readSource('src/lib/components/DatePicker.svelte');

    expect(datePicker).toContain('.field > span { white-space: nowrap; }');
    expect(page).toContain('grid-template-columns: calc(220px * var(--fs-scale))');
    expect(page).toContain('grid-template-columns: calc(200px * var(--fs-scale))');
    expect(page).toContain('@container (max-width: 820px)');
    expect(page).toContain('.row { grid-template-columns: 1fr;');
    const compactStyles = page.slice(page.indexOf('@container (max-width: 820px)'));
    expect(compactStyles).toContain('.head { flex-wrap: wrap; }');
  });

  test('keeps shared calendar controls operable from the keyboard', () => {
    const datePicker = readSource('src/lib/components/DatePicker.svelte');

    expect(datePicker).toContain('function guard(event: MouseEvent, action: () => void)');
    expect(datePicker).toContain('const keyboardActivation = event.detail === 0');
    expect(datePicker).toContain('onclick={(event) => guard(event, toggle)}');
    expect(datePicker).toContain('onclick={(event) => guard(event, () => pick(day))}');
  });

  test('uses the same compact row-removal control as invoices', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain('class="del" title="Remove this row"');
    expect(page).toContain('>✕</button>');
    expect(page).not.toContain('>Remove</button>');
    // Amount, then a fixed track for the 44px move and remove buttons.
    expect(page).toContain('170px calc(88px + var(--sp-2));');
    expect(page).toContain('150px calc(88px + var(--sp-2));');
  });

  test('offers the same short-lived row-removal undo as invoices', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain('let undo = $state<');
    expect(page).toContain('undoTimer = setTimeout(expireUndo, 8000);');
    expect(page).toContain('function undoDelete()');
    expect(page).toContain('Row removed. <button id={expenseUndoButtonId(category)} type="button" onclick={undoDelete}>Undo</button>');
  });

  test('uses the same full-width add-row control as invoices', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const invoiceSection = readSource('src/lib/components/InvoiceSection.svelte');
    const sharedAddStyle = '.add { width: 100%; min-height: 48px; border: none; border-top: 1px solid var(--border); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }';

    expect(page).toContain('onclick={() => addExpense(category)}>+ {ADD_LABELS[category]}</button>');
    expect(invoiceSection).toContain(sharedAddStyle);
    expect(page).toContain(sharedAddStyle);
    expect(page).not.toContain('.add { margin: var(--sp-4);');
  });

  test('uses the invoice row-warning pattern for every expense row blocker', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const invoiceSection = readSource('src/lib/components/InvoiceSection.svelte');
    const sharedWarnsStyle = '.warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }';
    const sharedWarnTextStyle = '.warns span { color: var(--amber-600); font-size: var(--fs-sm); }';

    expect(page).toContain('expenseRowWarningsByUid(blockers, rowUids)');
    expect(page).toContain('{#each rowWarnings as warning}<span>⚠ {warning}</span>{/each}');
    expect(page).not.toContain('expenseRowDateRangeWarning');
    expect(page).toContain('const blockingRowCount = $derived(expenseBlockingRowCount(blockers));');
    expect(page).toContain('{#if blockers[0].itemIndex !== null}');
    expect(page).toContain("Fix {blockingRowCount} {blockingRowCount === 1 ? 'row' : 'rows'} to finish →");
    expect(page).toContain('{blockers[0].message} Fix it →');
    expect(invoiceSection).toContain(sharedWarnsStyle);
    expect(invoiceSection).toContain(sharedWarnTextStyle);
    expect(page).toContain(sharedWarnsStyle);
    expect(page).toContain(sharedWarnTextStyle);
  });

  test('sorts the visible editor rows before building Preview', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const previewStart = page.indexOf('function openPreview()');
    const previewEnd = page.indexOf('\n  }', previewStart);
    const previewHandler = page.slice(previewStart, previewEnd);

    expect(previewStart).toBeGreaterThan(-1);
    expect(previewHandler).not.toContain('blockers');
    expect(previewHandler).not.toContain('canFinalize');
    expect(previewHandler.indexOf('sortExpenseRows();')).toBeGreaterThan(-1);
    expect(previewHandler.indexOf('sortExpenseRows();')).toBeLessThan(
      previewHandler.indexOf('prepareExpensePreview('),
    );
  });

  test('authoritatively saves the visible draft before irreversible finalization', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const finalizeStart = page.indexOf('async function doFinalize()');
    const finalizeEnd = page.indexOf('\n  async function savePdfAgain()', finalizeStart);
    const finalizeHandler = page.slice(finalizeStart, finalizeEnd);

    expect(finalizeStart).toBeGreaterThan(-1);
    expect(finalizeHandler).toContain('const db = await getDb();');
    expect(finalizeHandler).toContain('await saveExpenseDraft(db, reportId, buildDraft());');
    expect(finalizeHandler.indexOf('saveExpenseDraft(')).toBeLessThan(
      finalizeHandler.indexOf('finalizeExpenseReport('),
    );
  });

  test('stacks rows based on available card width so large text cannot clip controls', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain('.expenses { container-type: inline-size;');
    expect(page).toContain('.editor { container-type: inline-size; }');
    expect(page).toContain('@container (max-width: 820px)');
    const narrowStyles = page.slice(page.indexOf('@container (max-width: 820px)'));
    expect(narrowStyles).toContain('.head { flex-wrap: wrap; }');
    expect(narrowStyles).toContain('.row-head { display: none; }');
    expect(narrowStyles).toContain('.row { grid-template-columns: 1fr;');
    expect(narrowStyles).toContain('.mobile-label { display: inline; }');
  });

  test('keeps fixed preview and confirmation overlays outside layout containment', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain("{#if finalizeError}<p class=\"error\">Couldn't save: {finalizeError}</p>{/if}\n  </div>\n\n  {#if showPreview");
  });

  test('does not expose a destructive draft-discard action', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).not.toContain('deleteExpenseDraft');
    expect(page).not.toContain('Discard draft');
    expect(page).not.toContain('Discard this unfinished expense report?');
    expect(page).not.toContain('discard-button');
  });

  test('holds navigation until the draft is saved and shows why it stayed', () => {
    const page = readSource('src/routes/expenses/+page.svelte');

    expect(page).toContain('guardDraftNavigation({');
    expect(page).toContain('isEditing: () => loaded && reportId !== null && !finalized,');
    expect(page).toContain('onBlocked: (message) => { leaveMessage = message; },');
    expect(page).toContain('{#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}');
    expect(page).not.toContain('onNavigate(');
    expect(page).not.toContain('flushPendingAutosave');
  });

  test('locks every draft control while an allowed navigation away loads', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const start = page.indexOf('{:else}\n  <div class="leave-lock" inert={leaving}>');
    const locked = page.slice(start, page.indexOf('\n<style>'));
    const section = page.slice(page.indexOf('{#snippet expenseSection('), page.indexOf('{/snippet}'));

    expect(page).toContain('let leaving = $state(false);');
    expect(page).toContain('onLeaving: (value) => { leaving = value; },');
    expect(start).toBeGreaterThan(-1);
    expect(locked.trimEnd()).toMatch(/<\/div>\n\{\/if\}$/);
    for (const control of [
      'id="expense-sequence"', '<DatePicker bind:value={reportDate}', '{@render expenseSection(category)}',
      'onclick={sortExpenseRows}', 'onclick={openPreview}', 'class="preview-overlay"', '<ConfirmDialog',
    ]) expect(locked, control).toContain(control);
    // Rows render through the snippet, so they sit inside the lock too.
    for (const control of ['bind:value={row.description}', 'onclick={undoDelete}', 'onclick={() => addExpense(category)}']) {
      expect(section, control).toContain(control);
    }
    expect(page).toContain('.leave-lock { display: contents; }');
  });

  test('moves keyboard focus to Undo on removal and back to the restored row', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const remove = page.slice(page.indexOf('function removeExpense(uid: string)'), page.indexOf('\n  function undoDelete()'));
    const restore = page.slice(page.indexOf('function undoDelete()'), page.indexOf('\n  function normalizeAmount('));

    expect(remove).toContain('void focusAfterRender(expenseUndoButtonId(result.removed.category));');
    expect(restore).toContain("void focusAfterRender(expenseRowFieldId(restored, 'date'));");
    expect(page).toContain('if (hadFocus) void focusAfterRender(addButton);');
  });

  test('makes Preview a keyboard modal like the mileage Preview', () => {
    const page = readSource('src/routes/expenses/+page.svelte');
    const open = page.slice(page.indexOf('async function openPreview()'), page.indexOf('\n  function closePreview()'));
    const close = page.slice(page.indexOf('function closePreview()'), page.indexOf('\n  function onPreviewKeydown('));
    const keys = page.slice(page.indexOf('function onPreviewKeydown(event: KeyboardEvent)'), page.indexOf('\n  function jumpToFirstBlocker()'));

    expect(open).toContain('previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;');
    expect(open).toContain('await tick();');
    expect(open).toContain('previewClose?.focus();');
    expect(close).toContain('showPreview = false;');
    expect(close).toContain('previewTrigger?.focus();');
    expect(keys).toContain("if (event.key === 'Escape')");
    expect(keys).toContain("if (event.key !== 'Tab' || !previewDialog) return;");
    expect(page).toContain('role="dialog" aria-label="Expense report preview" aria-modal="true"');
    expect(page).toContain('tabindex="-1" bind:this={previewDialog} onkeydown={onPreviewKeydown}>');
    expect(page).toContain('bind:this={previewClose} onclick={closePreview}>Close preview</button>');
  });
});
