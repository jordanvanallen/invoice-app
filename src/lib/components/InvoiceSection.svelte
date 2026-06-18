<script lang="ts">
  import FuzzyCombobox from './FuzzyCombobox.svelte';
  import DatePicker from './DatePicker.svelte';
  import { formatDollars } from '$lib/money';
  import { centsToInput } from '$lib/ui/format';
  import { normalizeVin8, isValidVin8, isDateOutsidePeriod } from '$lib/validation';
  import type { CatalogEntry } from '$lib/db/catalog-repo';
  import { newRow, type EditorRow } from '$lib/ui/editorRow';
  import { tick } from 'svelte';

  let {
    title,
    tone,
    addLabel,
    rows = $bindable([]),
    clients,
    locations,
    addClient,
    addLocation,
    defaultFeeCents,
    dateDefault,
    periodStart,
    periodEnd,
    dupInspections,
    dupVins,
    billedVins = {},
    billedInspections = {},
  }: {
    title: string;
    tone: 'completed' | 'noshow';
    addLabel: string;
    rows?: EditorRow[];
    clients: CatalogEntry[];
    locations: CatalogEntry[];
    addClient: (name: string) => Promise<number>;
    addLocation: (name: string) => Promise<number>;
    defaultFeeCents: number;
    dateDefault: string;
    periodStart: string;
    periodEnd: string;
    dupInspections: Set<string>;
    dupVins: Set<string>;
    /** vin8 / inspection# -> invoice number it was already billed on (finalized invoices) */
    billedVins?: Record<string, string>;
    billedInspections?: Record<string, string>;
  } = $props();

  function rowWarnings(row: EditorRow): string[] {
    const w: string[] = [];
    if (row.inspectionNumber && dupInspections.has(row.inspectionNumber)) w.push(`Inspection #${row.inspectionNumber} is on more than one row`);
    if (row.vin8 && dupVins.has(row.vin8)) w.push(`VIN ${row.vin8} is on more than one row`);
    if (row.vin8 && !isValidVin8(row.vin8)) w.push(`VIN should be 8 characters — has ${row.vin8.length}`);
    if (row.inspectionNumber && billedInspections[row.inspectionNumber]) w.push(`Inspection #${row.inspectionNumber} was already billed on invoice #${billedInspections[row.inspectionNumber]}`);
    if (row.vin8 && billedVins[row.vin8]) w.push(`VIN ${row.vin8} was already billed on invoice #${billedVins[row.vin8]}`);
    if (row.date && isDateOutsidePeriod(row.date, periodStart, periodEnd)) w.push('Date is outside the billing period');
    return w;
  }

  let undo = $state<{ row: EditorRow; index: number } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  const subtotal = $derived(
    rows.reduce((acc, r) => acc + r.feeCents + r.mileageCents, 0),
  );

  function addRow(): number {
    const date = rows.at(-1)?.date || dateDefault;
    const r = newRow(tone, defaultFeeCents, date);
    rows = [...rows, r];
    return r.uid;
  }
  /** Enter on the last field: add a row and focus its first input (fast keyboard entry). */
  async function addAndFocusNext() {
    const uid = addRow();
    await tick();
    const el = document.getElementById(`row-${uid}`);
    (el?.querySelector('input') as HTMLInputElement | null)?.focus();
  }
  function removeRow(i: number) {
    undo = { row: rows[i], index: i };
    rows = rows.filter((_, j) => j !== i);
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undo = null), 8000);
  }
  function undoDelete() {
    if (!undo) return;
    const next = [...rows];
    next.splice(undo.index, 0, undo.row);
    rows = next;
    undo = null;
  }
  /** Dollar text -> cents (0 if blank/invalid). Doesn't touch the text the user typed. */
  function toCents(s: string): number {
    const n = Number(s.trim());
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  }
  function onFee(i: number) { rows[i].feeCents = toCents(rows[i].feeText); }
  function onMileage(i: number) { rows[i].mileageCents = toCents(rows[i].mileageText); }
  // Tidy the display to 2 decimals once the user leaves the field.
  function blurFee(i: number) { rows[i].feeText = centsToInput(rows[i].feeCents); }
  function blurMileage(i: number) { rows[i].mileageText = rows[i].mileageCents ? centsToInput(rows[i].mileageCents) : ''; }
</script>

<section class="card {tone}">
  <header>
    <h2>{title}</h2>
    <span class="meta tnum">{rows.length} {rows.length === 1 ? 'row' : 'rows'} · {formatDollars(subtotal)}</span>
  </header>

  <div class="cols">
    <span>Inspection #</span><span>Client</span><span>Location</span>
    <span>Date</span><span>Last 8 of VIN</span>
    <span class="right">Mileage ($)</span>
    <span class="right">Fee</span><span></span>
  </div>

  {#each rows as row, i (row.uid)}
    {@const warns = rowWarnings(row)}
    <div class="row" id="row-{row.uid}">
      <input class="tnum" placeholder="Inspection #" bind:value={row.inspectionNumber} />
      <FuzzyCombobox label="" noun="client" entries={clients} onAddNew={addClient}
        bind:selectedId={row.clientId} bind:text={row.clientName} />
      <FuzzyCombobox label="" noun="location" entries={locations} onAddNew={addLocation}
        bind:selectedId={row.locationId} bind:text={row.location} />
      <DatePicker block bind:value={row.date} ariaLabel="Inspection date" />
      <input class="tnum vin" placeholder="8 chars" value={row.vin8}
        oninput={(e) => (row.vin8 = normalizeVin8((e.currentTarget as HTMLInputElement).value))} />
      <input class="tnum right" type="text" inputmode="decimal" placeholder="0.00"
        bind:value={row.mileageText} oninput={() => onMileage(i)} onblur={() => blurMileage(i)} />
      <input class="tnum right fee" type="text" inputmode="decimal"
        bind:value={row.feeText} oninput={() => onFee(i)} onblur={() => blurFee(i)}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAndFocusNext(); } }} />
      <button class="del" title="Remove this row" onclick={() => removeRow(i)} aria-label="Remove row">✕</button>
      {#if warns.length}
        <div class="warns">
          {#each warns as w}<span>⚠ {w}</span>{/each}
        </div>
      {/if}
    </div>
  {/each}

  {#if undo}
    <div class="undo">Row removed. <button onclick={undoDelete}>Undo</button></div>
  {/if}

  <button class="add" onclick={addRow}>+ {addLabel}</button>
</section>

<style>
  .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4); }
  .completed header { background: var(--accent-tint); }
  .noshow header { background: var(--amber-50); }
  h2 { font-size: var(--fs-lg); font-weight: 600; margin: 0; }
  .meta { color: var(--text-secondary); font-weight: 600; }
  /* Both sections share the same 8-column layout (mileage applies to all rows). */
  .cols, .row {
    display: grid;
    grid-template-columns: 1fr 1.5fr 1.15fr 0.9fr 0.95fr 0.7fr 0.7fr 44px;
    gap: var(--sp-2); align-items: start; padding: var(--sp-2) var(--sp-4);
  }
  .cols { background: var(--bg-sunken); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px; color: var(--text-secondary); }
  /* Inset each label to match the input text below it (input border 1px + padding 12px). */
  .cols span { padding: 0 13px; }
  .row { border-top: 1px solid var(--border); }
  .row input { height: var(--input-h); padding: 0 12px; font-size: var(--fs-base); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); width: 100%; }
  .right { text-align: right; }
  input.right { text-align: right; }
  .del { height: var(--input-h); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; }
  .del:hover { color: var(--red-600); border-color: var(--red-600); }
  .add { width: 100%; min-height: 48px; border: none; border-top: 1px solid var(--border); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }
  .add:hover { background: var(--accent-tint); }
  .warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
  .warns span { color: var(--amber-600); font-size: var(--fs-sm); }
  .undo { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); background: var(--bg-sunken); color: var(--text-secondary); border-top: 1px solid var(--border); }
  .undo button { min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-weight: 600; cursor: pointer; }
</style>
