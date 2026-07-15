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
    const sortCall = previewHandler.indexOf('sortInvoiceRows();');
    const snapshotCall = previewHandler.indexOf('previewSnap = buildFinalizedSnapshot');

    expect(sortHandler).toContain('sortInvoiceSections(completed, noshow)');
    expect(sortHandler).toContain('completed = sorted.completed');
    expect(sortHandler).toContain('noshow = sorted.noshow');
    expect(sortCall).toBeGreaterThan(-1);
    expect(snapshotCall).toBeGreaterThan(-1);
    expect(sortCall).toBeLessThan(snapshotCall);
    expect(page).toContain('onclick={sortInvoiceRows}');
  });
});
