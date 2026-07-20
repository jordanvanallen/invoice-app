<script lang="ts">
  import FuzzyCombobox from './FuzzyCombobox.svelte';
  import DatePicker from './DatePicker.svelte';
  import { formatDollars } from '$lib/money';
  import { mileageApprovalText, hasCompleteMileageApproval } from '$lib/mileageApproval';
  import { canonicalInvoiceMoneyInput, invoiceMoneyInputTransition } from '$lib/ui/format';
  import { formatIsoDate, normalizeVin8, isValidVin8, isValidIsoDate, isDateOutsidePeriod } from '$lib/validation';
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
    approvers,
    addClient,
    addLocation,
    addApprover,
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
    approvers: CatalogEntry[];
    addClient: (name: string) => Promise<number>;
    addLocation: (name: string) => Promise<number>;
    addApprover: (name: string) => Promise<number>;
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
  function onFee(i: number, event: Event) {
    const row = rows[i];
    const next = invoiceMoneyInputTransition(
      row.feeCents,
      (event.currentTarget as HTMLInputElement).value,
    );
    row.feeText = next.text;
    row.feeCents = next.cents;
  }
  function onMileage(i: number, event: Event) {
    const row = rows[i];
    const next = invoiceMoneyInputTransition(
      row.mileageCents,
      (event.currentTarget as HTMLInputElement).value,
    );
    row.mileageText = next.text;
    row.mileageCents = next.cents;
    if (next.becamePositive) {
      row.approvalCollapsed = false;
    }
  }
  // Tidy the display to 2 decimals once the user leaves the field.
  function blurFee(i: number) { rows[i].feeText = canonicalInvoiceMoneyInput(rows[i].feeCents); }
  function blurMileage(i: number) { rows[i].mileageText = canonicalInvoiceMoneyInput(rows[i].mileageCents, true); }
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
    {@const approvalComplete = hasCompleteMileageApproval(row)}
    {@const approvalText = mileageApprovalText(row)}
    {@const approvalSummary = approvalText
      ? `Approved by ${row.mileageApproverName.trim()} · ${formatIsoDate(row.mileageApprovalDate)}`
      : ''}
    {@const approverInvalid = row.mileageCents > 0
      && (row.mileageApproverId === null || !row.mileageApproverName.trim())}
    {@const approvalDateInvalid = row.mileageCents > 0
      && !isValidIsoDate(row.mileageApprovalDate)}
    {@const approvalExpanded = !approvalComplete || !row.approvalCollapsed}
    <div class="row" id="row-{row.uid}">
      <input id={`inspection-number-${row.uid}`} class="tnum" placeholder="Inspection #" bind:value={row.inspectionNumber} />
      <FuzzyCombobox label="" noun="client" entries={clients} onAddNew={addClient}
        inputId={`client-${row.uid}`} bind:selectedId={row.clientId} bind:text={row.clientName} />
      <FuzzyCombobox label="" noun="location" entries={locations} onAddNew={addLocation}
        inputId={`location-${row.uid}`} bind:selectedId={row.locationId} bind:text={row.location} />
      <DatePicker block bind:value={row.date} ariaLabel="Inspection date" fieldId={`inspection-date-${row.uid}`} />
      <input id={`vin8-${row.uid}`} class="tnum vin" placeholder="8 chars" value={row.vin8}
        oninput={(e) => (row.vin8 = normalizeVin8((e.currentTarget as HTMLInputElement).value))} />
      <input class="tnum right" type="text" inputmode="decimal" placeholder="0.00"
        value={row.mileageText} oninput={(event) => onMileage(i, event)} onblur={() => blurMileage(i)} />
      <input class="tnum right fee" type="text" inputmode="decimal"
        value={row.feeText} oninput={(event) => onFee(i, event)} onblur={() => blurFee(i)}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAndFocusNext(); } }} />
      <button class="del" title="Remove this row" onclick={() => removeRow(i)} aria-label="Remove row">✕</button>
      {#if warns.length}
        <div class="warns">
          {#each warns as w}<span>⚠ {w}</span>{/each}
        </div>
      {/if}
      {#if row.mileageCents > 0}
        <div class="approval-strip" class:collapsed={!approvalExpanded}>
          {#if approvalComplete}
            <button
              type="button"
              class="approval-summary"
              aria-expanded={!row.approvalCollapsed}
              aria-controls="mileage-approval-{row.uid}"
              onclick={() => (row.approvalCollapsed = !row.approvalCollapsed)}
            >
              <span>{approvalSummary}</span>
              <span class="approval-action">{row.approvalCollapsed ? 'Edit approval' : 'Collapse approval'}</span>
            </button>
          {:else}
            <h3>Mileage approval required</h3>
          {/if}

          <div class="approval-panel" id="mileage-approval-{row.uid}">
            {#if approvalExpanded}
              <div class="approval-fields">
                <FuzzyCombobox
                  label="Approved by"
                  noun="approver"
                  entries={approvers}
                  onAddNew={addApprover}
                  inputId={`mileage-approver-${row.uid}`}
                  required
                  invalid={approverInvalid}
                  error={approverInvalid ? 'Select a saved approver or choose Add new approver.' : ''}
                  onEdited={() => (row.approvalCollapsed = false)}
                  bind:selectedId={row.mileageApproverId}
                  bind:text={row.mileageApproverName}
                />
                <div class="approval-date">
                  <span class="approval-label">Approval date</span>
                  <DatePicker
                    block
                    bind:value={row.mileageApprovalDate}
                    ariaLabel="Mileage approval date"
                    fieldId={`mileage-approval-date-${row.uid}`}
                    required
                    invalid={approvalDateInvalid}
                    errorId={approvalDateInvalid ? `mileage-approval-date-${row.uid}-error` : ''}
                    onChange={() => (row.approvalCollapsed = false)}
                  />
                  {#if approvalDateInvalid}
                    <p class="approval-error" id="mileage-approval-date-{row.uid}-error">Choose a valid approval date.</p>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
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
  .card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: visible; container-type: inline-size; }
  .card:focus-within { position: relative; z-index: 30; }
  header { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-3) var(--sp-4); border-radius: calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px) 0 0; }
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
  .card > .add { border-radius: 0 0 calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px); }
  .add:hover { background: var(--accent-tint); }
  .warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
  .warns span { color: var(--amber-600); font-size: var(--fs-sm); }
  .approval-strip { grid-column: 1 / -1; min-width: 0; margin-top: var(--sp-1); padding: var(--sp-3); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-sunken); }
  .approval-strip.collapsed { padding: 0; background: var(--bg-surface); }
  .approval-strip h3 { margin: 0 0 var(--sp-3); color: var(--amber-600); font-size: var(--fs-base); font-weight: 700; }
  .approval-summary { width: 100%; min-height: var(--target); display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: none; border-radius: var(--r-md); background: transparent; color: var(--accent-strong); font-weight: 700; text-align: left; cursor: pointer; }
  .approval-summary:hover { background: var(--accent-tint); }
  .approval-action { flex: none; color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 600; }
  .approval-fields { display: grid; grid-template-columns: minmax(15rem, 1fr) minmax(12rem, .7fr); gap: var(--sp-4); align-items: start; }
  .approval-summary + .approval-panel > .approval-fields { margin-top: var(--sp-3); }
  .approval-date { min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .approval-label { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 600; }
  .approval-error { margin: 0; color: var(--amber-600); font-size: var(--fs-sm); }
  .undo { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); background: var(--bg-sunken); color: var(--text-secondary); border-top: 1px solid var(--border); }
  .undo button { min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-weight: 600; cursor: pointer; }

  @container (max-width: 48rem) {
    .approval-fields { grid-template-columns: minmax(0, 1fr); }
  }
</style>
