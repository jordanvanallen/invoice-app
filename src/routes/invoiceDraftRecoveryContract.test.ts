import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = () => readFileSync('src/routes/+page.svelte', 'utf8').replace(/\r\n/g, '\n');

describe('invoice draft recovery route contract', () => {
  test('autosaves non-sequence edits even while invoice-number text is invalid', () => {
    const page = source();
    const autosaveEffect = page.slice(
      page.indexOf('// Debounced autosave'),
      page.indexOf('const totals = $derived'),
    );

    expect(page).toContain('read: buildDraftForPersistence');
    expect(page).toContain('draftSeqUpdateForPersistence(seqState)');
    expect(autosaveEffect).toContain('const draft = buildDraftForPersistence();');
    expect(autosaveEffect).not.toContain('canPersistInvoiceSequence');
    expect(autosaveEffect).not.toContain('cancelPending()');
  });

  test('surfaces every saved draft and requires confirmation before discarding one', () => {
    const page = source();

    expect(page).toContain('savedDrafts = await listDrafts(db);');
    expect(page).toContain('aria-label="Saved invoice drafts"');
    expect(page).toContain('Your work is still stored. Choose which draft to continue.');
    expect(page).toContain('void switchToDraft(');
    expect(page).toContain('title="Discard this saved draft?"');
    expect(page).toContain('await deleteDraft(db, target.id);');
    const discard = page.slice(
      page.indexOf('async function discardSelectedDraft()'),
      page.indexOf('async function addClientRefresh('),
    );
    expect(discard.indexOf('await deleteDraft(db, target.id);'))
      .toBeLessThan(discard.indexOf('autosave?.dispose();'));
  });

  test('cancels an abandoned async page initializer and its autosave controller', () => {
    const page = source();

    expect(page).toContain('onMount(() => {');
    expect(page).toContain('let cancelled = false;');
    expect(page).toContain('if (cancelled) return;');
    expect(page).toContain('cancelled = true;');
    expect(page).toContain('autosave?.dispose();');
    expect(page).toContain('autosave = null;');
    expect(page).not.toContain('onMount(async () => {');
  });
});
