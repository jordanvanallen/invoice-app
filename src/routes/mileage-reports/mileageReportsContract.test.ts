import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const page = readSource('src/routes/mileage-reports/+page.svelte');

function handler(name: string, next: string): string {
  const start = page.indexOf(name);
  const end = page.indexOf(next, start + name.length);
  expect(start, name).toBeGreaterThan(-1);
  expect(end, next).toBeGreaterThan(start);
  return page.slice(start, end);
}

describe('mileage report editor route', () => {
  test('resumes or creates a draft with explicit loading and retryable error states', () => {
    const open = handler('async function openDraft()', '\n  async function registerCloseHandler()');

    expect(open).toContain('latestMileageDraftId(db)');
    expect(open).toContain('createMileageDraft(db, defaultHeader())');
    expect(open).toContain("loadState = 'error'");
    expect(page).toContain("{#if loadState === 'loading'}");
    expect(page).toContain('<BigButton onclick={openDraft}>Try again</BigButton>');
  });

  test('autosaves through the shared controller bound to one draft id', () => {
    const make = handler('function makeAutosave(id: number)', '\n  function clearUndo()');

    expect(make).toContain('createAutosaveController');
    expect(make).toContain('await saveMileageDraft(db, id, draft);');
    expect(make).not.toContain('reportId');
    expect(page).toContain('makeAutosave(id);');
    expect(page).toContain('if (json !== lastSavedJson) autosave?.notifyChanged();');
    expect(page).toContain('SaveStatusChip state={saveState}');
  });

  test('flushes on navigation and native close, and cleans up every listener on destroy', () => {
    const close = handler('async function registerCloseHandler()', '\n  onMount(');
    const destroy = handler('onDestroy(() => {', '\n  });');

    expect(page).toContain('guardDraftNavigation({');
    expect(page).toContain('isEditing: canEdit,');
    expect(page).not.toContain('onNavigate(');
    expect(page).not.toContain('flushPendingAutosave');
    expect(close).toContain('handleAutosavingWindowCloseRequest(event, {');
    expect(close).toContain('canFlush: canEdit()');
    expect(close).toContain('if (destroyed) stop();');
    expect(destroy).toContain('destroyed = true;');
    expect(destroy).toContain('unlisten?.();');
    expect(destroy).toContain('autosave?.dispose();');
    expect(destroy).toContain('clearTimeout(undoTimer)');
  });

  test('keys trip rows by persistent uid and keeps odometer text exactly as typed', () => {
    expect(page).toContain('{#each rows as row, index (row.uid)}');
    expect(page).toContain('bind:value={row.startText}');
    expect(page).toContain('bind:value={row.endText}');
    expect(page).toContain('normalizeOdometerText(row.startText)');
    expect(page).toContain('trips: mileageRowsToTrips(rows)');
    for (const coercion of ['parseInt(', 'parseFloat(', 'Math.round(', 'Math.trunc(', '|| 0']) {
      expect(page, coercion).not.toContain(coercion);
    }
  });

  test('derives blockers and totals from the visible draft and gates Lock & Save on them', () => {
    expect(page).toContain('const draftForDisplay = $derived(buildDraft());');
    expect(page).toContain('const blockers = $derived(mileageEditorBlockers(draftForDisplay, rows));');
    expect(page).toContain('const totalKm = $derived(mileageTotalKm(draftForDisplay.trips));');
    expect(page).toContain('const canFinalize = $derived(blockers.length === 0);');
    expect(page).toContain('disabled={!canFinalize}>Lock &amp; Save</BigButton>');
    expect(page).toContain('{@const rowWarnings = mileageRowWarnings(blockers, index)}');
    expect(page).toContain('{@const distance = mileageRowDistanceKm(row)}');
  });

  test('sorts the editor before building Preview from the same snapshot builder and number', () => {
    const preview = handler('async function openPreview()', '\n  function closePreview()');

    expect(preview.indexOf('sortTripRows();')).toBeGreaterThan(-1);
    expect(preview.indexOf('sortTripRows();')).toBeLessThan(preview.indexOf('prepareMileagePreview('));
    expect(preview).toContain('prepareMileagePreview(buildDraft(), settings, nextSeq)');
    expect(page).toContain('onclick={openPreview} disabled={!previewReady}');
    expect(page).toContain("if (event.key === 'Escape')");
  });

  test('saves the visible draft, finalizes once, backs up, then saves the PDF separately', () => {
    const finalize = handler('async function doFinalize()', '\n  async function startNew()');

    const order = [
      'await settleAutosaveBeforeManualSave(autosave, true);',
      'await saveMileageDraft(db, id, draft);',
      'locked = await finalizeMileageReport(db, id);',
      'void backupNow();',
      'await savePdf(locked);',
    ].map((step) => finalize.indexOf(step));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(finalize).toContain('if (finalizeSaving || reportId === null || !canFinalize) return;');
  });

  test('retries a failed PDF from the frozen snapshot without finalizing again', () => {
    const pdf = handler('async function savePdf(snapshot: MileageSnapshot)', '\n  async function doFinalize()');

    expect(pdf).toContain('saveMileagePdf(snapshot)');
    expect(pdf).toContain('catch (error)');
    expect(pdf).toContain('is locked and saved, but its PDF could not be created');
    expect(pdf).not.toContain('finalizeMileageReport');
    expect(page).toContain('onclick={() => finalized && savePdf(finalized)}');
  });

  test('locks the confirmation dialog while the report is being saved', () => {
    expect(page).toContain('if (!finalizeSaving) showConfirm = false;');
    expect(page).toContain('confirmDisabled={finalizeSaving} onConfirm={doFinalize} onCancel={cancelConfirm}');
  });

  test('records distance only, never money', () => {
    expect(page).not.toContain('$lib/money');
    expect(page).not.toContain('formatDollars');
    expect(page).not.toMatch(/\$\d|\bCents\b|\brate\b/i);
  });

  test('scales row layout with text size and stacks by available width', () => {
    expect(page).toContain('.trips { container-type: inline-size;');
    expect(page).toContain('calc(190px * var(--fs-scale))');
    expect(page).toContain('@container (max-width: 1240px)');
    expect(page).toContain('@container (max-width: 820px)');
    expect(page).toContain('.mobile-label { display: inline; }');
  });

  test('keeps the editor with a visible reason when leaving is held back by a failed save', () => {
    const make = handler('function makeAutosave(id: number)', '\n  function clearUndo()');
    const dock = handler('<div class="dock">', '<div class="total"');

    expect(page).toContain('onBlocked: (message) => { leaveMessage = message; },');
    expect(make).toContain("leaveMessage = '';");
    expect(dock).toContain('{#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}');
  });

  test('locks every draft control while an allowed navigation away loads', () => {
    const start = page.indexOf('{:else}\n  <div class="leave-lock" inert={leaving}>');
    const locked = page.slice(start, page.indexOf('\n<style>'));

    expect(page).toContain('let leaving = $state(false);');
    expect(page).toContain('onLeaving: (value) => { leaving = value; },');
    expect(start).toBeGreaterThan(-1);
    expect(locked.trimEnd()).toMatch(/<\/div>\n\{\/if\}$/);
    for (const control of [
      'id="mileage-vehicle"', '<DatePicker bind:value={reportDate}', 'bind:value={row.startText}',
      'onclick={undoDelete}', 'onclick={sortTripRows}', 'onclick={addTrip}', 'onclick={openPreview}',
      'class="preview-overlay"', '<ConfirmDialog',
    ]) expect(locked, control).toContain(control);
    expect(page).toContain('.leave-lock { display: contents; }');
  });

  test('moves keyboard focus deliberately when trips are added, removed, and restored', () => {
    const add = handler('function addTrip()', '\n  function removeTrip(');
    const remove = handler('function removeTrip(uid: string)', '\n  function undoDelete()');
    const restore = handler('function undoDelete()', '\n  function sortTripRows()');
    const focusTrip = handler('async function focusTripAfterRender(uid: string)', '\n  }');

    expect(add).toContain('void focusTripAfterRender(row.uid);');
    expect(remove).toContain("void focusAfterRender('mileage-undo');");
    expect(remove).toContain('undoTimer = setTimeout(expireUndo, 8000);');
    expect(restore).toContain('void focusTripAfterRender(restored.uid);');
    expect(focusTrip).toContain('await tick();');
    expect(focusTrip).toContain('rows.findIndex((row) => row.uid === uid)');
    expect(page).toContain('<button id="mileage-undo" type="button" onclick={undoDelete}>Undo</button>');
    expect(handler('function expireUndo()', '\n  }')).toContain("focusAfterRender('mileage-add-trip')");
  });
});
