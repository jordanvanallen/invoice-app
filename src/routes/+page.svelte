<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import InvoiceSection from '$lib/components/InvoiceSection.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import SaveStatusChip from '$lib/components/SaveStatusChip.svelte';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import InvoiceView from '$lib/components/InvoiceView.svelte';
  import { loadSettings } from '$lib/stores/settings';
  import { loadClients, loadLocations, addClient as addClientDb, addLocation as addLocationDb } from '$lib/stores/catalog';
  import { getDb } from '$lib/db';
  import { createDraft, loadDraft, saveDraft, latestDraftId, finalizeInvoice, peekNextSeq, loadBilledHistory, type BilledHistory } from '$lib/db/invoice-repo';
  import { formatInvoiceNumber } from '$lib/numbering';
  import { computeTotals } from '$lib/totals';
  import { buildFinalizedSnapshot } from '$lib/snapshot';
  import { defaultInvoicePeriod } from '$lib/ui/date';
  import { saveInvoicePdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';
  import { backupNow } from '$lib/stores/backup';
  import { missingFinalizeFields, findDuplicates } from '$lib/validation';
  import { formatDollars } from '$lib/money';
  import { bpToPercentInput } from '$lib/ui/format';
  import type { Settings, DraftInvoice, FinalizedSnapshot } from '$lib/types';
  import type { CatalogEntry } from '$lib/db/catalog-repo';
  import { toEditorRow, type EditorRow } from '$lib/ui/editorRow';

  let loaded = $state(false);
  let settings = $state<Settings | null>(null);
  let clients = $state<CatalogEntry[]>([]);
  let locations = $state<CatalogEntry[]>([]);
  // VINs / inspection #s already on finalized invoices — for the double-billing guard.
  let billed = $state<BilledHistory>({ vins: {}, inspections: {} });

  let invoiceId = $state<number | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let savedAt = $state('');

  let issueDate = $state('');
  let periodStart = $state('');
  let periodEnd = $state('');
  let todayIso = $state('');
  let completed = $state<EditorRow[]>([]);
  let noshow = $state<EditorRow[]>([]);

  let unlisten: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedJson = '';

  function buildDraft(): DraftInvoice {
    return {
      seq: null,
      year: Number(issueDate.slice(0, 4)) || new Date().getFullYear(),
      issueDate, periodStart, periodEnd,
      // Persisted columns only — exclude editor-only fields (uid, feeText, mileageText)
      // so reformatting the fee/mileage text on blur doesn't churn the autosave.
      lines: [...completed, ...noshow].map((l, i) => ({
        type: l.type, position: i, inspectionNumber: l.inspectionNumber,
        clientId: l.clientId, clientName: l.clientName, locationId: l.locationId,
        location: l.location, date: l.date, vin8: l.vin8,
        mileageCents: l.mileageCents, feeCents: l.feeCents,
      })),
    };
  }

  onMount(async () => {
    settings = await loadSettings();
    clients = await loadClients();
    locations = await loadLocations();

    const def = defaultInvoicePeriod();
    todayIso = def.issueDate;

    const db = await getDb();
    billed = await loadBilledHistory(db);
    let id = await latestDraftId(db);
    if (id === null) {
      id = await createDraft(db, def);
    }
    invoiceId = id;
    const draft = await loadDraft(db, id);
    issueDate = draft.issueDate || def.issueDate;
    periodStart = draft.periodStart || def.periodStart;
    periodEnd = draft.periodEnd || def.periodEnd;
    completed = draft.lines.filter((l) => l.type === 'completed').map(toEditorRow);
    noshow = draft.lines.filter((l) => l.type === 'noshow').map(toEditorRow);
    lastSavedJson = JSON.stringify(buildDraft());
    loaded = true;

    // Flush on window close (best-effort, silent — no "unsaved changes" prompt).
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      unlisten = await w.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          if (invoiceId !== null) await saveDraft(await getDb(), invoiceId, buildDraft());
        } catch { /* best effort */ }
        await w.destroy();
      });
    } catch { /* not in Tauri */ }
  });

  onDestroy(() => {
    unlisten?.();
    if (saveTimer) clearTimeout(saveTimer);
  });

  // Debounced autosave: persists 1.5s after a real change. Skips save-on-load and
  // no-op re-saves by comparing against the last persisted snapshot.
  $effect(() => {
    const draft = buildDraft();
    const json = JSON.stringify(draft);
    if (!loaded || invoiceId === null || finalized) return;
    if (json === lastSavedJson) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveState = 'saving';
    saveTimer = setTimeout(async () => {
      try {
        await saveDraft(await getDb(), invoiceId!, draft);
        lastSavedJson = json;
        saveState = 'saved';
        savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      } catch {
        saveState = 'error';
      }
    }, 1500);
  });

  const totals = $derived(
    settings ? computeTotals([...completed, ...noshow], settings.taxRateBp) : null,
  );

  let nextNumber = $state('');
  $effect(() => {
    const yr = Number(issueDate.slice(0, 4));
    if (!loaded || !yr || finalized) return;
    getDb().then((db) => peekNextSeq(db, yr)).then((n) => { nextNumber = formatInvoiceNumber(n, yr); });
  });

  const dups = $derived(findDuplicates([...completed, ...noshow]));
  const dupInspections = $derived(new Set(dups.inspectionNumbers));
  const dupVins = $derived(new Set(dups.vin8s));

  // --- Finalize ---
  let showConfirm = $state(false);
  let finalized = $state<FinalizedSnapshot | null>(null);
  let finalizeError = $state('');

  // --- Preview (read-only look at the invoice as it will print, before locking) ---
  let showPreview = $state(false);
  let previewSnap = $state<FinalizedSnapshot | null>(null);
  async function openPreview() {
    if (!settings) return;
    const yr = Number(issueDate.slice(0, 4)) || new Date().getFullYear();
    const seq = await peekNextSeq(await getDb(), yr);
    previewSnap = buildFinalizedSnapshot(buildDraft(), settings, seq);
    showPreview = true;
  }

  async function savePdfAgain() {
    if (finalized) showSaveToast(await saveInvoicePdf(finalized));
  }

  const allLines = $derived([...completed, ...noshow]);
  const blockerCount = $derived(allLines.filter((l) => missingFinalizeFields(l).length > 0).length);
  const canFinalize = $derived(allLines.length > 0 && blockerCount === 0);

  function jumpToBlocker() {
    const blocker = allLines.find((l) => missingFinalizeFields(l).length > 0);
    if (!blocker) return;
    const el = document.getElementById(`row-${blocker.uid}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  async function doFinalize() {
    finalizeError = '';
    try {
      const db = await getDb();
      if (invoiceId === null) return;
      if (saveTimer) clearTimeout(saveTimer);
      await saveDraft(db, invoiceId, buildDraft());
      finalized = await finalizeInvoice(db, invoiceId);
      showConfirm = false;
      showSaveToast(await saveInvoicePdf(finalized));
      void backupNow();
    } catch (e) {
      finalizeError = (e as Error).message;
    }
  }

  async function startNew() {
    const db = await getDb();
    const def = defaultInvoicePeriod();
    const id = await createDraft(db, def);
    invoiceId = id;
    billed = await loadBilledHistory(db);
    todayIso = def.issueDate;
    issueDate = def.issueDate;
    periodStart = def.periodStart;
    periodEnd = def.periodEnd;
    completed = [];
    noshow = [];
    finalized = null;
    saveState = 'idle';
    lastSavedJson = JSON.stringify(buildDraft());
  }

  async function addClientRefresh(name: string): Promise<number> {
    const id = await addClientDb(name);
    clients = await loadClients();
    return id;
  }
  async function addLocationRefresh(name: string): Promise<number> {
    const id = await addLocationDb(name);
    locations = await loadLocations();
    return id;
  }
</script>

{#if !loaded || !settings}
  <p style="color:var(--text-secondary)">Loading…</p>
{:else if finalized}
  <div class="done">
    <StatusPill status="finalized" invoiceNumber={finalized.invoiceNumber} />
    <h1>Invoice #{finalized.invoiceNumber} saved</h1>
    <p class="done-total">Total <span class="tnum">{formatDollars(finalized.totals.totalCents)}</span></p>
    <p class="done-sub">This invoice is locked — it'll always reprint exactly as issued.</p>
    {#if finalizeError}<p class="err">{finalizeError}</p>{/if}
    <div class="done-actions">
      <BigButton onclick={startNew}>Start a new invoice</BigButton>
      <BigButton variant="secondary" onclick={savePdfAgain}>Save PDF again</BigButton>
    </div>
  </div>
{:else}
  <div class="head">
    <h1>New Invoice</h1>
    <StatusPill status="draft" />
    {#if nextNumber}<span class="next-num">Will be #{nextNumber}</span>{/if}
    <span class="spacer"></span>
    <SaveStatusChip state={saveState} {savedAt} />
  </div>

  <div class="period">
    <label>Billing period
      <span class="dates">
        <DatePicker bind:value={periodStart} ariaLabel="Billing period from" />
        <span>to</span>
        <DatePicker bind:value={periodEnd} ariaLabel="Billing period to" />
      </span>
    </label>
    <label>Invoice date
      <DatePicker bind:value={issueDate} ariaLabel="Invoice date" />
    </label>
  </div>

  {#if completed.length === 0 && noshow.length === 0}
    <p class="empty-hint">Add your inspections below. Tip: after filling a row, press <b>Enter</b> on the Fee to start the next one.</p>
  {/if}

  <div class="sections">
    <InvoiceSection
      title="Completed Inspections · {formatDollars(settings.defaultCompletedFeeCents)} each"
      tone="completed" addLabel="Add inspection"
      bind:rows={completed} {clients} {locations}
      addClient={addClientRefresh} addLocation={addLocationRefresh}
      defaultFeeCents={settings.defaultCompletedFeeCents} dateDefault={todayIso}
      {periodStart} {periodEnd} {dupInspections} {dupVins}
      billedVins={billed.vins} billedInspections={billed.inspections} />

    <InvoiceSection
      title="No-Shows · {formatDollars(settings.defaultNoshowFeeCents)} each"
      tone="noshow" addLabel="Add no-show"
      bind:rows={noshow} {clients} {locations}
      addClient={addClientRefresh} addLocation={addLocationRefresh}
      defaultFeeCents={settings.defaultNoshowFeeCents} dateDefault={todayIso}
      {periodStart} {periodEnd} {dupInspections} {dupVins}
      billedVins={billed.vins} billedInspections={billed.inspections} />
  </div>

  {#if totals}
    <div class="dock">
      <div class="figs">
        <span class="fig"><span class="lbl">Completed</span> {completed.length} · <span class="lbl">No-shows</span> {noshow.length}</span>
        <span class="fig"><span class="lbl">Subtotal</span> <b class="tnum">{formatDollars(totals.subtotalCents)}</b></span>
        <span class="fig"><span class="lbl">HST {bpToPercentInput(settings.taxRateBp)}%</span> <b class="tnum">{formatDollars(totals.taxCents)}</b></span>
        <span class="dock-total"><span class="lbl">TOTAL</span> <b class="tnum">{formatDollars(totals.totalCents)}</b></span>
      </div>
      <div class="act">
        {#if allLines.length === 0}
          <span class="hint">Add at least one inspection to finish.</span>
        {:else if !canFinalize}
          <button type="button" class="hint hint-btn" onclick={jumpToBlocker}>Fix {blockerCount} {blockerCount === 1 ? 'row' : 'rows'} to finish →</button>
        {/if}
        <BigButton variant="secondary" onclick={openPreview} disabled={allLines.length === 0}>Preview</BigButton>
        <BigButton onclick={() => (showConfirm = true)} disabled={!canFinalize}>Lock &amp; Save</BigButton>
      </div>
    </div>
    {#if finalizeError}<p class="err">Couldn't save: {finalizeError}</p>{/if}
  {/if}

  {#if showPreview && previewSnap}
    <div class="preview-overlay" role="dialog" aria-label="Invoice preview" aria-modal="true">
      <div class="preview-bar">
        <span class="preview-note">Preview — not saved yet. This is how the PDF will look.</span>
        <button class="preview-close" onclick={() => (showPreview = false)}>Close preview</button>
      </div>
      <div class="preview-body">
        <InvoiceView snap={previewSnap} />
      </div>
    </div>
  {/if}

  {#if showConfirm && totals}
    <ConfirmDialog title="Lock &amp; Save this invoice?" confirmLabel="Finalize &amp; Save"
      onConfirm={doFinalize} onCancel={() => (showConfirm = false)}>
      <p>{completed.length} completed + {noshow.length} no-shows = {allLines.length} lines</p>
      <p>Subtotal {formatDollars(totals.subtotalCents)} · HST {formatDollars(totals.taxCents)}</p>
      <p style="font-weight:700;font-size:var(--fs-lg)">Total {formatDollars(totals.totalCents)}</p>
      <p style="color:var(--text-secondary)">Once locked, this invoice can't be edited — you can duplicate it to start a new one.</p>
    </ConfirmDialog>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-4); }
  .head .spacer { flex: 1; }
  .next-num { color: var(--text-muted); font-size: var(--fs-sm); }
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .period { display: flex; gap: var(--sp-8); margin-bottom: var(--sp-6); flex-wrap: wrap; }
  .period label { display: flex; flex-direction: column; gap: var(--sp-2); font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); }
  .period .dates { display: flex; align-items: center; gap: var(--sp-2); }
  .empty-hint { margin: 0 0 var(--sp-4); padding: var(--sp-3) var(--sp-4); background: var(--accent-tint);
    color: var(--text-secondary); border-radius: var(--r-md); font-size: var(--fs-sm); }
  .sections { display: flex; flex-direction: column; gap: var(--sp-6); padding-bottom: 96px; }
  .dock { position: sticky; bottom: 0; margin: 0 calc(-1 * var(--sp-8)) calc(-1 * var(--sp-8));
    display: flex; align-items: center; justify-content: space-between; gap: var(--sp-6); flex-wrap: wrap;
    padding: var(--sp-3) var(--sp-8); background: var(--bg-surface); border-top: 1px solid var(--border);
    box-shadow: 0 -4px 16px rgba(0,0,0,.08); }
  .figs { display: flex; align-items: center; gap: var(--sp-6); flex-wrap: wrap; }
  .fig { color: var(--text-secondary); font-size: var(--fs-sm); }
  .fig .lbl, .dock-total .lbl { color: var(--text-muted); }
  .fig b { color: var(--text-primary); }
  .dock-total { font-size: var(--fs-xl); font-weight: 800; color: var(--accent-strong); }
  .act { display: flex; align-items: center; gap: var(--sp-3); }
  .hint { margin: 0; font-size: var(--fs-sm); color: var(--text-muted); }
  .hint-btn { border: none; background: transparent; cursor: pointer; color: var(--amber-600); text-decoration: underline; }
  .hint-btn:hover { color: var(--text-primary); }
  .err { margin: 0; color: var(--red-600); }
  .done { max-width: 520px; margin: var(--sp-12) auto; display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4);
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: var(--sp-8); box-shadow: var(--shadow-card); }
  .done h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .done-total { margin: 0; font-size: var(--fs-lg); }
  .done-total .tnum { font-weight: 700; color: var(--accent-strong); }
  .done-sub { margin: 0; color: var(--text-secondary); }
  .done-actions { display: flex; gap: var(--sp-3); flex-wrap: wrap; }

  .preview-overlay { position: fixed; inset: 0; z-index: 80; background: var(--bg-canvas); display: flex; flex-direction: column; }
  .preview-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); background: var(--bg-surface); }
  .preview-note { color: var(--text-secondary); font-size: var(--fs-sm); }
  .preview-close { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong);
    background: var(--bg-surface); color: var(--text-primary); border-radius: var(--r-sm); font-weight: 600; cursor: pointer; white-space: nowrap; }
  .preview-close:hover { background: var(--accent-tint); }
  .preview-body { flex: 1; min-height: 0; overflow: auto; padding: var(--sp-6); display: flex; justify-content: center; align-items: flex-start; }
</style>
