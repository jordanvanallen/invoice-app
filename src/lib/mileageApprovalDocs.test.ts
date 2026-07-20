import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('mileage approval documentation contracts', () => {
  test('documents optional no-show mileage with the same approval requirement', () => {
    const guide = readSource('USER_GUIDE.md');

    expect(guide).not.toContain('without mileage');
    expect(guide).toContain(
      'The **No‑Shows** section works the same way (default $25 each), including optional mileage. Any mileage charge requires the same **Approved by** and **Approval date** details described below.',
    );
  });

  test('describes mileage as available on completed and no-show lines', () => {
    const types = readSource('src/lib/types.ts');

    expect(types).not.toContain('Not used on no-show lines.');
    expect(types).toContain(
      '/** Optional taxable billable add-on; 0 when none. Available on completed and no-show lines. */',
    );
  });
});
