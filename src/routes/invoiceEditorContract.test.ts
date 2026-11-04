import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const page = readFileSync('src/routes/+page.svelte', 'utf8').replace(/\r\n?/g, '\n');

const between = (start: string, end: string) => page.slice(page.indexOf(start), page.indexOf(end));

describe('invoice editor route', () => {
  test('holds navigation until the draft is saved; an invalid number no longer blocks saving', () => {
    expect(page).toContain('guardDraftNavigation({');
    expect(page).toContain('isEditing: () => loaded && invoiceId !== null && !finalized,');
    // Autosave persists everything but an invalid number, so there's nothing left to hold for.
    expect(page).not.toContain('unsavableReason');
    expect(page).not.toContain('canPersistInvoiceSequence');
    expect(page).toContain('onBlocked: (message) => { leaveMessage = message; },');
    expect(page).toContain('{#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}');
    expect(page).not.toContain('onNavigate(');
  });

  test('refuses to switch or discard drafts until the open draft is saved', () => {
    const saveFirst = between('async function saveOpenDraftFirst()', 'async function switchToDraft(');
    const switchDraft = between('async function switchToDraft(', 'async function discardSelectedDraft()');
    const discard = between('async function discardSelectedDraft()', 'async function addClientRefresh(');

    // The only flush outside the navigation guard, and its failure is reported, not swallowed.
    expect(page.match(/flushPendingAutosave\(/g)).toHaveLength(1);
    expect(saveFirst).toContain('await flushPendingAutosave(autosave, loaded && invoiceId !== null && !finalized);');
    expect(saveFirst).toMatch(/catch \{\n\s+draftRecoveryError = OPEN_DRAFT_NOT_SAVED;\n\s+return false;/);
    expect(switchDraft.indexOf('if (!(await saveOpenDraftFirst())) return;'))
      .toBeLessThan(switchDraft.indexOf('applyLoadedDraft('));
    expect(switchDraft.indexOf('if (!(await saveOpenDraftFirst())) return;')).toBeGreaterThan(-1);
    expect(discard.indexOf('if (!(await saveOpenDraftFirst())) return;'))
      .toBeLessThan(discard.indexOf('await deleteDraft(db, target.id);'));
    expect(discard.indexOf('if (!(await saveOpenDraftFirst())) return;')).toBeGreaterThan(-1);
    // A refused switch must not leave the picker showing a draft that isn't open, or drop focus.
    const picker = between('void switchToDraft(Number(select.value)).finally(() => {', '{#each savedDrafts');
    expect(picker).toContain("select.value = String(invoiceId ?? '');");
    expect(picker).toContain('if (select.isConnected && document.activeElement === document.body) select.focus();');
  });

  test('locks every draft control while an allowed navigation away or a draft switch loads', () => {
    const start = page.indexOf('<div class="leave-lock" inert={leaving || switchingDraft}>');
    const locked = page.slice(start, page.indexOf('\n<style>'));

    expect(page).toContain('let leaving = $state(false);');
    expect(page).toContain('onLeaving: (value) => { leaving = value; },');
    expect(start).toBeGreaterThan(-1);
    // Opens the editor branch, before any draft control.
    expect(page.slice(0, start).trimEnd()).toMatch(/\{:else\}\n\s*<!--[^\n]*-->$/);
    expect(locked.trimEnd()).toMatch(/<\/div>\n\{\/if\}$/);
    for (const control of [
      'aria-label="Saved invoice draft"', 'class="discard-draft"', 'draft-recovery-error',
      'bind:value={invoiceSeqText}', '<DatePicker bind:value={periodStart}', 'bind:rows={completed}',
      'bind:rows={noshow}', 'onclick={sortInvoiceRows}', 'onclick={openPreview}',
      'class="preview-overlay"', '<ConfirmDialog', 'title="Discard this saved draft?"',
    ]) expect(locked, control).toContain(control);
    expect(page).toContain('.leave-lock { display: contents; }');
  });

  test('clears the held-navigation reason once a save lands', () => {
    const make = page.slice(page.indexOf('function makeAutosave()'), page.indexOf('\n  onMount('));

    expect(make).toContain("leaveMessage = '';");
    expect(make).toContain('void refreshDrafts();');
  });
});
