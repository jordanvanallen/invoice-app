<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DatePicker from '$lib/components/DatePicker.svelte';
  import MileageView from '$lib/components/MileageView.svelte';
  import SaveStatusChip from '$lib/components/SaveStatusChip.svelte';
  import StatusPill from '$lib/components/StatusPill.svelte';
  import { getDb } from '$lib/db';
  import {
    createMileageDraft,
    finalizeMileageReport,
    latestMileageDraftId,
    loadMileageDraft,
    peekNextMileageSeq,
    saveMileageDraft,
    type MileageDraftHeader,
  } from '$lib/db/mileage-repo';
  import { formatKm, parseOdometerKm } from '$lib/mileage/odometer';
  import { deriveMileageYear } from '$lib/mileage/snapshot';
  import { mileageTotalKm } from '$lib/mileage/validation';
  import type { MileageDraft, MileageSnapshot } from '$lib/mileage/types';
  import { saveMileagePdf } from '$lib/pdf/generate';
  import { backupNow } from '$lib/stores/backup';
  import { loadSettings } from '$lib/stores/settings';
  import { showSaveToast } from '$lib/stores/toast';
  import type { Settings } from '$lib/types';
  import {
    createAutosaveController,
    settleAutosaveBeforeManualSave,
    type AutosaveController,
    type SaveState,
  } from '$lib/ui/autosave';
  import { defaultInvoicePeriod } from '$lib/ui/date';
  import { guardDraftNavigation } from '$lib/ui/guardDraftNavigation';
  import {
    MILEAGE_PREVIEW_HINT,
    blankMileageRow,
    canPreviewMileage,
    firstMileageBlockerTarget,
    mileageBlockingRowCount,
    mileageEditorBlockers,
    mileageRowDistanceKm,
    mileageRowWarnings,
    mileageRowsToTrips,
    normalizeOdometerText,
    prepareMileagePreview,
    sortMileageEditorRows,
    toMileageEditorRow,
    type MileageEditorRow,
  } from '$lib/ui/mileageEditor';
  import { handleAutosavingWindowCloseRequest } from '$lib/ui/windowClose';

  type LoadState = 'loading' | 'ready' | 'error';

  let loadState = $state<LoadState>('loading');
  let loadError = $state('');
  let settings = $state<Settings | null>(null);
  let reportId = $state<number | null>(null);
  let fallbackYear = $state(new Date().getFullYear());
  let reportDate = $state('');
  let periodStart = $state('');
  let periodEnd = $state('');
  let vehicle = $state('');
  let rows = $state<MileageEditorRow[]>([]);
  let undo = $state<{ row: MileageEditorRow; index: number } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let saveState = $state<SaveState>('idle');
  let savedAt = $state('');
  let lastSavedJson = '';
  let autosave: AutosaveController | null = null;
  let leaveMessage = $state('');
  let leaving = $state(false);
  let unlisten: (() => void) | null = null;
  let destroyed = false;

  let finalized = $state<MileageSnapshot | null>(null);

  function canEdit(): boolean {
    return loadState === 'ready' && reportId !== null && finalized === null;
  }

  function reportYear(): number {
    return deriveMileageYear(reportDate, fallbackYear);
  }

  function buildDraft(): MileageDraft {
    return {
      seq: null,
      year: reportYear(),
      reportDate,
      periodStart,
      periodEnd,
      vehicle,
      trips: mileageRowsToTrips(rows),
    };
  }

  function defaultHeader(): MileageDraftHeader {
    const defaults = defaultInvoicePeriod();
    return {
      year: defaults.year,
      reportDate: defaults.issueDate,
      periodStart: defaults.periodStart,
      periodEnd: defaults.periodEnd,
      vehicle: '',
    };
  }

  /** One controller per draft id, so a slow save can never land in a different report. */
  function makeAutosave(id: number) {
    autosave?.dispose();
    autosave = createAutosaveController({
      read: buildDraft,
      serialize: JSON.stringify,
      isSaved: (json) => json === lastSavedJson,
      markSaved: (json) => { lastSavedJson = json; },
      save: async (draft) => {
        const db = await getDb();
        await saveMileageDraft(db, id, draft);
      },
      setState: (state) => { saveState = state; },
      onSaved: () => {
        savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        leaveMessage = '';
      },
    });
  }

  function clearUndo() {
    undo = null;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
  }

  /** Resume the unfinished draft, or start one with today's defaults. */
  async function openDraft() {
    loadState = 'loading';
    loadError = '';
    try {
      const nextSettings = await loadSettings();
      const db = await getDb();
      let id = await latestMileageDraftId(db);
      if (id === null) id = await createMileageDraft(db, defaultHeader());
      const draft = await loadMileageDraft(db, id);
      if (destroyed) return;
      settings = nextSettings;
      reportId = id;
      fallbackYear = draft.year;
      reportDate = draft.reportDate;
      periodStart = draft.periodStart;
      periodEnd = draft.periodEnd;
      vehicle = draft.vehicle;
      rows = draft.trips.map(toMileageEditorRow);
      if (rows.length === 0) rows = [blankMileageRow(reportDate)];
      clearUndo();
      saveState = 'idle';
      savedAt = '';
      lastSavedJson = JSON.stringify(buildDraft());
      makeAutosave(id);
      loadState = 'ready';
    } catch (error) {
      loadError = (error as Error).message;
      loadState = 'error';
    }
  }

  async function registerCloseHandler() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      const stop = await appWindow.onCloseRequested(async (event) => {
        await handleAutosavingWindowCloseRequest(event, {
          autosave,
          canFlush: canEdit(),
          destroy: () => appWindow.destroy(),
          exit: async (code) => {
            const { exit } = await import('@tauri-apps/plugin-process');
            await exit(code);
          },
        });
      });
      if (destroyed) stop();
      else unlisten = stop;
    } catch { /* browser test/dev mode */ }
  }

  onMount(() => {
    void openDraft();
    void registerCloseHandler();
  });

  onDestroy(() => {
    destroyed = true;
    unlisten?.();
    unlisten = null;
    autosave?.dispose();
    if (undoTimer) clearTimeout(undoTimer);
  });

  guardDraftNavigation({
    autosave: () => autosave,
    isEditing: canEdit,
    onBlocked: (message) => { leaveMessage = message; },
    onLeaving: (value) => { leaving = value; },
  });

  $effect(() => {
    if (!canEdit()) return;
    const json = JSON.stringify(buildDraft());
    if (json !== lastSavedJson) autosave?.notifyChanged();
  });

  // The number is only assigned when the report is locked; this is the number
  // it will receive, shown in the header and in Preview.
  let nextSeq = $state<number | null>(null);
  let nextSeqYear = $state<number | null>(null);
  let seqRequest = 0;
  $effect(() => {
    const year = reportYear();
    if (!canEdit()) return;
    const requestId = ++seqRequest;
    getDb()
      .then((db) => peekNextMileageSeq(db, year))
      .then((seq) => {
        if (requestId !== seqRequest) return;
        nextSeq = seq;
        nextSeqYear = year;
      })
      .catch(() => {
        if (requestId !== seqRequest) return;
        nextSeq = null;
        nextSeqYear = null;
      });
  });

  const draftForDisplay = $derived(buildDraft());
  const blockers = $derived(mileageEditorBlockers(draftForDisplay, rows));
  const blockingRowCount = $derived(mileageBlockingRowCount(blockers));
  const totalKm = $derived(mileageTotalKm(draftForDisplay.trips));
  const canFinalize = $derived(blockers.length === 0);
  const upcomingNumber = $derived(
    nextSeq !== null && nextSeqYear === draftForDisplay.year ? `${nextSeq}-${nextSeqYear}` : '',
  );
  const previewReady = $derived(canPreviewMileage(blockers) && settings !== null && upcomingNumber !== '');
  const showTripHint = $derived(rows.every((row) =>
    !row.from.trim() && !row.to.trim() && !row.purpose.trim()
    && !row.startText.trim() && !row.endText.trim()));

  function focusField(id: string) {
    const element = document.getElementById(id);
    const target = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element
      : element?.querySelector<HTMLElement>('input, button');
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus();
  }

  async function focusAfterRender(id: string) {
    await tick();
    focusField(id);
  }

  /** Trip field ids follow row position, so find the row by its stable uid once it renders. */
  async function focusTripAfterRender(uid: string) {
    await tick();
    const index = rows.findIndex((row) => row.uid === uid);
    if (index !== -1) focusField(`mileage-trip-${index}-date`);
  }

  function addTrip() {
    const previous = rows.at(-1);
    const row = blankMileageRow(previous?.date || reportDate);
    rows = [...rows, row];
    void focusTripAfterRender(row.uid);
  }

  function removeTrip(uid: string) {
    const index = rows.findIndex((row) => row.uid === uid);
    if (index === -1) return;
    undo = { row: rows[index], index };
    rows = rows.filter((row) => row.uid !== uid);
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(expireUndo, 8000);
    void focusAfterRender('mileage-undo');
  }

  function expireUndo() {
    // Keep keyboard users on the page when the Undo button they're on disappears.
    const hadFocus = document.activeElement?.id === 'mileage-undo';
    undo = null;
    undoTimer = null;
    if (hadFocus) void focusAfterRender('mileage-add-trip');
  }

  function undoDelete() {
    if (!undo) return;
    const restored = undo.row;
    const next = [...rows];
    next.splice(Math.min(undo.index, next.length), 0, restored);
    rows = next;
    clearUndo();
    void focusTripAfterRender(restored.uid);
  }

  function sortTripRows() {
    rows = sortMileageEditorRows(rows);
  }

  function odometerInvalid(text: string): boolean {
    return parseOdometerKm(text).kind === 'invalid';
  }

  function jumpToFirstBlocker() {
    const target = firstMileageBlockerTarget(blockers);
    if (!target) return;
    const element = document.getElementById(target.id);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    element?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const focusTarget = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
      ? element
      : element?.querySelector<HTMLElement>('input, button') ?? element;
    focusTarget?.focus();
  }

  let showPreview = $state(false);
  let previewSnapshot = $state<MileageSnapshot | null>(null);
  let previewError = $state('');
  let previewDialog = $state<HTMLDivElement>();
  let previewClose = $state<HTMLButtonElement>();
  let previewTrigger: HTMLElement | null = null;

  async function openPreview() {
    if (!settings || !previewReady || nextSeq === null) return;
    previewError = '';
    sortTripRows();
    try {
      previewSnapshot = prepareMileagePreview(buildDraft(), settings, nextSeq);
    } catch (error) {
      previewError = (error as Error).message;
      return;
    }
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
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  let showConfirm = $state(false);
  let finalizeSaving = $state(false);
  let finalizeError = $state('');
  let pdfSaving = $state(false);
  let pdfError = $state('');
  let startingNew = $state(false);

  function cancelConfirm() {
    if (!finalizeSaving) showConfirm = false;
  }

  async function savePdf(snapshot: MileageSnapshot) {
    if (pdfSaving) return;
    pdfSaving = true;
    pdfError = '';
    try {
      showSaveToast(await saveMileagePdf(snapshot));
    } catch (error) {
      pdfError = `Report #${snapshot.reportNumber} is locked and saved, but its PDF could not be created: ${(error as Error).message}`;
    } finally {
      pdfSaving = false;
    }
  }

  async function doFinalize() {
    if (finalizeSaving || reportId === null || !canFinalize) return;
    const id = reportId;
    finalizeSaving = true;
    finalizeError = '';
    let locked: MileageSnapshot;
    try {
      await settleAutosaveBeforeManualSave(autosave, true);
      const db = await getDb();
      const draft = buildDraft();
      await saveMileageDraft(db, id, draft);
      lastSavedJson = JSON.stringify(draft);
      locked = await finalizeMileageReport(db, id);
    } catch (error) {
      finalizeError = (error as Error).message;
      return;
    } finally {
      finalizeSaving = false;
    }
    autosave?.dispose();
    autosave = null;
    clearUndo();
    finalized = locked;
    showConfirm = false;
    showPreview = false;
    void backupNow();
    await savePdf(locked);
  }

  async function startNew() {
    if (startingNew) return;
    startingNew = true;
    try {
      finalized = null;
      finalizeError = '';
      pdfError = '';
      previewSnapshot = null;
      nextSeq = null;
      nextSeqYear = null;
      await openDraft();
    } finally {
      startingNew = false;
    }
  }
</script>

{#if loadState === 'loading'}
  <p class="muted" role="status">Loading...</p>
{:else if loadState === 'error'}
  <section class="load-error">
    <p class="error" role="alert">Couldn't open your mileage report: {loadError}</p>
    <BigButton onclick={openDraft}>Try again</BigButton>
  </section>
{:else if finalized}
  <section class="done">
    <div class="finalized-pill">FINALIZED · Mileage report #{finalized.reportNumber}</div>
    <h1>Mileage report #{finalized.reportNumber} saved</h1>
    <p class="done-total">{finalized.vehicle} · Total <b class="tnum">{formatKm(finalized.totalKm)}</b></p>
    <p class="muted">This report is locked and will always reprint exactly as saved.</p>
    {#if pdfError}<p class="error" role="alert">{pdfError}</p>{/if}
    <div class="actions">
      <BigButton disabled={startingNew} onclick={startNew}>Start a new mileage report</BigButton>
      <BigButton variant="secondary" disabled={pdfSaving}
        onclick={() => finalized && savePdf(finalized)}>{pdfSaving ? 'Saving PDF...' : 'Save PDF again'}</BigButton>
      <BigButton variant="secondary" onclick={() => goto('/mileage-history')}>Mileage history</BigButton>
    </div>
  </section>
{:else}
  <div class="leave-lock" inert={leaving}>
  <div class="editor">
  <div class="head">
    <h1>New Mileage Report</h1>
    <StatusPill status="draft" />
    <span class="seq-msg">
      {upcomingNumber ? `Will be #${upcomingNumber} when locked` : 'Numbered when you lock & save'}
    </span>
    <span class="spacer"></span>
    <SaveStatusChip state={saveState} {savedAt} />
  </div>

  <div class="period">
    <label>Reporting period
      <span class="dates">
        <span id="mileage-period-start"><DatePicker bind:value={periodStart} ariaLabel="Reporting period start" /></span>
        <span>to</span>
        <span id="mileage-period-end"><DatePicker bind:value={periodEnd} ariaLabel="Reporting period end" /></span>
      </span>
    </label>
    <label>Report date
      <span id="mileage-report-date"><DatePicker bind:value={reportDate} ariaLabel="Mileage report date" /></span>
    </label>
    <label class="vehicle" for="mileage-vehicle">Vehicle
      <input id="mileage-vehicle" bind:value={vehicle} autocomplete="off"
        placeholder="Year, make, model, plate" />
    </label>
  </div>

  {#if showTripHint}
    <p class="empty-hint">Add each trip with its odometer readings. Distances and the total are calculated for you.</p>
  {/if}

  <div class="row-tools">
    <button type="button" class="secondary-button" disabled={rows.length < 2} onclick={sortTripRows}>Sort trips by date</button>
  </div>

  <section class="card trips" aria-label="Trips">
    <div class="row row-head" aria-hidden="true">
      <span>Date</span><span>From</span><span>To</span><span>Purpose</span>
      <span class="num">Start (km)</span><span class="num">End (km)</span><span class="num">Distance</span><span></span>
    </div>
    {#each rows as row, index (row.uid)}
      {@const rowWarnings = mileageRowWarnings(blockers, index)}
      {@const distance = mileageRowDistanceKm(row)}
      {@const describedBy = rowWarnings.length ? `mileage-trip-${index}-warnings` : undefined}
      <div class="row" id="mileage-trip-{index}">
        <label class="f-date"><span class="mobile-label">Date</span>
          <span id="mileage-trip-{index}-date"><DatePicker bind:value={row.date} ariaLabel={`Trip ${index + 1} date`} block /></span>
        </label>
        <label class="f-from"><span class="mobile-label">From</span>
          <input id="mileage-trip-{index}-from" bind:value={row.from} aria-describedby={describedBy}
            aria-label={`Trip ${index + 1} from`} placeholder="Starting point" />
        </label>
        <label class="f-to"><span class="mobile-label">To</span>
          <input id="mileage-trip-{index}-to" bind:value={row.to} aria-describedby={describedBy}
            aria-label={`Trip ${index + 1} to`} placeholder="Destination" />
        </label>
        <label class="f-purpose"><span class="mobile-label">Purpose</span>
          <input id="mileage-trip-{index}-purpose" bind:value={row.purpose} aria-describedby={describedBy}
            aria-label={`Trip ${index + 1} purpose`} placeholder="Inspections, pickup..." />
        </label>
        <label class="f-start"><span class="mobile-label">Start odometer (km)</span>
          <input id="mileage-trip-{index}-start" class="tnum num" inputmode="numeric" autocomplete="off"
            bind:value={row.startText} class:warn={odometerInvalid(row.startText)}
            aria-invalid={odometerInvalid(row.startText)} aria-describedby={describedBy}
            aria-label={`Trip ${index + 1} start odometer in kilometres`} placeholder="48,200"
            onblur={() => (row.startText = normalizeOdometerText(row.startText))} />
        </label>
        <label class="f-end"><span class="mobile-label">End odometer (km)</span>
          <input id="mileage-trip-{index}-end" class="tnum num" inputmode="numeric" autocomplete="off"
            bind:value={row.endText} class:warn={odometerInvalid(row.endText)}
            aria-invalid={odometerInvalid(row.endText)} aria-describedby={describedBy}
            aria-label={`Trip ${index + 1} end odometer in kilometres`} placeholder="48,250"
            onblur={() => (row.endText = normalizeOdometerText(row.endText))} />
        </label>
        <div class="f-distance"><span class="mobile-label" aria-hidden="true">Distance</span>
          <span class="distance tnum"><span class="sr-only">Trip {index + 1} distance: </span>{#if distance === null}<span aria-hidden="true">—</span><span class="sr-only">not calculated yet</span>{:else}{formatKm(distance)}{/if}</span>
        </div>
        <button type="button" class="del f-del" title="Remove this trip"
          onclick={() => removeTrip(row.uid)} aria-label={`Remove trip ${index + 1}`}>✕</button>
        {#if rowWarnings.length}
          <div class="warns" id="mileage-trip-{index}-warnings">
            {#each rowWarnings as warning}<span>⚠ {warning}</span>{/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if undo}
      <div class="undo">Trip removed. <button id="mileage-undo" type="button" onclick={undoDelete}>Undo</button></div>
    {/if}
    <button id="mileage-add-trip" type="button" class="add" onclick={addTrip}>+ Add a trip</button>
  </section>

  <div class="dock">
    {#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}
    <div class="total" id="mileage-total" tabindex="-1">
      <span>Total</span><b class="tnum">{totalKm === null ? '—' : formatKm(totalKm)}</b>
    </div>
    <div class="actions">
      {#if blockers.length > 0}
        {#if blockers[0].tripIndex !== null}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>Fix {blockingRowCount} {blockingRowCount === 1 ? 'trip' : 'trips'} to finish →</button>
        {:else}
          <button type="button" class="fix" onclick={jumpToFirstBlocker}>{blockers[0].message} Fix it →</button>
        {/if}
      {/if}
      <span title={previewReady ? undefined : MILEAGE_PREVIEW_HINT}>
        <BigButton variant="secondary" onclick={openPreview} disabled={!previewReady}>Preview</BigButton>
      </span>
      <BigButton onclick={() => (showConfirm = true)} disabled={!canFinalize}>Lock &amp; Save</BigButton>
    </div>
  </div>
  {#if previewError}<p class="error" role="alert">Couldn't preview: {previewError}</p>{/if}
  {#if finalizeError}<p class="error" role="alert">Couldn't save: {finalizeError}</p>{/if}
  </div>

  {#if showPreview && previewSnapshot}
    <div class="preview-overlay" role="dialog" aria-label="Mileage report preview" aria-modal="true"
      tabindex="-1" bind:this={previewDialog} onkeydown={onPreviewKeydown}>
      <div class="preview-bar">
        <span>Preview - not locked yet. The editor now matches this date order.</span>
        <button class="secondary-button" bind:this={previewClose} onclick={closePreview}>Close preview</button>
      </div>
      <div class="preview-body"><MileageView snap={previewSnapshot} /></div>
    </div>
  {/if}

  {#if showConfirm}
    <ConfirmDialog title="Lock &amp; Save this mileage report?"
      confirmLabel={finalizeSaving ? 'Saving...' : 'Finalize & Save'}
      confirmDisabled={finalizeSaving} onConfirm={doFinalize} onCancel={cancelConfirm}>
      <p>{vehicle.trim()} · {rows.length} {rows.length === 1 ? 'trip' : 'trips'}</p>
      <p class="confirm-total">Total {totalKm === null ? '—' : formatKm(totalKm)}</p>
      <p class="muted">The trips will be sorted by date and locked{upcomingNumber ? ` as #${upcomingNumber}` : ''}. It cannot be edited after this.</p>
      {#if finalizeError}<p class="error" role="alert">Couldn't save: {finalizeError}</p>{/if}
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
  input.num { text-align: right; }
  .seq-msg { color: var(--text-muted); font-size: var(--fs-sm); }
  .period { display: flex; gap: var(--sp-6) var(--sp-8); margin-bottom: var(--sp-6); flex-wrap: wrap; align-items: flex-start; }
  .period .dates { display: flex; align-items: center; gap: var(--sp-2); }
  .vehicle { flex: 1 1 calc(280px * var(--fs-scale)); max-width: calc(460px * var(--fs-scale)); }
  .empty-hint { margin: 0 0 var(--sp-4); padding: var(--sp-3) var(--sp-4); background: var(--accent-tint); color: var(--text-secondary); border-radius: var(--r-md); font-size: var(--fs-sm); }
  .row-tools { display: flex; justify-content: flex-end; gap: var(--sp-3); margin: 0 0 var(--sp-3); }
  .secondary-button { min-height: var(--target); padding: 0 var(--sp-4); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); font-weight: 600; cursor: pointer; }
  .secondary-button:hover:not(:disabled) { background: var(--accent-tint); }
  .secondary-button:disabled { opacity: .55; cursor: default; }
  .trips { container-type: inline-size; overflow: hidden; margin-bottom: 96px; }
  .row {
    display: grid;
    grid-template-columns: calc(190px * var(--fs-scale)) minmax(110px, 1fr) minmax(110px, 1fr) minmax(140px, 1.3fr) calc(118px * var(--fs-scale)) calc(118px * var(--fs-scale)) calc(104px * var(--fs-scale)) 44px;
    grid-template-areas: "date from to purpose start end distance del";
    gap: var(--sp-3); align-items: end; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border);
  }
  .row-head { color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 700; align-items: center; padding-top: var(--sp-2); padding-bottom: var(--sp-2); grid-template-areas: none; }
  .row-head .num { text-align: right; }
  .f-date { grid-area: date; }
  .f-from { grid-area: from; }
  .f-to { grid-area: to; }
  .f-purpose { grid-area: purpose; }
  .f-start { grid-area: start; }
  .f-end { grid-area: end; }
  .f-distance { grid-area: distance; display: flex; flex-direction: column; gap: var(--sp-2); color: var(--text-secondary); font-size: var(--fs-sm); font-weight: 600; }
  .f-del { grid-area: del; }
  .distance { display: flex; align-items: center; justify-content: flex-end; min-height: var(--input-h); color: var(--text-primary); font-size: var(--fs-base); font-weight: 700; white-space: nowrap; }
  .mobile-label { display: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .del { width: 44px; height: var(--input-h); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; }
  .del:hover { color: var(--red-600); border-color: var(--red-600); }
  .add { width: 100%; min-height: 48px; border: none; border-top: 1px solid var(--border); background: var(--bg-surface); color: var(--accent-strong); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }
  .add:hover { background: var(--accent-tint); }
  .undo { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); background: var(--bg-sunken); color: var(--text-secondary); border-top: 1px solid var(--border); }
  .undo button { min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--accent-strong); font-weight: 600; cursor: pointer; }
  .warns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--sp-3); padding-top: var(--sp-1); }
  .warns span { color: var(--amber-600); font-size: var(--fs-sm); }
  .dock { position: sticky; bottom: 0; margin: 0 calc(-1 * var(--sp-8)) calc(-1 * var(--sp-8)); display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); flex-wrap: wrap; padding: var(--sp-3) var(--sp-8); background: var(--bg-surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 16px rgba(0,0,0,.08); }
  .total { display: flex; align-items: baseline; gap: var(--sp-3); font-size: var(--fs-xl); color: var(--accent-strong); }
  .total:focus { outline: none; }
  .leave-blocked { flex: 1 0 100%; margin: 0; color: var(--red-600); font-weight: 600; }
  .actions { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .fix { max-width: 320px; border: 0; background: transparent; color: var(--amber-600); text-decoration: underline; cursor: pointer; text-align: right; }
  .error { color: var(--red-600); }
  .load-error { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); }
  .confirm-total { font-size: var(--fs-lg); font-weight: 700; }
  .done { max-width: 640px; margin: var(--sp-12) auto; display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-8); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-card); }
  .done-total { margin: 0; font-size: var(--fs-lg); }
  .preview-overlay { position: fixed; inset: 0; z-index: 80; background: var(--bg-canvas); display: flex; flex-direction: column; }
  .preview-overlay:focus { outline: none; }
  .preview-bar { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-4); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); }
  .preview-body { flex: 1; min-height: 0; overflow: auto; padding: var(--sp-6); display: flex; justify-content: center; align-items: flex-start; }
  /* Two lines per trip when all eight columns no longer fit. */
  @container (max-width: 1240px) {
    .row-head { display: none; }
    .row {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) calc(112px * var(--fs-scale));
      grid-template-areas:
        "date from to del"
        "purpose start end distance";
    }
    .mobile-label { display: inline; }
    .f-del { justify-self: end; }
  }
  @container (max-width: 820px) {
    .head { flex-wrap: wrap; }
    .row-head { display: none; }
    .row {
      grid-template-columns: 1fr;
      grid-template-areas: "date" "from" "to" "purpose" "start" "end" "distance" "del";
      align-items: stretch; padding: var(--sp-4);
    }
    .mobile-label { display: inline; }
    .distance { justify-content: flex-start; }
    .f-del { justify-self: start; }
    .dock { margin-left: calc(-1 * var(--sp-4)); margin-right: calc(-1 * var(--sp-4)); padding: var(--sp-3) var(--sp-4); }
    .actions { width: 100%; }
    .fix { max-width: none; text-align: left; }
  }
</style>
