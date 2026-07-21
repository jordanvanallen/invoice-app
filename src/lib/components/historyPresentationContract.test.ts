import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('shared history presentation contract', () => {
  test('range controls are route-controlled, accessible, and All-time-first', () => {
    const controls = readSource('src/lib/components/HistoryRangeControls.svelte');

    expect(controls).toContain("start = $bindable('')");
    expect(controls).toContain("end = $bindable('')");
    expect(controls).toContain('aria-pressed={resolution.kind === \'all\'}');
    expect(controls).toContain('aria-pressed={selected(presets.thisYear)}');
    expect(controls).toContain("resolution.kind === 'invalid'");
    expect(controls).toContain("role=\"alert\"");
    expect(controls).toContain('invalid={resolution.kind === \'invalid\'}');
    expect(controls).toContain('errorId={errorId}');
    expect(controls).toContain("disabled={resolution.kind === 'invalid' || !!busyLabel}");
  });

  test('shared rows reserve an aligned amount track and wrap actions by content width', () => {
    const styles = readSource('src/lib/styles/history.css');

    expect(styles).toContain('grid-template-columns: auto minmax(8rem, 1fr) 11ch auto');
    expect(styles).toContain('.history-amount');
    expect(styles).toContain('width: 11ch');
    expect(styles).toContain('text-align: right');
    expect(styles).toContain('white-space: nowrap');
    expect(styles).toContain('@container (max-width: 820px)');
    expect(styles).toContain('.history-actions { grid-column: 1 / -1; }');
  });
});
