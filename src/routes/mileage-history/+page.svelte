<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import BigButton from '$lib/components/BigButton.svelte';
  import { getDb } from '$lib/db';
  import {
    listFinalizedMileageReports,
    listVoidedMileageReports,
    reprintMileageSnapshot,
    restoreMileageReport,
  } from '$lib/db/mileage-repo';
  import { formatKm } from '$lib/mileage/odometer';
  import type { MileageListItem } from '$lib/mileage/types';
  import { saveMileagePdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';
  import { groupMileageHistory, sumMileageHistory } from '$lib/ui/mileageHistory';
  import '$lib/styles/history.css';

  type LoadState = 'loading' | 'ready' | 'error';

  let loadState = $state<LoadState>('loading');
  let loadError = $state('');
  let finalized = $state<MileageListItem[]>([]);
  let cancelled = $state<MileageListItem[]>([]);
  let openYears = $state<Record<number, boolean>>({});
  let cancelledOpen = $state(false);
  let cancelledToggle = $state<HTMLButtonElement>();
  let heading = $state<HTMLHeadingElement>();
  let busyAction = $state('');
  let actionError = $state('');
  let statusMessage = $state('');
  const currentYear = new Date().getFullYear();

  const grouped = $derived(groupMileageHistory(finalized));
  const currentYearRollup = $derived(sumMileageHistory(
    finalized.filter((report) => report.reportDate.startsWith(`${currentYear}-`)),
  ));
  const hasRecords = $derived(finalized.length > 0 || cancelled.length > 0);

  function isYearOpen(year: number): boolean {
    return openYears[year] ?? true;
  }

  function toggleYear(year: number): void {
    openYears = { ...openYears, [year]: !isYearOpen(year) };
  }

  async function loadAll(): Promise<void> {
    const db = await getDb();
    const [nextFinalized, nextCancelled] = await Promise.all([
      listFinalizedMileageReports(db),
      listVoidedMileageReports(db),
    ]);
    finalized = nextFinalized;
    cancelled = nextCancelled;
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

  async function runAction(key: string, action: () => Promise<void>): Promise<void> {
    if (busyAction) return;
    busyAction = key;
    actionError = '';
    statusMessage = '';
    try {
      await action();
    } catch (error) {
      actionError = (error as Error).message;
    } finally {
      busyAction = '';
    }
  }

  function downloadPdf(report: MileageListItem): Promise<void> {
    return runAction(`pdf-${report.id}`, async () => {
      const snapshot = await reprintMileageSnapshot(await getDb(), report.id);
      showSaveToast(await saveMileagePdf(snapshot));
    });
  }

  function restore(report: MileageListItem): Promise<void> {
    return runAction(`restore-${report.id}`, async () => {
      await restoreMileageReport(await getDb(), report.id);
      await loadAll();
      statusMessage = `Mileage report #${report.reportNumber} was restored.`;
      await tick();
      heading?.focus();
    });
  }

  async function showCancelled(): Promise<void> {
    cancelledOpen = true;
    await tick();
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('cancelled-mileage-reports')?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    cancelledToggle?.focus();
  }
</script>

<div class="history-head">
  <div>
    <h1 bind:this={heading} tabindex="-1">Mileage History</h1>
    <p>Finalized car mileage reports, kept separately from invoices and expenses.</p>
  </div>
  {#if cancelled.length > 0}
    <button
      class="history-cancelled-shortcut"
      onclick={showCancelled}
      aria-controls="cancelled-mileage-reports"
    >Cancelled mileage reports ({cancelled.length})</button>
  {/if}
</div>

{#if actionError}
  <p class="history-error" role="alert">{actionError}</p>
{/if}
<div role="status">
  {#if statusMessage}<p class="history-status">{statusMessage}</p>{/if}
</div>

{#snippet reportRow(report: MileageListItem, allowRestore = false)}
  <li class="history-row">
    <button
      class="history-number"
      onclick={() => goto(`/mileage-report/${report.id}`)}
      title="View mileage report #{report.reportNumber}"
    >#{report.reportNumber}</button>
    <span class="history-date mileage-meta">
      <span>{report.reportDate || 'Date unavailable'}</span>
      <span class="mileage-vehicle">{report.vehicle}</span>
    </span>
    <span class="history-amount tnum">{formatKm(report.totalKm)}</span>
    <span class="history-actions">
      {#if allowRestore}
        <button
          class="primary"
          disabled={!!busyAction}
          onclick={() => restore(report)}
        >{busyAction === `restore-${report.id}` ? 'Restoring…' : 'Restore'}</button>
      {/if}
      <button onclick={() => goto(`/mileage-report/${report.id}`)}>View</button>
      {#if !allowRestore}
        <button disabled={!!busyAction} onclick={() => downloadPdf(report)}>
          {busyAction === `pdf-${report.id}` ? 'Saving…' : 'Download PDF'}
        </button>
      {/if}
    </span>
  </li>
{/snippet}

{#if loadState === 'loading'}
  <p class="history-status" role="status">Loading mileage history…</p>
{:else if loadState === 'error'}
  <div class="history-empty">
    <p class="history-error" role="alert">Could not load mileage history: {loadError}</p>
    <button class="history-export" onclick={loadPage}>Retry</button>
  </div>
{:else if !hasRecords}
  <div class="history-empty">
    <p>No mileage reports yet.</p>
    <BigButton onclick={() => goto('/mileage-reports')}>Make your first mileage report</BigButton>
  </div>
{:else}
  {#if currentYearRollup.count > 0}
    <div class="history-current-summary">
      <strong>{currentYear} so far</strong>
      <span><b>{currentYearRollup.count}</b> {currentYearRollup.count === 1 ? 'report' : 'reports'}</span>
      <span class="tnum"><b>{formatKm(currentYearRollup.totalKm)}</b> driven</span>
    </div>
  {/if}

  {#if grouped.length > 0}
    {#each grouped as group (group.year)}
      <section class="history-year">
        <div class="history-year-bar">
          <button
            class="history-year-toggle"
            onclick={() => toggleYear(group.year)}
            aria-expanded={isYearOpen(group.year)}
            aria-controls={`mileage-year-${group.year}`}
          >
            <span class="history-year-label">
              <span aria-hidden="true">{isYearOpen(group.year) ? '▾' : '▸'}</span>
              {group.year === 0 ? 'Date unavailable' : group.year}
            </span>
            <span class="history-chips">
              <span class="history-chip">{group.rollup.count} {group.rollup.count === 1 ? 'report' : 'reports'}</span>
              <span class="history-chip tnum">{formatKm(group.rollup.totalKm)} total</span>
            </span>
          </button>
        </div>
        {#if isYearOpen(group.year)}
          <ul class="history-list" id={`mileage-year-${group.year}`}>
            {#each group.reports as report (report.id)}
              {@render reportRow(report)}
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {:else}
    <p class="history-status">No active mileage reports. Cancelled reports are listed below.</p>
  {/if}

  {#if cancelled.length > 0}
    <section
      class="history-year history-cancelled"
      id="cancelled-mileage-reports"
      aria-labelledby="cancelled-mileage-reports-toggle"
    >
      <button
        id="cancelled-mileage-reports-toggle"
        class="history-year-toggle"
        bind:this={cancelledToggle}
        onclick={() => (cancelledOpen = !cancelledOpen)}
        aria-expanded={cancelledOpen}
        aria-controls="cancelled-mileage-list"
      >
        <span class="history-year-label">
          <span aria-hidden="true">{cancelledOpen ? '▾' : '▸'}</span> Cancelled mileage reports
        </span>
        <span class="history-chips">
          <span class="history-chip">{cancelled.length} cancelled</span>
        </span>
      </button>
      {#if cancelledOpen}
        <ul class="history-list" id="cancelled-mileage-list">
          {#each cancelled as report (report.id)}
            {@render reportRow(report, true)}
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
{/if}

<style>
  h1:focus { outline: none; }
  h1:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .mileage-meta { display: flex; flex-direction: column; min-width: 0; }
  .mileage-vehicle { color: var(--text-primary); font-weight: 600; overflow-wrap: anywhere; }
</style>
