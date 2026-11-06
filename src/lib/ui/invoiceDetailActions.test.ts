import { describe, expect, test } from 'vitest';
import { runThenLeave } from './invoiceDetailActions';

describe('invoice detail actions', () => {
  test('leaves the page only after the action succeeds', async () => {
    const calls: string[] = [];

    const error = await runThenLeave(
      async () => { calls.push('restore'); },
      async () => { calls.push('leave'); },
    );

    expect(error).toBe('');
    expect(calls).toEqual(['restore', 'leave']);
  });

  test('stays on the page and returns the reason when the action is refused', async () => {
    let left = false;

    const error = await runThenLeave(
      async () => {
        throw new Error("Can't restore this invoice: VIN SAMEVIN1 was already billed on invoice #2-2026.");
      },
      async () => { left = true; },
    );

    expect(error).toBe("Can't restore this invoice: VIN SAMEVIN1 was already billed on invoice #2-2026.");
    expect(left).toBe(false);
  });

  test('reports non-Error rejections as text', async () => {
    expect(await runThenLeave(() => Promise.reject('database is locked'), async () => undefined))
      .toBe('database is locked');
  });
});
