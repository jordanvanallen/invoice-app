<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import BigButton from '$lib/components/BigButton.svelte';
  import HistoryRangeControls from '$lib/components/HistoryRangeControls.svelte';
  import { getDb } from '$lib/db';
  import {
    duplicateExpenseReport,
    expenseSummaryForRange,
    listFinalizedExpenses,
    listVoidedExpenses,
    reprintExpenseSnapshot,
    restoreExpenseReport,
    searchExpenses,
  } from '$lib/db/expense-repo';
  import type { ExpenseListItem } from '$lib/expense/types';
  import {
    calendarYearRange,
    createLatestRequestGate,
    filterHistoryRows,
    groupHistoryRows,
    historyRangeLabel,
    partitionHistoryRows,
    resolveHistoryRange,
    sumExpenseHistory,
    type ClosedDateRange,
  } from '$lib/history/history';
  import { formatDollars } from '$lib/money';
  import { saveExpensePdf, saveExpenseSummaryPdf } from '$lib/pdf/generate';
  import { loadSettings } from '$lib/stores/settings';
  import { showSaveToast } from '$lib/stores/toast';
  import { defaultInvoicePeriod, toIsoDate } from '$lib/ui/date';
  import '$lib/styles/history.css';

  type LoadState = 'loading' | 'ready' | 'error';
  type SearchState = 'idle' | 'loading' | 'ready' | 'error';

  let loadState = $state<LoadState>('loading');
  let loadError = $state('');
  let finalized = $state<ExpenseListItem[]>([]);
  let cancelled = $state<ExpenseListItem[]>([]);
  let query = $state('');
  let searchRows = $state<ExpenseListItem[]>([]);
  let searchState = $state<SearchState>('idle');
  let openYears = $state<Record<number, boolean>>({});
  let cancelledOpen = $state(false);
  let cancelledToggle = $state<HTMLButtonElement>();
  let rangeStart = $state('');
  let rangeEnd = $state('');
  let busyAction = $state('');
  let errorMessage = $state('');
  const searchGate = createLatestRequestGate();
  const currentYear = new Date().getFullYear();

  const searching = $derived(query.trim().length > 0);
  const resolution = $derived(resolveHistoryRange(rangeStart, rangeEnd));
  const rangedFinalized = $derived(filterHistoryRows(
    finalized,
    (report) => report.reportDate,
    resolution.range,
  ));
  const rangedCancelled = $derived(filterHistoryRows(
    cancelled,
    (report) => report.reportDate,
    resolution.range,
  ));
  const grouped = $derived(groupHistoryRows(rangedFinalized, (report) => report.reportDate).map((group) => ({
    year: group.year,
    reports: group.rows,
    rollup: sumExpenseHistory(group.rows),
  })));
  const currentYearRollup = $derived(sumExpenseHistory(
    rangedFinalized.filter((report) => report.reportDate.startsWith(`${currentYear}-`)),
  ));
  const rangedSearchRows = $derived(filterHistoryRows(
    searchRows,
    (report) => report.reportDate,
    resolution.range,
  ));
  const searchParts = $derived(partitionHistoryRows(rangedSearchRows));
  const visibleCancelled = $derived(searching ? searchParts.void : rangedCancelled);
  const hasSourceRecords = $derived(finalized.length > 0 || cancelled.length > 0);

  function isYearOpen(year: number): boolean {
    return openYears[year] ?? true;
  }

  function toggleYear(year: number): void {
    openYears = { ...openYears, [year]: !isYearOpen(year) };
  }

  async function loadAll(): Promise<void> {
    const db = await getDb();
    const [nextFinalized, nextCancelled] = await Promise.all([
      listFinalizedExpenses(db),
      listVoidedExpenses(db),
    ]);
    finalized = nextFinalized;
    cancelled = nextCancelled;
    const nextOpenYears: Record<number, boolean> = {};
    for (const group of groupHistoryRows(nextFinalized, (report) => report.reportDate)) {
      nextOpenYears[group.year] = openYears[group.year] ?? true;
    }
    openYears = nextOpenYears;
  }

  async function loadPage(): Promise<void> {
    loadState = 'loading';
    loadError = '';
    try {
      await loadAll();
      loadState = 'ready';
    } catch (error) {
      loadError = (error as Error).message;
      loadState = 'error';
    }
  }

  onMount(() => {
    void loadPage();
  });

  async function executeSearch(value: string): Promise<void> {
    const requestId = searchGate.begin();
    searchRows = [];
    searchState = 'loading';
    errorMessage = '';
    try {
      const rows = await searchExpenses(await getDb(), value);
      if (!searchGate.isCurrent(requestId)) return;
      searchRows = rows;
      searchState = 'ready';
    } catch (error) {
      if (!searchGate.isCurrent(requestId)) return;
      searchState = 'error';
      errorMessage = (error as Error).message;
    }
  }

  $effect(() => {
    const value = query.trim();
    if (!value) {
      searchGate.begin();
      searchRows = [];
      searchState = 'idle';
      return;
    }
    void executeSearch(value);
  });

  $effect(() => {
    if (searching && searchState === 'ready' && visibleCancelled.length > 0) {
      cancelledOpen = true;
    }
  });

  async function runAction(key: string, action: () => Promise<void>): Promise<void> {
    if (busyAction) return;
    busyAction = key;
    errorMessage = '';
    try {
      await action();
    } catch (error) {
      errorMessage = (error as Error).message;
    } finally {
      busyAction = '';
    }
  }

  function downloadPdf(report: ExpenseListItem): Promise<void> {
    return runAction(`pdf-${report.id}`, async () => {
      const snapshot = await reprintExpenseSnapshot(await getDb(), report.id);
      showSaveToast(await saveExpensePdf(snapshot));
    });
  }

  function duplicate(report: ExpenseListItem): Promise<void> {
    return runAction(`duplicate-${report.id}`, async () => {
      const defaults = defaultInvoicePeriod();
      await duplicateExpenseReport(await getDb(), report.id, {
        year: defaults.year,
        reportDate: defaults.issueDate,
        periodStart: defaults.periodStart,
        periodEnd: defaults.periodEnd,
      });
      await goto('/expenses');
    });
  }

  function restore(report: ExpenseListItem): Promise<void> {
    return runAction(`restore-${report.id}`, async () => {
      await restoreExpenseReport(await getDb(), report.id);
      await loadAll();
      const value = query.trim();
      if (value) await executeSearch(value);
    });
  }

  async function showCancelled(): Promise<void> {
    cancelledOpen = true;
    await tick();
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('cancelled-expense-reports')?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    cancelledToggle?.focus();
  }

  async function saveExpenseRangeSummary(
    range: ClosedDateRange | null,
    rangeLabel: string,
    fileName: string,
  ): Promise<void> {
    const [summary, settings] = await Promise.all([
      expenseSummaryForRange(await getDb(), range),
      loadSettings(),
    ]);
    if (summary.reports.length === 0) {
      throw new Error('No finalized expense reports exist in that date range.');
    }
    showSaveToast(await saveExpenseSummaryPdf({
      rangeLabel,
      preparedOn: toIsoDate(new Date()),
      businessName: settings.inspectorName || 'My business',
      reports: summary.reports,
      items: summary.items,
    }, fileName));
  }

  function exportRange(): Promise<void> {
    return runAction('range-export', async () => {
      const resolution = resolveHistoryRange(rangeStart, rangeEnd);
      if (resolution.kind === 'invalid') return;
      const range = resolution.range ? Object.freeze({ ...resolution.range }) : null;
      const rangeLabel = historyRangeLabel(range);
      const fileName = range
        ? `Expense-Summary-${range.start}_to_${range.end}.pdf`
        : 'Expense-Summary-All-Time.pdf';
      await saveExpenseRangeSummary(range, rangeLabel, fileName);
    });
  }

  function exportYear(year: number): Promise<void> {
    return runAction(`year-export-${year}`, async () => {
      const range = calendarYearRange(year);
      await saveExpenseRangeSummary(
        range,
        historyRangeLabel(range, year),
        `Expense-Summary-${year}.pdf`,
      );
    });
  }
</script>

<div class="history-head">
  <div>
    <h1>Expense History</h1>
    <p>Finalized expense reports, kept separately from invoices.</p>
  </div>
  {#if visibleCancelled.length > 0}
    <button
      class="history-cancelled-shortcut"
      onclick={showCancelled}
      aria-controls="cancelled-expense-reports"
    >Cancelled expense reports ({visibleCancelled.length})</button>
  {/if}
</div>

{#if errorMessage}
  <p class="history-error" role="alert">{errorMessage}</p>
{/if}

{#snippet reportRow(report: ExpenseListItem, allowRestore = false)}
  <li class="history-row">
    <button
      class="history-number"
      onclick={() => goto(`/expense/${report.id}`)}
      title="View expense report #{report.reportNumber}"
    >#{report.reportNumber}</button>
    <span class="history-date">{report.reportDate}</span>
    <span class="history-amount tnum">{formatDollars(report.totalCents)}</span>
    <span class="history-actions">
      {#if allowRestore}
        <button
          class="primary"
          disabled={!!busyAction}
          onclick={() => restore(report)}
        >{busyAction === `restore-${report.id}` ? 'Restoring…' : 'Restore'}</button>
      {/if}
      <button onclick={() => goto(`/expense/${report.id}`)}>View</button>
      {#if !allowRestore}
        <button disabled={!!busyAction} onclick={() => downloadPdf(report)}>
          {busyAction === `pdf-${report.id}` ? 'Saving…' : 'Download PDF'}
        </button>
        <button disabled={!!busyAction} onclick={() => duplicate(report)}>
          {busyAction === `duplicate-${report.id}` ? 'Opening…' : 'Duplicate'}
        </button>
      {/if}
    </span>
  </li>
{/snippet}

{#if loadState === 'loading'}
  <p class="history-status" role="status">Loading expense history…</p>
{:else if loadState === 'error'}
  <div class="history-empty">
    <p class="history-error" role="alert">Could not load expense history: {loadError}</p>
    <button class="history-export" onclick={loadPage}>Retry</button>
  </div>
{:else if !hasSourceRecords}
  <div class="history-empty">
    <p>No expense reports yet.</p>
    <BigButton onclick={() => goto('/expenses')}>Make your first expense report</BigButton>
  </div>
{:else}
  {#if currentYearRollup.count > 0}
    <div class="history-current-summary">
      <strong>{currentYear} so far</strong>
      <span><b>{currentYearRollup.count}</b> {currentYearRollup.count === 1 ? 'report' : 'reports'}</span>
      <span class="tnum"><b>{formatDollars(currentYearRollup.totalCents)}</b> total expenses</span>
    </div>
  {/if}

  <div class="history-search" aria-busy={searchState === 'loading'}>
    <input
      type="search"
      bind:value={query}
      aria-label="Search finalized and cancelled expense reports"
      placeholder="Search finalized expense reports — number, date, or description"
    />
    {#if searching}<button onclick={() => (query = '')}>Clear</button>{/if}
  </div>

  <HistoryRangeControls
    bind:start={rangeStart}
    bind:end={rangeEnd}
    exportLabel="Export expense summary"
    busyLabel={busyAction === 'range-export' ? 'Exporting…' : ''}
    onExport={exportRange}
  />

  {#if searching}
    {#if searchState === 'loading'}
      <p class="history-status" role="status">Searching…</p>
    {:else if searchState === 'ready'}
      {#if searchParts.finalized.length > 0}
        <ul class="history-list">
          {#each searchParts.finalized as report (report.id)}
            {@render reportRow(report)}
          {/each}
        </ul>
      {:else}
        <p class="history-status">No active expense reports match “{query}”.</p>
      {/if}
    {/if}
  {:else if grouped.length > 0}
    {#each grouped as group (group.year)}
      <section class="history-year">
        <div class="history-year-bar">
          <button
            class="history-year-toggle"
            onclick={() => toggleYear(group.year)}
            aria-expanded={isYearOpen(group.year)}
            aria-controls={`expense-year-${group.year}`}
          >
            <span class="history-year-label">
              <span aria-hidden="true">{isYearOpen(group.year) ? '▾' : '▸'}</span> {group.year}
            </span>
            <span class="history-chips">
              <span class="history-chip">{group.rollup.count} {group.rollup.count === 1 ? 'report' : 'reports'}</span>
              <span class="history-chip tnum">{formatDollars(group.rollup.totalCents)} total</span>
            </span>
          </button>
          <button
            class="history-export"
            disabled={!!busyAction}
            onclick={() => exportYear(group.year)}
          >{busyAction === `year-export-${group.year}` ? 'Exporting…' : `Export ${group.year} summary`}</button>
        </div>
        {#if isYearOpen(group.year)}
          <ul class="history-list" id={`expense-year-${group.year}`}>
            {#each group.reports as report (report.id)}
              {@render reportRow(report)}
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {:else}
    <p class="history-status">No active expense reports fall within this date range.</p>
  {/if}

  {#if visibleCancelled.length > 0}
    <section class="history-year history-cancelled" id="cancelled-expense-reports">
      <button
        class="history-year-toggle"
        bind:this={cancelledToggle}
        onclick={() => (cancelledOpen = !cancelledOpen)}
        aria-expanded={cancelledOpen}
        aria-controls="cancelled-expense-list"
      >
        <span class="history-year-label">
          <span aria-hidden="true">{cancelledOpen ? '▾' : '▸'}</span> Cancelled expense reports
        </span>
        <span class="history-chips">
          <span class="history-chip">{visibleCancelled.length} cancelled</span>
        </span>
      </button>
      {#if cancelledOpen}
        <ul class="history-list" id="cancelled-expense-list">
          {#each visibleCancelled as report (report.id)}
            {@render reportRow(report, true)}
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
{/if}
