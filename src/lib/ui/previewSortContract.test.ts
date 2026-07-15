import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('invoice Preview sorting contract', () => {
  test('sorts visible editor rows before building the Preview snapshot', () => {
    const page = readFileSync('src/routes/+page.svelte', 'utf8');
    const sortStart = page.indexOf('function sortInvoiceRows()');
    const sortEnd = page.indexOf('\n  }', sortStart);
    const previewStart = page.indexOf('async function openPreview()');
    const previewEnd = page.indexOf('\n  }', previewStart);

    expect(sortStart).toBeGreaterThan(-1);
    expect(previewStart).toBeGreaterThan(-1);

    const sortHandler = page.slice(sortStart, sortEnd);
    const previewHandler = page.slice(previewStart, previewEnd);
    const prepareCall = previewHandler.indexOf('previewSnap = prepareInvoicePreview');

    expect(sortHandler).toContain('sortInvoiceSections(completed, noshow)');
    expect(sortHandler).toContain('completed = sorted.completed');
    expect(sortHandler).toContain('noshow = sorted.noshow');
    expect(prepareCall).toBeGreaterThan(-1);
    expect(previewHandler).toContain('sortRows: sortInvoiceRows');
    expect(previewHandler).toContain(
      'buildSnapshot: () => buildFinalizedSnapshot(buildDraft(), currentSettings, draftSeq)',
    );
    expect(page).toContain('onclick={sortInvoiceRows}');
  });
});
