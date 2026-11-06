import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('completed-only identifier uniqueness wiring', () => {
  test('editor rows take every warning from the shared completed-only rules', () => {
    const section = readSource('src/lib/components/InvoiceSection.svelte');
    const rowWarnings = section.slice(
      section.indexOf('function rowWarnings('),
      section.indexOf('let undo ='),
    );

    expect(rowWarnings).toContain('return invoiceRowWarnings(row, {');
    expect(rowWarnings).toContain('billed: { vins: billedVins, inspections: billedInspections }');
    // No inline lookups that would warn on no-shows or match inherited object keys.
    expect(section).not.toContain('billedInspections[row.inspectionNumber]');
    expect(section).not.toContain('billedVins[row.vin8]');
    expect(section).not.toContain('dupVins.has(row.vin8)');
    expect(section).toContain('{@const warns = rowWarnings(row)}');
  });

  test('Lock & Save is blocked by duplicates and billed history, refreshed after a refusal', () => {
    const route = readSource('src/routes/+page.svelte');
    const finalize = route.slice(
      route.indexOf('async function doFinalize()'),
      route.indexOf('async function startNew()'),
    );

    expect(route).toContain('const dups = $derived(findDuplicates([...completed, ...noshow]));');
    expect(route).toContain('const finalizeBlockers = $derived(invoiceFinalizeBlockers(buildDraft(), billed));');
    expect(route).toContain('vin8: (uid) => `vin8-${uid}`');
    expect(route).toContain('inspectionNumber: (uid) => `inspection-number-${uid}`');
    expect(finalize).toContain('finalizeError = (e as Error).message;');
    expect(finalize).toContain('void refreshBilledHistory();');
    expect(finalize).toContain('billed = await loadBilledHistory(await getDb());');
  });

  test('a refused restore on the invoice page shows why and keeps the invoice on screen', () => {
    const page = readSource('src/routes/invoice/[id]/+page.svelte');
    const restore = page.slice(page.indexOf('async function restore()'), page.indexOf('async function deleteForever()'));

    expect(page).toContain("import { runThenLeave } from '$lib/ui/invoiceDetailActions';");
    expect(restore).toContain(
      "actionError = await runThenLeave(async () => unvoidInvoice(await getDb(), id), () => goto('/history'));",
    );
    expect(restore).toContain('restoring = false;');
    // The load error replaces the invoice view; a refused restore must not.
    expect(restore).not.toContain('errorMsg');
    expect(restore).not.toContain('snap =');
    expect(restore).not.toContain('status =');
    expect(page).toContain('<p class="err action-err" role="alert">{actionError}</p>');
    expect(page).toContain('onclick={restore} disabled={restoring}');
  });
});
