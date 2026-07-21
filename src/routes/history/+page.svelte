<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import BigButton from '$lib/components/BigButton.svelte';
  import HistoryRangeControls from '$lib/components/HistoryRangeControls.svelte';
  import { getDb } from '$lib/db';
  import {
    duplicateInvoice,
    listFinalizedInvoices,
    listVoided,
    rangeClientBreakdown,
    rangeRollup,
    reprintSnapshot,
    searchInvoices,
    unvoidInvoice,
    type InvoiceListItem,
  } from '$lib/db/invoice-repo';
  import {
    calendarYearRange,
    createHistorySearchLifecycle,
    filterHistoryRows,
    groupHistoryRows,
    historyRangeLabel,
    partitionHistoryRows,
    resolveHistoryRange,
    sumInvoiceHistory,
    type ClosedDateRange,
  } from '$lib/history/history';
  import { formatDollars } from '$lib/money';
  import { saveInvoicePdf, saveSummaryPdf } from '$lib/pdf/generate';
  import { loadSettings } from '$lib/stores/settings';
  import { showSaveToast } from '$lib/stores/toast';
  import { defaultInvoicePeriod, toIsoDate } from '$lib/ui/date';
  import '$lib/styles/history.css';

  type LoadState = 'loading' | 'ready' | 'error';
  type SearchState = 'idle' | 'loading' | 'ready' | 'error';

  let loadState = $state<LoadState>('loading');
  let loadError = $state('');
  let finalized = $state<InvoiceListItem[]>([]);
  let cancelled = $state<InvoiceListItem[]>([]);
  let query = $state('');
  let searchRows = $state<InvoiceListItem[]>([]);
  let searchState = $state<SearchState>('idle');
  let searchError = $state('');
  let searchInput = $state<HTMLInputElement>();
  let openYears = $state<Record<number, boolean>>({});
  let cancelledOpen = $state(false);
  let cancelledToggle = $state<HTMLButtonElement>();
  let rangeStart = $state('');
  let rangeEnd = $state('');
  let busyAction = $state('');
  let actionError = $state('');
  const currentYear = new Date().getFullYear();
  const searchLifecycle = createHistorySearchLifecycle<InvoiceListItem>((snapshot) => {
    searchRows = snapshot.rows;
    searchState = snapshot.status;
    searchError = snapshot.error;
  });

  const searching = $derived(query.trim().length > 0);
  const resolution = $derived(resolveHistoryRange(rangeStart, rangeEnd));
  const rangedFinalized = $derived(filterHistoryRows(
    finalized,
    (invoice) => invoice.issueDate,
    resolution.range,
  ));
  const rangedCancelled = $derived(filterHistoryRows(
    cancelled,
    (invoice) => invoice.issueDate,
    resolution.range,
  ));
  const grouped = $derived(groupHistoryRows(rangedFinalized, (invoice) => invoice.issueDate).map((group) => ({
    year: group.year,
    invoices: group.rows,
    rollup: sumInvoiceHistory(group.rows),
  })));
  const currentYearRollup = $derived(sumInvoiceHistory(
    rangedFinalized.filter((invoice) => invoice.issueDate.startsWith(`${currentYear}-`)),
  ));
  const rangedSearchRows = $derived(filterHistoryRows(
    searchRows,
    (invoice) => invoice.issueDate,
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
      listFinalizedInvoices(db),
      listVoided(db),
    ]);
    finalized = nextFinalized;
    cancelled = nextCancelled;
    const nextOpenYears: Record<number, boolean> = {};
    for (const group of groupHistoryRows(nextFinalized, (invoice) => invoice.issueDate)) {
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
    await searchLifecycle.run(async () => searchInvoices(await getDb(), value));
  }

  $effect(() => {
    const value = query.trim();
    if (!value) {
      searchLifecycle.clear();
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
    actionError = '';
    try {
      await action();
    } catch (error) {
      actionError = (error as Error).message;
    } finally {
      busyAction = '';
    }
  }

  function downloadPdf(invoice: InvoiceListItem): Promise<void> {
    return runAction(`pdf-${invoice.id}`, async () => {
      const snapshot = await reprintSnapshot(await getDb(), invoice.id);
      showSaveToast(await saveInvoicePdf(snapshot));
    });
  }

  function duplicate(invoice: InvoiceListItem): Promise<void> {
    return runAction(`duplicate-${invoice.id}`, async () => {
      await duplicateInvoice(await getDb(), invoice.id, defaultInvoicePeriod());
      await goto('/');
    });
  }

  function restore(invoice: InvoiceListItem): Promise<void> {
    return runAction(`restore-${invoice.id}`, async () => {
      await unvoidInvoice(await getDb(), invoice.id);
      await loadAll();
      const value = query.trim();
      if (value) await executeSearch(value);
      await tick();
      searchInput?.focus();
    });
  }

  async function clearSearch(): Promise<void> {
    query = '';
    await tick();
    searchInput?.focus();
  }

  async function showCancelled(): Promise<void> {
    cancelledOpen = true;
    await tick();
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('cancelled-invoices')?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    cancelledToggle?.focus();
  }

  async function saveTaxSummary(
    range: ClosedDateRange | null,
    rangeLabel: string,
    fileName: string,
  ): Promise<void> {
    const db = await getDb();
    const [rollup, breakdown, settings] = await Promise.all([
      rangeRollup(db, range),
      rangeClientBreakdown(db, range),
      loadSettings(),
    ]);
    if (rollup.count === 0) throw new Error('No finalized invoices exist in that date range.');
    showSaveToast(await saveSummaryPdf({
      rangeLabel,
      preparedOn: toIsoDate(new Date()),
      businessName: settings.inspectorName || 'My business',
      rollup,
      breakdown,
    }, fileName));
  }

  function exportRange(): Promise<void> {
    return runAction('range-export', async () => {
      const resolution = resolveHistoryRange(rangeStart, rangeEnd);
      if (resolution.kind === 'invalid') return;
      const range = resolution.range ? Object.freeze({ ...resolution.range }) : null;
      const rangeLabel = historyRangeLabel(range);
      const fileName = range
        ? `Tax-Summary-${range.start}_to_${range.end}.pdf`
        : 'Tax-Summary-All-Time.pdf';
      await saveTaxSummary(range, rangeLabel, fileName);
    });
  }

  function exportYear(year: number): Promise<void> {
    return runAction(`year-export-${year}`, async () => {
      const range = calendarYearRange(year);
      await saveTaxSummary(
        range,
        historyRangeLabel(range, year),
        `Tax-Summary-${year}.pdf`,
      );
    });
  }
</script>

<div class="history-head">
  <div>
    <h1>Invoice History</h1>
    <p>Finalized invoices, kept separately from expense reports.</p>
  </div>
  {#if visibleCancelled.length > 0}
    <button
      class="history-cancelled-shortcut"
      onclick={showCancelled}
      aria-controls="cancelled-invoices"
    >Cancelled invoices ({visibleCancelled.length})</button>
  {/if}
</div>

{#if actionError}
  <p class="history-error" role="alert">{actionError}</p>
{/if}
{#if searchError}
  <p class="history-error" role="alert">Search failed: {searchError}</p>
{/if}

{#snippet invoiceRow(invoice: InvoiceListItem, allowRestore = false)}
  <li class="history-row">
    <button
      class="history-number"
      onclick={() => goto(`/invoice/${invoice.id}`)}
      title="View invoice #{invoice.invoiceNumber}"
    >#{invoice.invoiceNumber}</button>
    <span class="history-date">{invoice.issueDate || 'Date unavailable'}</span>
    <span class="history-amount tnum">{formatDollars(invoice.totalCents)}</span>
    <span class="history-actions">
      {#if allowRestore}
        <button
          class="primary"
          disabled={!!busyAction}
          onclick={() => restore(invoice)}
        >{busyAction === `restore-${invoice.id}` ? 'Restoring…' : 'Restore'}</button>
      {/if}
      <button onclick={() => goto(`/invoice/${invoice.id}`)}>View</button>
      {#if !allowRestore}
        <button disabled={!!busyAction} onclick={() => downloadPdf(invoice)}>
          {busyAction === `pdf-${invoice.id}` ? 'Saving…' : 'Download PDF'}
        </button>
        <button disabled={!!busyAction} onclick={() => duplicate(invoice)}>
          {busyAction === `duplicate-${invoice.id}` ? 'Opening…' : 'Duplicate'}
        </button>
      {/if}
    </span>
  </li>
{/snippet}

{#if loadState === 'loading'}
  <p class="history-status" role="status">Loading invoice history…</p>
{:else if loadState === 'error'}
  <div class="history-empty">
    <p class="history-error" role="alert">Could not load invoice history: {loadError}</p>
    <button class="history-export" onclick={loadPage}>Retry</button>
  </div>
{:else if !hasSourceRecords}
  <div class="history-empty">
    <p>No invoices yet.</p>
    <BigButton onclick={() => goto('/')}>Make your first invoice</BigButton>
  </div>
{:else}
  {#if currentYearRollup.count > 0}
    <div class="history-current-summary">
      <strong>{currentYear} so far</strong>
      <span><b>{currentYearRollup.count}</b> {currentYearRollup.count === 1 ? 'invoice' : 'invoices'}</span>
      <span class="tnum"><b>{formatDollars(currentYearRollup.totalBilledCents)}</b> billed</span>
      <span class="tnum"><b>{formatDollars(currentYearRollup.totalTaxCents)}</b> HST</span>
      <span class="tnum"><b>{formatDollars(currentYearRollup.totalBilledCents - currentYearRollup.totalTaxCents)}</b> income before tax</span>
    </div>
  {/if}

  <div class="history-search" aria-busy={searchState === 'loading'}>
    <input
      type="search"
      bind:value={query}
      bind:this={searchInput}
      aria-label="Search finalized and cancelled invoices"
      placeholder="Search finalized invoices — client, VIN, inspection #, number, or date"
    />
    {#if searching}<button onclick={clearSearch}>Clear</button>{/if}
  </div>

  <HistoryRangeControls
    bind:start={rangeStart}
    bind:end={rangeEnd}
    exportLabel="Export tax summary"
    busyLabel={busyAction === 'range-export' ? 'Exporting…' : ''}
    actionLocked={!!busyAction}
    onExport={exportRange}
  />

  {#if searching}
    {#if searchState === 'loading'}
      <p class="history-status" role="status">Searching…</p>
    {:else if searchState === 'ready'}
      {#if searchParts.finalized.length > 0}
        <ul class="history-list">
          {#each searchParts.finalized as invoice (invoice.id)}
            {@render invoiceRow(invoice)}
          {/each}
        </ul>
      {:else}
        <p class="history-status">No active invoices match “{query}”.</p>
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
            aria-controls={`invoice-year-${group.year}`}
          >
            <span class="history-year-label">
              <span aria-hidden="true">{isYearOpen(group.year) ? '▾' : '▸'}</span>
              {group.year === 0 ? 'Date unavailable' : group.year}
            </span>
            <span class="history-chips">
              <span class="history-chip">{group.rollup.count} {group.rollup.count === 1 ? 'invoice' : 'invoices'}</span>
              <span class="history-chip tnum">{formatDollars(group.rollup.totalBilledCents)} billed</span>
              <span class="history-chip tnum">{formatDollars(group.rollup.totalTaxCents)} HST</span>
              <span class="history-chip tnum">{formatDollars(group.rollup.totalBilledCents - group.rollup.totalTaxCents)} income before tax</span>
            </span>
          </button>
          {#if group.year !== 0}
            <button
              class="history-export"
              disabled={!!busyAction}
              onclick={() => exportYear(group.year)}
            >{busyAction === `year-export-${group.year}` ? 'Exporting…' : `Export ${group.year} summary`}</button>
          {/if}
        </div>
        {#if isYearOpen(group.year)}
          <ul class="history-list" id={`invoice-year-${group.year}`}>
            {#each group.invoices as invoice (invoice.id)}
              {@render invoiceRow(invoice)}
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {:else}
    <p class="history-status">No active invoices fall within this date range.</p>
  {/if}

  {#if visibleCancelled.length > 0}
    <section
      class="history-year history-cancelled"
      id="cancelled-invoices"
      aria-labelledby="cancelled-invoices-toggle"
    >
      <button
        id="cancelled-invoices-toggle"
        class="history-year-toggle"
        bind:this={cancelledToggle}
        onclick={() => (cancelledOpen = !cancelledOpen)}
        aria-expanded={cancelledOpen}
        aria-controls="cancelled-invoice-list"
      >
        <span class="history-year-label">
          <span aria-hidden="true">{cancelledOpen ? '▾' : '▸'}</span> Cancelled invoices
        </span>
        <span class="history-chips">
          <span class="history-chip">{visibleCancelled.length} cancelled</span>
        </span>
      </button>
      {#if cancelledOpen}
        <ul class="history-list" id="cancelled-invoice-list">
          {#each visibleCancelled as invoice (invoice.id)}
            {@render invoiceRow(invoice, true)}
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
{/if}
