import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const page = readFileSync('src/routes/+page.svelte', 'utf8').replace(/\r\n?/g, '\n');

describe('invoice editor route', () => {
  test('holds navigation until the draft is saved, including while the number blocks autosave', () => {
    expect(page).toContain('guardDraftNavigation({');
    expect(page).toContain('isEditing: () => loaded && invoiceId !== null && !finalized,');
    expect(page).toContain('unsavableReason: () => canPersistInvoiceSequence(seqState)');
    expect(page).toContain('onBlocked: (message) => { leaveMessage = message; },');
    expect(page).toContain('{#if leaveMessage}<p class="leave-blocked" role="alert">{leaveMessage}</p>{/if}');
    expect(page).not.toContain('onNavigate(');
    expect(page).not.toContain('flushPendingAutosave');
  });

  test('locks every draft control while an allowed navigation away loads', () => {
    const start = page.indexOf('{:else}\n  <div class="leave-lock" inert={leaving}>');
    const locked = page.slice(start, page.indexOf('\n<style>'));

    expect(page).toContain('let leaving = $state(false);');
    expect(page).toContain('onLeaving: (value) => { leaving = value; },');
    expect(start).toBeGreaterThan(-1);
    expect(locked.trimEnd()).toMatch(/<\/div>\n\{\/if\}$/);
    for (const control of [
      'bind:value={invoiceSeqText}', '<DatePicker bind:value={periodStart}', 'bind:rows={completed}',
      'bind:rows={noshow}', 'onclick={sortInvoiceRows}', 'onclick={openPreview}',
      'class="preview-overlay"', '<ConfirmDialog',
    ]) expect(locked, control).toContain(control);
    expect(page).toContain('.leave-lock { display: contents; }');
  });

  test('clears the held-navigation reason once a save lands', () => {
    const make = page.slice(page.indexOf('function makeAutosave()'), page.indexOf('\n  onMount('));

    expect(make).toContain("leaveMessage = '';");
  });
});
