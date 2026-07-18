<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import BigButton from '$lib/components/BigButton.svelte';
  import { getDb } from '$lib/db';
  import {
    duplicateExpenseReport,
    expenseYearRollup,
    listExpensesForYear,
    listExpenseYears,
    listVoidedExpenses,
    reprintExpenseSnapshot,
    restoreExpenseReport,
    searchExpenses,
  } from '$lib/db/expense-repo';
  import type { ExpenseListItem, ExpenseRollup } from '$lib/expense/types';
  import { formatDollars } from '$lib/money';
  import { saveExpensePdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';
  import { defaultInvoicePeriod } from '$lib/ui/date';

  interface ExpenseGroup {
    year: number;
    rollup: ExpenseRollup;
    reports: ExpenseListItem[];
    open: boolean;
  }

  let loaded = $state(false);
  let groups = $state<ExpenseGroup[]>([]);
  let cancelled = $state<ExpenseListItem[]>([]);
  let cancelledOpen = $state(false);
  let query = $state('');
  let results = $state<ExpenseListItem[]>([]);
  let busyAction = $state('');
  let errorMessage = $state('');
  const searching = $derived(query.trim().length > 0);

  async function loadAll() {
    const db = await getDb();
    const years = await listExpenseYears(db);
    const nextGroups: ExpenseGroup[] = [];
    for (const year of years) {
      const [rollup, reports] = await Promise.all([
        expenseYearRollup(db, year),
        listExpensesForYear(db, year),
      ]);
      nextGroups.push({ year, rollup, reports, open: true });
    }
    groups = nextGroups;
    cancelled = await listVoidedExpenses(db);
  }

  onMount(async () => {
    try { await loadAll(); } catch (error) { errorMessage = (error as Error).message; }
    loaded = true;
  });

  $effect(() => {
    const value = query.trim();
    if (!value) { results = []; return; }
    let active = true;
    getDb()
      .then((db) => searchExpenses(db, value))
      .then((matches) => { if (active) results = matches; })
      .catch((error) => { if (active) errorMessage = (error as Error).message; });
    return () => { active = false; };
  });

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    busyAction = key;
    errorMessage = '';
    try { await action(); } catch (error) { errorMessage = (error as Error).message; }
    finally { busyAction = ''; }
  }

  function downloadPdf(report: ExpenseListItem) {
    return runAction(`pdf-${report.id}`, async () => {
      const snapshot = await reprintExpenseSnapshot(await getDb(), report.id);
      showSaveToast(await saveExpensePdf(snapshot));
    });
  }

  function duplicate(report: ExpenseListItem) {
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

  function restore(report: ExpenseListItem) {
    return runAction(`restore-${report.id}`, async () => {
      await restoreExpenseReport(await getDb(), report.id);
      await loadAll();
    });
  }

  async function showCancelled() {
    cancelledOpen = true;
    await tick();
    document.getElementById('cancelled-expenses')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="head">
  <div><h1>Expense History</h1><p>Finalized expense reports, kept separately from invoices.</p></div>
  {#if cancelled.length}
    <button class="cancelled-button" onclick={showCancelled}>
      Cancelled expense reports ({cancelled.length})
    </button>
  {/if}
</div>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

{#snippet reportRow(report: ExpenseListItem, allowRestore = false)}
  <li>
    <button class="number" onclick={() => goto(`/expense/${report.id}`)}
      title="View expense report #{report.reportNumber}">#{report.reportNumber}</button>
    <span class="date">{report.reportDate}</span>
    <span class="row-total tnum">{formatDollars(report.totalCents)}</span>
    <span class="row-actions">
      {#if allowRestore}
        <button class="primary" disabled={!!busyAction} onclick={() => restore(report)}>
          {busyAction === `restore-${report.id}` ? 'Restoring...' : 'Restore'}
        </button>
      {/if}
      <button disabled={!!busyAction} onclick={() => goto(`/expense/${report.id}`)}>View</button>
      {#if !allowRestore}
        <button disabled={!!busyAction} onclick={() => downloadPdf(report)}>
          {busyAction === `pdf-${report.id}` ? 'Saving...' : 'Download PDF'}
        </button>
        <button disabled={!!busyAction} onclick={() => duplicate(report)}>
          {busyAction === `duplicate-${report.id}` ? 'Opening...' : 'Duplicate'}
        </button>
      {/if}
    </span>
  </li>
{/snippet}

{#if !loaded}
  <p class="muted">Loading...</p>
{:else if groups.length === 0 && cancelled.length === 0}
  <div class="empty">
    <p>No expense reports yet.</p>
    <BigButton onclick={() => goto('/expenses')}>Make your first expense report</BigButton>
  </div>
{:else}
  {#if groups.length}
    <div class="search">
      <input type="search" bind:value={query} aria-label="Search expense reports"
        placeholder="Search by report number, date, or description" />
      {#if searching}<button onclick={() => (query = '')}>Clear</button>{/if}
    </div>
  {/if}

  {#if searching}
    {#if results.length}
      <ul>{#each results as report (report.id)}{@render reportRow(report)}{/each}</ul>
    {:else}
      <p class="muted">No expense reports match "{query}".</p>
    {/if}
  {:else}
    {#each groups as group (group.year)}
      <section class="year">
        <button class="year-head" onclick={() => (group.open = !group.open)} aria-expanded={group.open}>
          <span class="year-label">{group.open ? '▾' : '▸'} {group.year}</span>
          <span class="chips">
            <span>{group.rollup.count} {group.rollup.count === 1 ? 'report' : 'reports'}</span>
            <span class="tnum">{formatDollars(group.rollup.totalCents)} total</span>
          </span>
        </button>
        {#if group.open}
          <ul>{#each group.reports as report (report.id)}{@render reportRow(report)}{/each}</ul>
        {/if}
      </section>
    {/each}
  {/if}

  {#if cancelled.length}
    <section class="year cancelled" id="cancelled-expenses">
      <button class="year-head" onclick={() => (cancelledOpen = !cancelledOpen)} aria-expanded={cancelledOpen}>
        <span class="year-label">{cancelledOpen ? '▾' : '▸'} Cancelled expense reports</span>
        <span class="chips"><span>{cancelled.length} cancelled</span></span>
      </button>
      {#if cancelledOpen}
        <ul>{#each cancelled as report (report.id)}{@render reportRow(report, true)}{/each}</ul>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; margin-bottom: var(--sp-6); }
  h1 { margin: 0; font-size: var(--fs-xl); }
  .head p, .muted { margin: var(--sp-1) 0 0; color: var(--text-secondary); }
  .cancelled-button { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--red-600); color: var(--red-600); background: transparent; border-radius: var(--r-sm); font-weight: 600; cursor: pointer; }
  .cancelled-button:hover { color: #fff; background: var(--red-600); }
  .error { padding: var(--sp-3) var(--sp-4); color: var(--red-600); background: var(--bg-surface); border: 1px solid var(--red-600); border-radius: var(--r-sm); }
  .empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); color: var(--text-secondary); }
  .search { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-6); }
  .search input { flex: 1; min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); }
  .search button { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); cursor: pointer; }
  .year { margin-bottom: var(--sp-6); }
  .cancelled { margin-top: var(--sp-8); }
  .year-head { width: 100%; min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-surface); cursor: pointer; }
  .year-label { font-size: var(--fs-lg); font-weight: 700; }
  .cancelled .year-label { color: var(--text-muted); }
  .chips { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .chips span { padding: 2px var(--sp-3); border-radius: var(--r-full); background: var(--bg-sunken); color: var(--text-secondary); font-size: var(--fs-sm); }
  ul { container-type: inline-size; list-style: none; margin: var(--sp-2) 0 0; padding: 0; }
  li { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: var(--sp-4); min-height: 64px; padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border); }
  .number { border: 0; background: transparent; color: var(--accent-strong); font-weight: 700; cursor: pointer; }
  .number:hover { text-decoration: underline; }
  .date { color: var(--text-secondary); }
  .row-total { font-weight: 700; }
  .row-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .row-actions button { min-height: 44px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-weight: 600; cursor: pointer; }
  .row-actions button:hover:not(:disabled) { background: var(--accent-tint); }
  .row-actions button.primary { color: #fff; background: var(--accent-fill); border-color: var(--accent-fill); }
  .row-actions button:disabled { opacity: .55; cursor: default; }
  @container (max-width: 820px) {
    li { grid-template-columns: auto 1fr auto; }
    .row-actions { grid-column: 1 / -1; }
  }
</style>
