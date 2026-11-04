<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import ExpenseView from '$lib/components/ExpenseView.svelte';
  import SaveStatusChip from '$lib/components/SaveStatusChip.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import { getDb } from '$lib/db';
  import {
    createExpenseDraft,
    finalizeExpenseReport,
    latestExpenseDraftId,
    loadExpenseDraft,
    peekNextExpenseSeq,
    saveExpenseDraft,
    takenExpenseSequences,
  } from '$lib/db/expense-repo';
  import {
    EXPENSE_CATEGORIES,
    EXPENSE_CATEGORY_LABELS,
    EXPENSE_CATEGORY_ROW_NOUNS,
    expenseSubtotalFor,
    expenseSubtotals,
  } from '$lib/expense/category';
  import { expenseFinalizeBlockers } from '$lib/expense/validation';
  import type {
    ExpenseCategory,
    ExpenseDraft,
    SectionedExpenseSnapshot,
  } from '$lib/expense/types';
  import { formatCents, formatDollars } from '$lib/money';
  import { saveExpensePdf } from '$lib/pdf/generate';
  import { backupNow } from '$lib/stores/backup';
  import { loadSettings } from '$lib/stores/settings';
  import { showSaveToast } from '$lib/stores/toast';
  import type { Settings } from '$lib/types';
  import {
    createAutosaveController,
    settleAutosaveBeforeManualSave,
    type AutosaveController,
  } from '$lib/ui/autosave';
  import { defaultInvoicePeriod } from '$lib/ui/date';
  import { guardDraftNavigation } from '$lib/ui/guardDraftNavigation';
  import {
    appendExpenseEditorRow,
    emptyExpenseEditorSections,
    expenseAddButtonId,
    expenseAmountCents,
    expenseBlockingRowCount,
    expenseDraftItems,
    expenseEditorRowUids,
    expenseEditorSections,
    expenseRowFieldId,
    expenseRowWarningsByUid,
    expenseUndoButtonId,
    firstExpenseBlockerTarget,
    moveExpenseEditorRow,
    newExpenseEditorRow,
    prepareExpensePreview,
    removeExpenseEditorRow,
    restoreExpenseEditorRow,
    sortExpenseEditorSections,
    type ExpenseEditorRow,
    type ExpenseEditorSections,
    type RemovedExpenseRow,
  } from '$lib/ui/expenseEditor';
  import {
    expenseSeqForPersistence,
    resolveExpenseSequenceState,
    shouldFillDefaultExpenseSequence,
  } from '$lib/ui/expenseSequence';
  import { handleAutosavingWindowCloseRequest } from '$lib/ui/windowClose';

  const ADD_LABELS: Record<ExpenseCategory, string> = {
    vehicle: 'Add a vehicle expense',
    general: 'Add a general/admin expense',
  };
  const PLACEHOLDERS: Record<ExpenseCategory, string> = {
    vehicle: 'Fuel, parking, car wash...',
    general: 'Office supplies, phone, postage...',
  };
  const otherSection = (category: ExpenseCategory): ExpenseCategory =>
    category === 'vehicle' ? 'general' : 'vehicle';
  // Arrows point at the other section: General/Admin sits below Vehicle.
  const MOVE_ARROWS: Record<ExpenseCategory, string> = { vehicle: '↓', general: '↑' };

  let loaded = $state(false);
  let settings = $state<Settings | null>(null);
  let reportId = $state<number | null>(null);
  let reportDate = $state('');
  let periodStart = $state('');
  let periodEnd = $state('');
  let sequenceText = $state('');
  let sections = $state<ExpenseEditorSections>(emptyExpenseEditorSections());
  let undo = $state<RemovedExpenseRow | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let takenSequences = $state<number[]>([]);
  let takenSequencesYear = $state<number | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let savedAt = $state('');
  let lastSavedJson = '';
  let autosave: AutosaveController | null = null;
  let leaveMessage = $state('');
  let leaving = $state(false);
  let unlisten: (() => void) | null = null;

  function reportYear(): number {
    return Number(reportDate.slice(0, 4)) || new Date().getFullYear();
  }

  function buildDraft(): ExpenseDraft {
    return {
      seq: expenseSeqForPersistence(sequenceState),
      year: reportYear(),
      reportDate,
      periodStart,
      periodEnd,
      items: expenseDraftItems(sections),
    };
  }

  async function focusAfterRender(id: string) {
    await tick();
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    element?.focus();
  }

  function addExpense(category: ExpenseCategory) {
    const row = newExpenseEditorRow(reportDate);
    sections = appendExpenseEditorRow(sections, category, row);
    void focusAfterRender(expenseRowFieldId(row.uid, 'date'));
  }

  function moveExpense(uid: string, target: ExpenseCategory) {
    sections = moveExpenseEditorRow(sections, uid, target);
    // Focus follows the row, so keyboard users stay on it in its new section.
    void focusAfterRender(expenseRowFieldId(uid, 'move'));
  }

  function clearUndo() {
    undo = null;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
  }

  function removeExpense(uid: string) {
    const result = removeExpenseEditorRow(sections, uid);
    if (!result) return;
    sections = result.sections;
    undo = result.removed;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(expireUndo, 8000);
    void focusAfterRender(expenseUndoButtonId(result.removed.category));
  }

  function expireUndo() {
    // Keep keyboard users on the page when the Undo button they're on disappears.
    const undoButton = undo ? expenseUndoButtonId(undo.category) : '';
    const addButton = undo ? expenseAddButtonId(undo.category) : '';
    const hadFocus = undoButton !== '' && document.activeElement?.id === undoButton;
    undo = null;
    undoTimer = null;
    if (hadFocus) void focusAfterRender(addButton);
  }

  function undoDelete() {
    if (!undo) return;
    const restored = undo.row.uid;
    sections = restoreExpenseEditorRow(sections, undo);
    clearUndo();
    void focusAfterRender(expenseRowFieldId(restored, 'date'));
  }

  function normalizeAmount(row: ExpenseEditorRow) {
    const cents = expenseAmountCents(row.amountText);
    if (cents > 0) row.amountText = formatCents(cents);
  }

  function sortExpenseRows() {
    sections = sortExpenseEditorSections(sections);
  }

  function makeAutosave() {
    autosave?.dispose();
    autosave = createAutosaveController({
      read: buildDraft,
      serialize: JSON.stringify,
      isSaved: (json) => json === lastSavedJson,
      markSaved: (json) => { lastSavedJson = json; },
      save: async (draft) => {
        if (reportId === null) throw new Error('No expense report draft is open.');
        await saveExpenseDraft(await getDb(), reportId, draft);
      },
      setState: (state) => { saveState = state; },
      onSaved: () => {
        savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        leaveMessage = '';
      },
    });
  }

  onMount(async () => {
    settings = await loadSettings();
    const defaults = defaultInvoicePeriod();
    const db = await getDb();
    let id = await latestExpenseDraftId(db);
    if (id === null) {
      id = await createExpenseDraft(db, {
        year: defaults.year,
        reportDate: defaults.issueDate,
        periodStart: defaults.periodStart,
        periodEnd: defaults.periodEnd,
      });
    }
    reportId = id;
    const draft = await loadExpenseDraft(db, id);
    reportDate = draft.reportDate;
    periodStart = draft.periodStart;
    periodEnd = draft.periodEnd;
    sequenceText = draft.seq === null ? '' : String(draft.seq);
    sections = expenseEditorSections(draft.items);
    lastSavedJson = JSON.stringify(buildDraft());
    makeAutosave();
    loaded = true;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const window = getCurrentWindow();
      unlisten = await window.onCloseRequested(async (event) => {
        await handleAutosavingWindowCloseRequest(event, {
          autosave,
          canFlush: reportId !== null && !finalized,
          destroy: () => window.destroy(),
          exit: async (code) => {
            const { exit } = await import('@tauri-apps/plugin-process');
            await exit(code);
          },
        });
      });
    } catch { /* browser test/dev mode */ }
  });

  onDestroy(() => {
    unlisten?.();
    autosave?.dispose();
    if (undoTimer) clearTimeout(undoTimer);
  });

  guardDraftNavigation({
    autosave: () => autosave,
    isEditing: () => loaded && reportId !== null && !finalized,
    onBlocked: (message) => { leaveMessage = message; },
    onLeaving: (value) => { leaving = value; },
  });

  $effect(() => {
    if (!loaded || reportId === null || finalized) return;
    const json = JSON.stringify(buildDraft());
    if (json !== lastSavedJson) autosave?.notifyChanged();
  });

  const sequenceState = $derived(resolveExpenseSequenceState({
    sequenceText,
    reportYear: reportYear(),
    takenSequences,
    takenSequencesYear,
  }));

  let sequenceRequest = 0;
  $effect(() => {
    const year = reportYear();
    const currentReportId = reportId;
    if (!loaded || currentReportId === null || finalized) return;
    const requestId = ++sequenceRequest;
    let cancelled = false;
    getDb().then(async (db) => {
      const [next, taken] = await Promise.all([
        peekNextExpenseSeq(db, year, currentReportId),
        takenExpenseSequences(db, year, currentReportId),
      ]);
      if (cancelled || requestId !== sequenceRequest || reportId !== currentReportId || reportYear() !== year) return;
      takenSequences = taken;
      takenSequencesYear = year;
      if (shouldFillDefaultExpenseSequence(sequenceText)) sequenceText = String(next);
    });
    return () => { cancelled = true; };
  });

  const draftForDisplay = $derived(buildDraft());
  const rowUids = $derived(expenseEditorRowUids(sections));
  const subtotals = $derived(expenseSubtotals(draftForDisplay.items));
  const totalCents = $derived(subtotals.totalCents);
  const blockers = $derived(expenseFinalizeBlockers(draftForDisplay));
  const rowWarningsByUid = $derived(expenseRowWarningsByUid(blockers, rowUids));
  const blockingRowCount = $derived(expenseBlockingRowCount(blockers));
  const canFinalize = $derived(blockers.length === 0 && sequenceState.status === 'ready');
  const canSort = $derived(EXPENSE_CATEGORIES.some((category) => sections[category].length > 1));
  const showExpenseHint = $derived(EXPENSE_CATEGORIES.every((category) =>
    sections[category].every((row) => !row.description.trim() && !row.amountText.trim())));

  let showPreview = $state(false);
  let previewSnapshot = $state<SectionedExpenseSnapshot | null>(null);
  let previewDialog = $state<HTMLDivElement>();
  let previewClose = $state<HTMLButtonElement>();
  let previewTrigger: HTMLElement | null = null;

  async function openPreview() {
    if (!settings || sequenceState.status !== 'ready' || sequenceState.draftSeq === null) return;
    sortExpenseRows();
    previewSnapshot = prepareExpensePreview(buildDraft(), settings, sequenceState.draftSeq);
    previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showPreview = true;
    await tick();
    previewClose?.focus();
  }

  function closePreview() {
    showPreview = false;
    previewTrigger?.focus();
  }

  function onPreviewKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreview();
      return;
    }
    if (event.key !== 'Tab' || !previewDialog) return;
    const focusable = [...previewDialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
    if (focusable.length === 0) return;
    // Wrap at either end, and pull focus back in if it sits on the dialog itself.
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  function jumpToFirstBlocker() {
    const target = firstExpenseBlockerTarget(buildDraft(), expenseEditorRowUids(sections));
    if (!target) return;
    const element = document.getElementById(target.id);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) element.focus();
    else element?.querySelector<HTMLElement>('input, button')?.focus();
  }

  let showConfirm = $state(false);
  let finalized = $state<SectionedExpenseSnapshot | null>(null);
  let finalizeSaving = $state(false);
  let finalizeError = $state('');

  async function doFinalize() {
    if (finalizeSaving || reportId === null || !canFinalize) return;
    finalizeSaving = true;
    finalizeError = '';
    try {
      await settleAutosaveBeforeManualSave(autosave, true);
      const db = await getDb();
      await saveExpenseDraft(db, reportId, buildDraft());
      finalized = await finalizeExpenseReport(db, reportId);
      showConfirm = false;
      showSaveToast(await saveExpensePdf(finalized));
      void backupNow();
    } catch (error) {
      finalizeError = (error as Error).message;
    } finally {
      finalizeSaving = false;
    }
  }

  async function savePdfAgain() {
    if (finalized) showSaveToast(await saveExpensePdf(finalized));
  }

  async function startNew() {
    const defaults = defaultInvoicePeriod();
    const db = await getDb();
    const id = await createExpenseDraft(db, {
      year: defaults.year,
      reportDate: defaults.issueDate,
      periodStart: defaults.periodStart,
      periodEnd: defaults.periodEnd,
    });
    reportId = id;
    reportDate = defaults.issueDate;
    periodStart = defaults.periodStart;
    periodEnd = defaults.periodEnd;
    sequenceText = '';
    takenSequences = [];
    takenSequencesYear = null;
    sections = emptyExpenseEditorSections();
    clearUndo();
    finalized = null;
    finalizeError = '';
    saveState = 'idle';
    lastSavedJson = JSON.stringify(buildDraft());
    makeAutosave();
  }
</script>

{#snippet expenseSection(category: ExpenseCategory)}
  {@const label = EXPENSE_CATEGORY_LABELS[category]}
  {@const target = otherSection(category)}
  <section class="card expenses {category}" aria-labelledby="expense-section-{category}-title">
    <header class="section-head">
      <h2 id="expense-section-{category}-title">{label}</h2>
      <span class="meta tnum">{sections[category].length} {sections[category].length === 1 ? 'row' : 'rows'} · {formatDollars(expenseSubtotalFor(subtotals, category))}</span>
    </header>
    {#if sections[category].length === 0}
      <p class="section-empty">No {label.toLowerCase()} yet.</p>
    {:else}
      <div class="row row-head" aria-hidden="true"><span>Date</span><span>Description</span><span>Amount</span><span></span></div>
    {/if}
    {#each sections[category] as row, index (row.uid)}
      {@const rowLabel = `${EXPENSE_CATEGORY_ROW_NOUNS[category]} ${index + 1}`}
      {@const rowWarnings = rowWarningsByUid.get(row.uid) ?? []}
      <div class="row" id={row.uid}>
        <label><span class="mobile-label">Date</span>
          <DatePicker bind:value={row.date} ariaLabel={`${rowLabel} date`}
            fieldId={expenseRowFieldId(row.uid, 'date')} block />
        </label>
        <label><span class="mobile-label">Description</span>
          <input id={expenseRowFieldId(row.uid, 'description')} bind:value={row.description}
            aria-label={`${rowLabel} description`} placeholder={PLACEHOLDERS[category]} />
        </label>
        <label><span class="mobile-label">Amount</span>
          <span class="money-input"><span>$</span><input id={expenseRowFieldId(row.uid, 'amount')}
            class="tnum" inputmode="decimal" bind:value={row.amountText}
            aria-label={`${rowLabel} amount`} placeholder="0.00" onblur={() => normalizeAmount(row)} /></span>
        </label>
        <div class="row-actions">
          <button id={expenseRowFieldId(row.uid, 'move')} type="button" class="move"
            title={`Move to ${EXPENSE_CATEGORY_LABELS[target]}`}
            aria-label={`Move ${rowLabel} to ${EXPENSE_CATEGORY_LABELS[target]}`}
            onclick={() => moveExpense(row.uid, target)}><span aria-hidden="true">{MOVE_ARROWS[category]}</span></button>
          <button type="button" class="del" title="Remove this row"
            onclick={() => removeExpense(row.uid)} aria-label={`Remove ${rowLabel}`}>✕</button>
        </div>
        {#if rowWarnings.length}
          <div class="warns">
            {#each rowWarnings as warning}<span>⚠ {warning}</span>{/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if undo?.category === category}
      <div class="undo">Row removed. <button id={expenseUndoButtonId(category)} type="button" onclick={undoDelete}>Undo</button></div>
    {/if}
    <button id={expenseAddButtonId(category)} type="button" class="add"
      onclick={() => addExpense(category)}>+ {ADD_LABELS[category]}</button>
  </section>
{/snippet}

{#if !loaded || !settings}
  <p class="muted">Loading...</p>
{:else if finalized}
  <section class="done">
    <div class="finalized-pill">FINALIZED · Expense report #{finalized.reportNumber}</div>
    <h1>Expense report #{finalized.reportNumber} saved</h1>
    <p class="done-total">Total <b class="tnum">{formatDollars(finalized.totalCents)}</b></p>
    <p class="muted">
      {#each EXPENSE_CATEGORIES as category, index (category)}{index ? ' · ' : ''}{EXPENSE_CATEGORY_LABELS[category]} <span class="tnum">{formatDollars(expenseSubtotalFor(finalized, category))}</span>{/each}
    </p>
    <p class="muted">This report is locked and will always reprint exactly as saved.</p>
    {#if finalizeError}<p class="error">{finalizeError}</p>{/if}
    <div class="actions">
      <BigButton onclick={startNew}>Start a new expense report</BigButton>
      <BigButton variant="secondary" onclick={savePdfAgain}>Save PDF again</BigButton>
    </div>
  </section>
{:else}
  <div class="leave-lock" inert={leaving}>
  <div class="editor">
  <div class="head">
    <h1>New Expense Report</h1>
    <StatusPill status="draft" />
    <label class="expense-number" for="expense-sequence">
      <span>Expense report #</span>
      <input id="expense-sequence" class:warn={sequenceState.status === 'invalid'}
        inputmode="numeric" bind:value={sequenceText} aria-describedby="expense-sequence-help" />
      <span>- {reportYear()}</span>
    </label>
    <span id="expense-sequence-help" class:warn-msg={sequenceState.status === 'invalid'} class="seq-msg">
      {sequenceState.message || sequenceState.helperMessage || `Will be #${sequenceState.draftSeq ?? ''}-${reportYear()}`}
    </span>
    <span class="spacer"></span>
    <SaveStatusChip state={saveState} {savedAt} />
  </div>

  <div class="period">
    <label>Reporting period
      <span class="dates">
        <span id="expense-period-start"><DatePicker bind:value={periodStart} ariaLabel="Reporting period start" /></span>
        <span>to</span>
        <span id="expense-period-end"><DatePicker bind:value={periodEnd} ariaLabel="Reporting period end" /></span>
      </span>
    </label>
    <label>Report date
      <span id="expense-report-date"><DatePicker bind:value={reportDate} ariaLabel="Expense report date" /></span>
    </label>
  </div>

  {#if showExpenseHint}
    <p class="empty-hint">Add each expense to the Vehicle or General/Admin section below. Rows stay where you put them until you sort, preview, or finish.</p>
  {/if}

  <div class="row-tools">
    <button type="button" class="secondary-button" disabled={!canSort} onclick={sortExpenseRows}>Sort rows by date, then description</button>
  </div>

  <div class="sections">
    {#each EXPENSE_CATEGORIES as category (category)}
      {@render expenseSection(category)}
    {/each}
  </div>

  <div class="dock">
    {#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}
    <div class="figs">
      {#each EXPENSE_CATEGORIES as category (category)}
        <span class="fig"><span class="lbl">{EXPENSE_CATEGORY_LABELS[category]}</span> <b class="tnum">{formatDollars(expenseSubtotalFor(subtotals, category))}</b></span>
      {/each}
      <div class="total"><span>Total</span><b class="tnum">{formatDollars(totalCents)}</b></div>
    </div>
    <div class="actions">
      {#if blockers.length > 0}
        {#if blockers[0].itemIndex !== null}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>Fix {blockingRowCount} {blockingRowCount === 1 ? 'row' : 'rows'} to finish →</button>
        {:else}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>{blockers[0].message} Fix it →</button>
        {/if}
      {/if}
      <BigButton variant="secondary" onclick={openPreview}
        disabled={rowUids.length === 0 || sequenceState.status !== 'ready'}>Preview</BigButton>
      <BigButton onclick={() => (showConfirm = true)} disabled={!canFinalize}>Lock &amp; Save</BigButton>
    </div>
  </div>
  {#if finalizeError}<p class="error">Couldn't save: {finalizeError}</p>{/if}
  </div>

  {#if showPreview && previewSnapshot}
    <div class="preview-overlay" role="dialog" aria-label="Expense report preview" aria-modal="true"
      tabindex="-1" bind:this={previewDialog} onkeydown={onPreviewKeydown}>
      <div class="preview-bar">
        <span>Preview - not locked yet. Each section is sorted by date, then description, and the editor now matches this order.</span>
        <button class="secondary-button" bind:this={previewClose} onclick={closePreview}>Close preview</button>
      </div>
      <div class="preview-body"><ExpenseView snap={previewSnapshot} /></div>
    </div>
  {/if}

  {#if showConfirm}
    <ConfirmDialog title="Lock &amp; Save this expense report?"
      confirmLabel={finalizeSaving ? 'Saving...' : 'Finalize & Save'}
      confirmDisabled={finalizeSaving} onConfirm={doFinalize} onCancel={() => (showConfirm = false)}>
      <p>{rowUids.length} {rowUids.length === 1 ? 'expense' : 'expenses'}</p>
      {#each EXPENSE_CATEGORIES as category (category)}
        <p class="confirm-line"><span>{EXPENSE_CATEGORY_LABELS[category]}</span><span class="tnum">{formatDollars(expenseSubtotalFor(subtotals, category))}</span></p>
      {/each}
      <p class="confirm-total">Total {formatDollars(totalCents)}</p>
      <p class="muted">Each section will be sorted by date, then description, and the report locked. It cannot be edited after this.</p>
      {#if finalizeError}<p class="error">Couldn't save: {finalizeError}</p>{/if}
    </ConfirmDialog>
  {/if}
  </div>
{/if}

<style>
  h1 { margin: 0; font-size: var(--fs-xl); }
  .muted { margin: 0; color: var(--text-secondary); }
  /* Inert while the next page loads after leaving; adds no box of its own. */
  .leave-lock { display: contents; }
  .editor { container-type: inline-size; }
  .head { display: flex; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-4); }
  .head .spacer { flex: 1; }
  .finalized-pill { display: inline-flex; align-items: center; min-height: 36px; padding: 0 var(--sp-3); border-radius: var(--r-full); font-size: var(--fs-sm); font-weight: 700; }
  .finalized-pill { background: var(--accent-tint); color: var(--accent-strong); }
  .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  label { display: flex; flex-direction: column; gap: var(--sp-2); color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 600; }
  input { width: 100%; min-height: var(--input-h); padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); }
  input.warn { border-color: var(--amber-600); border-left-width: 3px; }
  .expense-number { flex-direction: row; align-items: center; gap: var(--sp-2); }
  .expense-number input { width: 72px; padding: 0 10px; font-size: var(--fs-base); }
  .seq-msg { color: var(--text-muted); font-size: var(--fs-sm); }
  .seq-msg.warn-msg { color: var(--amber-600); }
  .period { display: flex; gap: var(--sp-8); margin-bottom: var(--sp-6); flex-wrap: wrap; }
  .period .dates { display: flex; align-items: center; gap: var(--sp-2); }
  .empty-hint { margin: 0 0 var(--sp-4); padding: var(--sp-3) var(--sp-4); background: var(--accent-tint); color: var(--text-secondary); border-radius: var(--r-md); font-size: var(--fs-sm); }
  .row-tools { display: flex; justify-content: flex-end; gap: var(--sp-3); margin: 0 0 var(--sp-3); }
  .secondary-button { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); font-weight: 600; cursor: pointer; }
  .secondary-button:hover:not(:disabled) { background: var(--accent-tint); }
  .secondary-button:disabled { opacity: .55; cursor: default; }
  .sections { display: flex; flex-direction: column; gap: var(--sp-6); margin-bottom: 96px; }
  .expenses { container-type: inline-size; overflow: hidden; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
  .vehicle .section-head { background: var(--accent-tint); }
  .general .section-head { background: var(--bg-sunken); }
  h2 { margin: 0; font-size: var(--fs-lg); font-weight: 600; }
  .section-head .meta { color: var(--text-secondary); font-weight: 600; }
  .section-empty { margin: 0; padding: var(--sp-4); color: var(--text-muted); }
  .row { display: grid; grid-template-columns: calc(220px * var(--fs-scale)) minmax(220px, 1fr) 170px calc(88px + var(--sp-2)); gap: var(--sp-3); align-items: end; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
  .row-head { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 700; align-items: center; padding-top: var(--sp-2); padding-bottom: var(--sp-2); }
  .mobile-label { display: none; }
  .money-input { display: flex; align-items: center; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); padding-left: var(--sp-3); color: var(--text-secondary); }
  .money-input:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }
  .money-input input { border: 0; outline: 0; }
  .row-actions { display: flex; gap: var(--sp-2); }
  .move { width: 44px; height: var(--input-h); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-lg); cursor: pointer; }
  .move:hover { background: var(--accent-tint); border-color: var(--accent-strong); }
  .del { width: 44px; height: var(--input-h); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; }
  .del:hover { color: var(--red-600); border-color: var(--red-600); }
  .add { width: 100%; min-height: 48px; border: none; border-top: 1px solid var(--border); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }
  .add:hover { background: var(--accent-tint); }
  .undo { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); background: var(--bg-sunken); color: var(--text-secondary); border-top: 1px solid var(--border); }
  .undo button { min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-weight: 600; cursor: pointer; }
  .warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
  .warns span { color: var(--amber-600); font-size: var(--fs-sm); }
  .dock { position: sticky; bottom: 0; margin: 0 calc(-1 * var(--sp-8)) calc(-1 * var(--sp-8)); display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); flex-wrap: wrap; padding: var(--sp-3) var(--sp-8); background: var(--bg-surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 16px rgba(0,0,0,.08); }
  .figs { display: flex; align-items: baseline; gap: var(--sp-3) var(--sp-6); flex-wrap: wrap; }
  .fig { color: var(--text-secondary); font-size: var(--fs-sm); }
  .fig b { color: var(--text-primary); font-size: var(--fs-base); }
  .total { display: flex; align-items: baseline; gap: var(--sp-3); font-size: var(--fs-xl); color: var(--accent-strong); }
  .leave-blocked { flex: 1 0 100%; margin: 0; color: var(--red-600); font-weight: 600; }
  .actions { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .fix { max-width: 320px; border: 0; background: transparent; color: var(--amber-600); text-decoration: underline; cursor: pointer; text-align: right; }
  .error { color: var(--red-600); }
  .confirm-line { display: flex; justify-content: space-between; gap: var(--sp-4); margin: 0; }
  .confirm-total { font-size: var(--fs-lg); font-weight: 700; }
  .done { max-width: 600px; margin: var(--sp-12) auto; display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-8); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .done-total { margin: 0; font-size: var(--fs-lg); }
  .preview-overlay { position: fixed; inset: 0; z-index: 80; background: var(--bg-canvas); display: flex; flex-direction: column; }
  .preview-overlay:focus { outline: none; }
  .preview-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); }
  .preview-body { flex: 1; min-height: 0; overflow: auto; padding: var(--sp-6); display: flex; justify-content: center; align-items: flex-start; }
  @media (max-width: 1000px) {
    .row { grid-template-columns: calc(200px * var(--fs-scale)) minmax(160px, 1fr) 150px calc(88px + var(--sp-2)); }
  }
  @container (max-width: 820px) {
    .head { flex-wrap: wrap; }
    .row-head { display: none; }
    .row { grid-template-columns: 1fr; align-items: stretch; padding: var(--sp-4); }
    .mobile-label { display: inline; }
    .row-actions { justify-self: start; }
    .dock { margin-left: calc(-1 * var(--sp-4)); margin-right: calc(-1 * var(--sp-4)); padding: var(--sp-3) var(--sp-4); }
    .actions { width: 100%; }
    .fix { max-width: none; text-align: left; }
  }
</style>
