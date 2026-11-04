import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const history = readSource('src/routes/mileage-history/+page.svelte');

describe('mileage history route', () => {
  test('loads finalized and cancelled reports with loading, error, retry, and empty states', () => {
    expect(history).toContain('Mileage History');
    expect(history).toContain('listFinalizedMileageReports(db)');
    expect(history).toContain('listVoidedMileageReports(db)');
    expect(history).toContain("type LoadState = 'loading' | 'ready' | 'error'");
    expect(history).toContain('Loading mileage history…');
    expect(history).toContain('Could not load mileage history: {loadError}');
    expect(history).toContain('onclick={loadPage}>Retry</button>');
    expect(history).toContain("goto('/mileage-reports')");
    expect(history).toContain("import '$lib/styles/history.css'");
  });

  test('groups by year with kilometre rollups and keyboard-operable disclosures', () => {
    expect(history).toContain('groupMileageHistory(finalized)');
    expect(history).toContain('aria-expanded={isYearOpen(group.year)}');
    expect(history).toContain('aria-controls={`mileage-year-${group.year}`}');
    expect(history).toContain('{formatKm(group.rollup.totalKm)} total');
    expect(history).toContain('class="history-amount tnum">{formatKm(report.totalKm)}');
    expect(history).toContain('{report.vehicle}');
  });

  test('reprints PDFs from the frozen copy and restores cancelled reports with feedback', () => {
    expect(history).toContain('reprintMileageSnapshot(await getDb(), report.id)');
    expect(history).toContain('saveMileagePdf(snapshot)');
    expect(history).toContain('restoreMileageReport(await getDb(), report.id)');
    expect(history).toContain('<div role="status">');
    expect(history).toContain('cancelledToggle?.focus()');
    expect(history).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(history).toContain('disabled={!!busyAction}');
  });

  test('stays a focused mileage log without expense-only tools', () => {
    for (const absent of ['duplicate', 'Duplicate', 'HistoryRangeControls', 'search', 'formatDollars']) {
      expect(history, absent).not.toContain(absent);
    }
  });
});
