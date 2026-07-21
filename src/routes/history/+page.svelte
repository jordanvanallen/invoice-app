<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { getDb } from '$lib/db';
  import { listYears, listInvoicesForYear, yearRollup, reprintSnapshot, duplicateInvoice, yearClientBreakdown, rangeRollup, rangeClientBreakdown, listVoided, unvoidInvoice, searchInvoices, type InvoiceListItem, type YearRollup } from '$lib/db/invoice-repo';
  import { saveInvoicePdf, saveSummaryPdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';
  import { loadSettings } from '$lib/stores/settings';
  import { formatDollars } from '$lib/money';
  import { toIsoDate as iso, defaultInvoicePeriod } from '$lib/ui/date';
  import BigButton from '$lib/components/BigButton.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';

  interface Group { year: number; rollup: YearRollup; invoices: InvoiceListItem[]; open: boolean; }
  let loaded = $state(false);
  let groups = $state<Group[]>([]);
  let voided = $state<InvoiceListItem[]>([]);
  let cancelledOpen = $state(false);
  let rangeStart = $state('');
  let rangeEnd = $state('');
  let query = $state('');
  let results = $state<InvoiceListItem[]>([]);
  const searching = $derived(query.trim() !== '');

  // Live search across finalized invoices (number, date, client, location, VIN, inspection #).
  // The cancel flag drops a slow earlier query that resolves after a newer keystroke.
  $effect(() => {
    const q = query.trim();
    if (!q) { results = []; return; }
    let active = true;
    getDb().then((db) => searchInvoices(db, q)).then((r) => { if (active) results = r; });
    return () => { active = false; };
  });

  // Income at a glance: the current calendar year's totals.
  const currentYear = new Date().getFullYear();
  const thisYearRollup = $derived(groups.find((g) => g.year === currentYear)?.rollup ?? null);

  // Date-range presets for the tax-summary exporter.
  function presetThisYear() { rangeStart = `${currentYear}-01-01`; rangeEnd = iso(new Date()); }
  function presetLastYear() { rangeStart = `${currentYear - 1}-01-01`; rangeEnd = `${currentYear - 1}-12-31`; }
  function presetThisQuarter() {
    const now = new Date();
    rangeStart = iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
    rangeEnd = iso(now);
  }

  async function loadAll() {
    const db = await getDb();
    const years = await listYears(db);
    const gs: Group[] = [];
    for (const y of years) {
      gs.push({ year: y, rollup: await yearRollup(db, y), invoices: await listInvoicesForYear(db, y), open: true });
    }
    groups = gs;
    voided = await listVoided(db);
  }

  onMount(async () => {
    const now = new Date();
    rangeEnd = iso(now);
    rangeStart = `${now.getFullYear()}-01-01`;
    await loadAll();
    loaded = true;
  });

  async function restore(id: number) {
    await unvoidInvoice(await getDb(), id);
    await loadAll();
  }

  // Reveal and scroll to the cancelled-invoices section so accidental
  // cancellations can be found and undone.
  async function showCancelled() {
    cancelledOpen = true;
    await tick();
    document.getElementById('cancelled')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function downloadPdf(id: number) {
    showSaveToast(await saveInvoicePdf(await reprintSnapshot(await getDb(), id)));
  }
  async function exportSummary(g: Group) {
    const db = await getDb();
    const breakdown = await yearClientBreakdown(db, g.year);
    const s = await loadSettings();
    showSaveToast(await saveSummaryPdf({
      title: `Tax Summary — ${g.year}`,
      note: 'From finalized invoices issued this calendar year.',
      preparedOn: iso(new Date()),
      businessName: s.inspectorName || 'My business', rollup: g.rollup, breakdown,
    }, `Tax-Summary-${g.year}.pdf`));
  }

  async function exportRange() {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return;
    const db = await getDb();
    const range = { start: rangeStart, end: rangeEnd };
    const [rollup, breakdown, s] = await Promise.all([
      rangeRollup(db, range),
      rangeClientBreakdown(db, range),
      loadSettings(),
    ]);
    showSaveToast(await saveSummaryPdf({
      title: `Tax Summary — ${rangeStart} to ${rangeEnd}`,
      note: 'From finalized invoices issued in this date range.',
      preparedOn: iso(new Date()),
      businessName: s.inspectorName || 'My business', rollup, breakdown,
    }, `Tax-Summary-${rangeStart}_to_${rangeEnd}.pdf`));
  }
  async function duplicate(id: number) {
    await duplicateInvoice(await getDb(), id, defaultInvoicePeriod());
    await goto('/');
  }
</script>

<div class="head">
  <h1>History</h1>
  {#if voided.length}
    <button class="cancelled-btn" onclick={showCancelled} title="View cancelled invoices so you can restore them">
      ⟲ Cancelled invoices ({voided.length})
    </button>
  {/if}
</div>

{#snippet invoiceRow(inv: InvoiceListItem)}
  <li>
    <button class="num" onclick={() => goto(`/invoice/${inv.id}`)} title="View invoice #{inv.invoiceNumber}">#{inv.invoiceNumber}</button>
    <span class="date">{inv.issueDate}</span>
    <span class="total tnum">{formatDollars(inv.totalCents)}</span>
    <span class="acts">
      <button class="primary" onclick={() => goto(`/invoice/${inv.id}`)}>View</button>
      <button onclick={() => downloadPdf(inv.id)}>Download PDF</button>
      <button onclick={() => duplicate(inv.id)}>Duplicate</button>
    </span>
  </li>
{/snippet}

{#if !loaded}
  <p style="color:var(--text-secondary)">Loading…</p>
{:else if groups.length === 0 && voided.length === 0}
  <div class="empty">
    <p>No invoices yet.</p>
    <BigButton onclick={() => goto('/')}>Make your first invoice</BigButton>
  </div>
{:else}
  {#if thisYearRollup && thisYearRollup.count}
    <div class="ytd">
      <span class="ytd-year">{currentYear} so far</span>
      <span class="ytd-fig"><b>{thisYearRollup.count}</b> {thisYearRollup.count === 1 ? 'invoice' : 'invoices'}</span>
      <span class="ytd-fig tnum"><b>{formatDollars(thisYearRollup.totalBilledCents)}</b> billed</span>
      <span class="ytd-fig tnum"><b>{formatDollars(thisYearRollup.totalTaxCents)}</b> HST</span>
      <span class="ytd-fig tnum"><b>{formatDollars(thisYearRollup.totalBilledCents - thisYearRollup.totalTaxCents)}</b> income before tax</span>
    </div>
  {/if}

  {#if groups.length}
    <div class="search">
      <input type="search" bind:value={query} aria-label="Search invoices"
        placeholder="Search — client, VIN, inspection #, invoice number, or date" />
      {#if searching}<button class="export" onclick={() => (query = '')}>Clear</button>{/if}
    </div>
  {/if}

  {#if searching}
    {#if results.length}
      <ul>
        {#each results as inv (inv.id)}{@render invoiceRow(inv)}{/each}
      </ul>
    {:else}
      <p class="muted">No invoices match “{query}”.</p>
    {/if}
  {:else}
    {#if groups.length}
    <div class="range">
      <span class="range-lbl">Tax summary for a date range:</span>
      <DatePicker bind:value={rangeStart} ariaLabel="From date" />
      <span class="to">to</span>
      <DatePicker bind:value={rangeEnd} ariaLabel="To date" />
      <span class="presets">
        <button onclick={presetThisYear}>This year</button>
        <button onclick={presetLastYear}>Last year</button>
        <button onclick={presetThisQuarter}>This quarter</button>
      </span>
      <button class="export-big" onclick={exportRange}>Export PDF</button>
    </div>

    {#each groups as g (g.year)}
      <section class="year">
      <div class="year-bar">
        <button class="year-head" onclick={() => (g.open = !g.open)}>
          <span class="yr">{g.open ? '▾' : '▸'} {g.year}</span>
          <span class="chips">
            <span class="chip">{g.rollup.count} {g.rollup.count === 1 ? 'invoice' : 'invoices'}</span>
            <span class="chip tnum">{formatDollars(g.rollup.totalBilledCents)} billed</span>
            <span class="chip tnum">{formatDollars(g.rollup.totalTaxCents)} HST</span>
          </span>
        </button>
        <button class="export" onclick={() => exportSummary(g)}>Export tax summary</button>
      </div>
        {#if g.open}
          <ul>
            {#each g.invoices as inv (inv.id)}{@render invoiceRow(inv)}{/each}
          </ul>
        {/if}
      </section>
    {/each}
    {/if}
  {/if}

  {#if voided.length}
    <section class="year cancelled" id="cancelled">
      <button class="year-head" onclick={() => (cancelledOpen = !cancelledOpen)}>
        <span class="yr">{cancelledOpen ? '▾' : '▸'} Cancelled</span>
        <span class="chips"><span class="chip">{voided.length} cancelled</span></span>
      </button>
      {#if cancelledOpen}
        <ul>
          {#each voided as inv (inv.id)}
            <li>
              <button class="num" onclick={() => goto(`/invoice/${inv.id}`)} title="View invoice #{inv.invoiceNumber}">#{inv.invoiceNumber}</button>
              <span class="date">{inv.issueDate}</span>
              <span class="total tnum">{formatDollars(inv.totalCents)}</span>
              <span class="acts">
                <button class="primary" onclick={() => restore(inv.id)}>Restore</button>
                <button onclick={() => goto(`/invoice/${inv.id}`)}>View</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; margin: 0 0 var(--sp-6); }
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .cancelled-btn { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--red-600); background: transparent;
    color: var(--red-600); border-radius: var(--r-sm); font-size: var(--fs-sm); font-weight: 600; cursor: pointer; white-space: nowrap; }
  .cancelled-btn:hover { background: var(--red-600); color: #fff; }
  .empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); color: var(--text-secondary); }
  .year { margin-bottom: var(--sp-6); }
  .cancelled { margin-top: var(--sp-8); }
  .cancelled .yr { color: var(--text-muted); }
  .year-bar { display: flex; align-items: stretch; gap: var(--sp-2); }
  .year-head { display: flex; align-items: center; justify-content: space-between; flex: 1; gap: var(--sp-4);
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); cursor: pointer; }
  .export { padding: 0 var(--sp-4); border: 1px solid var(--border-strong); background: var(--bg-surface);
    color: var(--accent-strong); border-radius: var(--r-md); font-size: var(--fs-sm); font-weight: 600; cursor: pointer; white-space: nowrap; }
  .export:hover { background: var(--accent-tint); }
  .ytd { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2) var(--sp-4);
    background: var(--accent-tint); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-6); }
  .ytd-year { font-weight: 700; color: var(--accent-strong); margin-right: var(--sp-2); }
  .ytd-fig { color: var(--text-secondary); }
  .ytd-fig b { color: var(--text-primary); }
  .export-big { margin-left: auto; min-height: var(--target); padding: 0 var(--sp-6);
    border: 1px solid var(--accent-fill); background: var(--accent-fill); color: var(--on-accent, #fff);
    border-radius: var(--r-sm); font-size: var(--fs-base); font-weight: 700; cursor: pointer; white-space: nowrap; }
  .export-big:hover { background: var(--accent-fill-hover); }
  .presets { display: inline-flex; gap: var(--sp-2); flex-wrap: wrap; }
  .presets button { min-height: var(--target); padding: 0 var(--sp-3); border: 1px solid var(--border);
    background: var(--bg-surface); color: var(--text-secondary); border-radius: var(--r-sm);
    font-size: var(--fs-sm); font-weight: 600; cursor: pointer; }
  .presets button:hover { background: var(--accent-tint); color: var(--accent-strong); }
  .search { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-6); }
  .search input { flex: 1; min-height: var(--target); padding: 0 var(--sp-4); font-size: var(--fs-base);
    border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-primary); }
  .muted { color: var(--text-secondary); }
  .range { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-6);
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); }
  .range-lbl { font-weight: 600; color: var(--text-secondary); margin-right: var(--sp-2); }
  .range .to { color: var(--text-muted); }
  .yr { font-size: var(--fs-lg); font-weight: 700; }
  .chips { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .chip { background: var(--bg-sunken); color: var(--text-secondary); border-radius: var(--r-full); padding: 2px var(--sp-3); font-size: var(--fs-sm); }
  ul { list-style: none; margin: var(--sp-2) 0 0; padding: 0; }
  li { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: var(--sp-4);
    min-height: 56px; padding: 0 var(--sp-4); border-bottom: 1px solid var(--border); }
  .num { font-weight: 600; }
  button.num { border: none; background: none; padding: 0; font: inherit; font-weight: 600; color: var(--accent-strong); text-align: left; cursor: pointer; }
  button.num:hover { text-decoration: underline; }
  button.num:focus-visible { outline: 2px solid var(--accent-fill); outline-offset: 2px; border-radius: var(--r-sm); }
  .date { color: var(--text-secondary); }
  .total { font-weight: 700; }
  .acts { display: flex; gap: var(--sp-2); }
  .acts button { min-height: 44px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); background: var(--bg-surface);
    border-radius: var(--r-sm); color: var(--accent-strong); font-size: var(--fs-sm); font-weight: 600; cursor: pointer; }
  .acts button:hover { background: var(--accent-tint); }
  .acts button.primary { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
  .acts button.primary:hover { background: var(--accent-fill-hover); }
</style>
