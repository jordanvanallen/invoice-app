<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
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
  import { sortExpenseItems } from '$lib/expense/order';
  import { expenseFinalizeBlockers, expenseTotal } from '$lib/expense/validation';
  import type { ExpenseDraft, ExpenseSnapshot } from '$lib/expense/types';
  import { formatCents, formatDollars, parseDollars } from '$lib/money';
  import { saveExpensePdf } from '$lib/pdf/generate';
  import { backupNow } from '$lib/stores/backup';
  import { loadSettings } from '$lib/stores/settings';
  import { showSaveToast } from '$lib/stores/toast';
  import type { Settings } from '$lib/types';
  import {
    createAutosaveController,
    flushPendingAutosave,
    settleAutosaveBeforeManualSave,
    type AutosaveController,
  } from '$lib/ui/autosave';
  import { defaultInvoicePeriod } from '$lib/ui/date';
  import {
    expenseBlockingRowCount,
    expenseRowDateRangeWarning,
    firstExpenseBlockerTarget,
    prepareExpensePreview,
  } from '$lib/ui/expenseEditor';
  import {
    expenseSeqForPersistence,
    resolveExpenseSequenceState,
    shouldFillDefaultExpenseSequence,
  } from '$lib/ui/expenseSequence';
  import { handleAutosavingWindowCloseRequest } from '$lib/ui/windowClose';

  interface ExpenseEditorRow {
    uid: string;
    position: number;
    date: string;
    description: string;
    amountText: string;
  }

  let uidCounter = 0;
  const nextUid = () => `expense-${++uidCounter}`;
  const toEditorRow = (item: ExpenseDraft['items'][number]): ExpenseEditorRow => ({
    uid: nextUid(),
    position: item.position,
    date: item.date,
    description: item.description,
    amountText: item.amountCents > 0 ? formatCents(item.amountCents) : '',
  });

  let loaded = $state(false);
  let settings = $state<Settings | null>(null);
  let reportId = $state<number | null>(null);
  let reportDate = $state('');
  let periodStart = $state('');
  let periodEnd = $state('');
  let sequenceText = $state('');
  let rows = $state<ExpenseEditorRow[]>([]);
  let takenSequences = $state<number[]>([]);
  let takenSequencesYear = $state<number | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let savedAt = $state('');
  let lastSavedJson = '';
  let autosave: AutosaveController | null = null;
  let unlisten: (() => void) | null = null;

  function reportYear(): number {
    return Number(reportDate.slice(0, 4)) || new Date().getFullYear();
  }

  function amountCents(text: string): number {
    if (!text.trim()) return 0;
    try { return parseDollars(text); } catch { return 0; }
  }

  function buildDraft(): ExpenseDraft {
    return {
      seq: expenseSeqForPersistence(sequenceState),
      year: reportYear(),
      reportDate,
      periodStart,
      periodEnd,
      items: rows.map((row, position) => ({
        position,
        date: row.date,
        description: row.description,
        amountCents: amountCents(row.amountText),
      })),
    };
  }

  function blankRow(date = reportDate): ExpenseEditorRow {
    return { uid: nextUid(), position: rows.length, date, description: '', amountText: '' };
  }

  function addExpense() {
    rows = [...rows, blankRow()];
  }

  function removeExpense(uid: string) {
    rows = rows.filter((row) => row.uid !== uid)
      .map((row, position) => ({ ...row, position }));
  }

  function normalizeAmount(row: ExpenseEditorRow) {
    const cents = amountCents(row.amountText);
    if (cents > 0) row.amountText = formatCents(cents);
  }

  function sortExpenseRows() {
    rows = sortExpenseItems(rows).map((row, position) => ({ ...row, position }));
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
    rows = draft.items.map(toEditorRow);
    if (rows.length === 0) rows = [blankRow(reportDate)];
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
  });

  onNavigate(() => flushPendingAutosave(autosave, loaded && reportId !== null && !finalized));

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
  const totalCents = $derived(expenseTotal(draftForDisplay.items));
  const blockers = $derived(expenseFinalizeBlockers(draftForDisplay));
  const blockingRowCount = $derived(expenseBlockingRowCount(blockers));
  const canFinalize = $derived(blockers.length === 0 && sequenceState.status === 'ready');
  const showExpenseHint = $derived(
    rows.every((row) => !row.description.trim() && !row.amountText.trim()),
  );

  let showPreview = $state(false);
  let previewSnapshot = $state<ExpenseSnapshot | null>(null);
  function openPreview() {
    if (!settings || sequenceState.status !== 'ready' || sequenceState.draftSeq === null) return;
    sortExpenseRows();
    previewSnapshot = prepareExpensePreview(buildDraft(), settings, sequenceState.draftSeq);
    showPreview = true;
  }

  function jumpToFirstBlocker() {
    const target = firstExpenseBlockerTarget(buildDraft());
    if (!target) return;
    const element = document.getElementById(target.id);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) element.focus();
    else element?.querySelector<HTMLElement>('input, button')?.focus();
  }

  let showConfirm = $state(false);
  let finalized = $state<ExpenseSnapshot | null>(null);
  let finalizeSaving = $state(false);
  let finalizeError = $state('');

  async function doFinalize() {
    if (finalizeSaving || reportId === null || !canFinalize) return;
    finalizeSaving = true;
    finalizeError = '';
    try {
      await settleAutosaveBeforeManualSave(autosave, true);
      finalized = await finalizeExpenseReport(await getDb(), reportId);
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
    rows = [blankRow(defaults.issueDate)];
    finalized = null;
    finalizeError = '';
    saveState = 'idle';
    lastSavedJson = JSON.stringify(buildDraft());
    makeAutosave();
  }
</script>

{#if !loaded || !settings}
  <p class="muted">Loading...</p>
{:else if finalized}
  <section class="done">
    <div class="finalized-pill">FINALIZED · Expense report #{finalized.reportNumber}</div>
    <h1>Expense report #{finalized.reportNumber} saved</h1>
    <p class="done-total">Total <b class="tnum">{formatDollars(finalized.totalCents)}</b></p>
    <p class="muted">This report is locked and will always reprint exactly as saved.</p>
    {#if finalizeError}<p class="error">{finalizeError}</p>{/if}
    <div class="actions">
      <BigButton onclick={startNew}>Start a new expense report</BigButton>
      <BigButton variant="secondary" onclick={savePdfAgain}>Save PDF again</BigButton>
    </div>
  </section>
{:else}
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
    <p class="empty-hint">Add your expenses below. Rows stay where you put them until you sort, preview, or finish.</p>
  {/if}

  <div class="row-tools">
    <button type="button" class="secondary-button" disabled={rows.length < 2} onclick={sortExpenseRows}>Sort rows by date</button>
  </div>

  <section class="card expenses" aria-label="Expense rows">
    <div class="row row-head" aria-hidden="true"><span>Date</span><span>Description</span><span>Amount</span><span></span></div>
    {#each rows as row, index (row.uid)}
      {@const dateRangeWarning = expenseRowDateRangeWarning(blockers, index)}
      <div class="row" id="expense-row-{index}">
        <label><span class="mobile-label">Date</span>
          <span id="expense-row-{index}-date"><DatePicker bind:value={row.date} ariaLabel={`Expense ${index + 1} date`} block /></span>
        </label>
        <label><span class="mobile-label">Description</span>
          <input id="expense-row-{index}-description" bind:value={row.description}
            aria-label={`Expense ${index + 1} description`} placeholder="Fuel, parking, meals..." />
        </label>
        <label><span class="mobile-label">Amount</span>
          <span class="money-input"><span>$</span><input id="expense-row-{index}-amount"
            class="tnum" inputmode="decimal" bind:value={row.amountText}
            aria-label={`Expense ${index + 1} amount`} placeholder="0.00" onblur={() => normalizeAmount(row)} /></span>
        </label>
        <button type="button" class="del" title="Remove this row"
          onclick={() => removeExpense(row.uid)} aria-label={`Remove expense ${index + 1}`}>✕</button>
        {#if dateRangeWarning}
          <div class="warns"><span>⚠ {dateRangeWarning}</span></div>
        {/if}
      </div>
    {/each}
    <button id="expense-add-row" type="button" class="add" onclick={addExpense}>+ Add an expense</button>
  </section>

  <div class="dock">
    <div class="total"><span>Total</span><b class="tnum">{formatDollars(totalCents)}</b></div>
    <div class="actions">
      {#if blockers.length > 0}
        {#if blockers[0].itemIndex !== null}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>Fix {blockingRowCount} {blockingRowCount === 1 ? 'row' : 'rows'} to finish →</button>
        {:else}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>{blockers[0].message} Fix it →</button>
        {/if}
      {/if}
      <BigButton variant="secondary" onclick={openPreview}
        disabled={rows.length === 0 || sequenceState.status !== 'ready'}>Preview</BigButton>
      <BigButton onclick={() => (showConfirm = true)} disabled={!canFinalize}>Lock &amp; Save</BigButton>
    </div>
  </div>
  {#if finalizeError}<p class="error">Couldn't save: {finalizeError}</p>{/if}

  {#if showPreview && previewSnapshot}
    <div class="preview-overlay" role="dialog" aria-label="Expense report preview" aria-modal="true">
      <div class="preview-bar">
        <span>Preview - not locked yet. The editor now matches this date order.</span>
        <button class="secondary-button" onclick={() => (showPreview = false)}>Close preview</button>
      </div>
      <div class="preview-body"><ExpenseView snap={previewSnapshot} /></div>
    </div>
  {/if}

  {#if showConfirm}
    <ConfirmDialog title="Lock &amp; Save this expense report?"
      confirmLabel={finalizeSaving ? 'Saving...' : 'Finalize & Save'}
      confirmDisabled={finalizeSaving} onConfirm={doFinalize} onCancel={() => (showConfirm = false)}>
      <p>{rows.length} {rows.length === 1 ? 'expense' : 'expenses'}</p>
      <p class="confirm-total">Total {formatDollars(totalCents)}</p>
      <p class="muted">The report will be sorted by date and locked. It cannot be edited after this.</p>
      {#if finalizeError}<p class="error">Couldn't save: {finalizeError}</p>{/if}
    </ConfirmDialog>
  {/if}
{/if}

<style>
  h1 { margin: 0; font-size: var(--fs-xl); }
  .muted { margin: 0; color: var(--text-secondary); }
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
  .row-tools { display: flex; justify-content: flex-end; margin: 0 0 var(--sp-3); }
  .secondary-button { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); font-weight: 600; cursor: pointer; }
  .secondary-button:hover:not(:disabled) { background: var(--accent-tint); }
  .secondary-button:disabled { opacity: .55; cursor: default; }
  .expenses { overflow: hidden; margin-bottom: 96px; }
  .row { display: grid; grid-template-columns: calc(220px * var(--fs-scale)) minmax(220px, 1fr) 170px 44px; gap: var(--sp-3); align-items: end; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
  .row-head { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 700; align-items: center; padding-top: var(--sp-2); padding-bottom: var(--sp-2); }
  .mobile-label { display: none; }
  .money-input { display: flex; align-items: center; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); padding-left: var(--sp-3); color: var(--text-secondary); }
  .money-input:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }
  .money-input input { border: 0; outline: 0; }
  .del { width: 44px; height: var(--input-h); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; }
  .del:hover { color: var(--red-600); border-color: var(--red-600); }
  .add { width: 100%; min-height: 48px; border: none; border-top: 1px solid var(--border); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }
  .add:hover { background: var(--accent-tint); }
  .warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
  .warns span { color: var(--amber-600); font-size: var(--fs-sm); }
  .dock { position: sticky; bottom: 0; margin: 0 calc(-1 * var(--sp-8)) calc(-1 * var(--sp-8)); display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); flex-wrap: wrap; padding: var(--sp-3) var(--sp-8); background: var(--bg-surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 16px rgba(0,0,0,.08); }
  .total { display: flex; align-items: baseline; gap: var(--sp-3); font-size: var(--fs-xl); color: var(--accent-strong); }
  .actions { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .fix { max-width: 320px; border: 0; background: transparent; color: var(--amber-600); text-decoration: underline; cursor: pointer; text-align: right; }
  .error { color: var(--red-600); }
  .confirm-total { font-size: var(--fs-lg); font-weight: 700; }
  .done { max-width: 600px; margin: var(--sp-12) auto; display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-8); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .done-total { margin: 0; font-size: var(--fs-lg); }
  .preview-overlay { position: fixed; inset: 0; z-index: 80; background: var(--bg-canvas); display: flex; flex-direction: column; }
  .preview-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); }
  .preview-body { flex: 1; min-height: 0; overflow: auto; padding: var(--sp-6); display: flex; justify-content: center; align-items: flex-start; }
  @media (max-width: 1000px) {
    .row { grid-template-columns: calc(200px * var(--fs-scale)) minmax(160px, 1fr) 150px 44px; }
  }
  @media (max-width: 760px) {
    .head { flex-wrap: wrap; }
    .row-head { display: none; }
    .row { grid-template-columns: 1fr; align-items: stretch; padding: var(--sp-4); }
    .mobile-label { display: inline; }
    .del { justify-self: start; }
    .dock { margin-left: calc(-1 * var(--sp-4)); margin-right: calc(-1 * var(--sp-4)); padding: var(--sp-3) var(--sp-4); }
    .actions { width: 100%; }
    .fix { max-width: none; text-align: left; }
  }
</style>
