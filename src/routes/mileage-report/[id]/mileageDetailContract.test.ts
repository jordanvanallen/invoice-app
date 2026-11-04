import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const detail = readFileSync('src/routes/mileage-report/[id]/+page.svelte', 'utf8').replace(/\r\n?/g, '\n');

describe('mileage report detail route', () => {
  test('shows the frozen snapshot with loading, invalid-link, and retry states', () => {
    expect(detail).toContain('reprintMileageSnapshot(db, reportId)');
    expect(detail).toContain('getMileageStatus(db, reportId)');
    expect(detail).toContain('<MileageView {snap} />');
    expect(detail).toContain('That mileage report link is not valid.');
    expect(detail).toContain("Couldn't open this mileage report: {loadError}");
    expect(detail).toContain('onclick={() => load(id)}>Try again</BigButton>');
    expect(detail).toContain('if (requestId !== loadRequest) return;');
  });

  test('cancels only through confirmation and restores cancelled reports', () => {
    expect(detail).toContain('<ConfirmDialog title="Cancel this mileage report?"');
    expect(detail).toContain('voidMileageReport(await getDb(), id)');
    expect(detail).toContain('restoreMileageReport(await getDb(), id)');
    expect(detail).toContain("{:else if status === 'finalized'}");
    expect(detail).toContain('This mileage report is cancelled and is not included in mileage totals.');
    expect(detail).toContain("if (busyAction !== 'cancel') showCancel = false;");
  });

  test('reprints the PDF without offering destructive deletion', () => {
    expect(detail).toContain('saveMileagePdf(current)');
    expect(detail).not.toContain('delete');
    expect(detail).not.toContain('Delete');
  });
});
