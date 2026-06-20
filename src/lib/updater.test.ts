import { describe, expect, test } from 'vitest';
import { formatUpdateCheckMessage, resolveUpdateCheck, type UpdateLike } from './updater';

const update: UpdateLike = { version: '0.1.1', body: 'Bug fixes' };

describe('resolveUpdateCheck', () => {
  test('distinguishes current from update available', async () => {
    await expect(resolveUpdateCheck(async () => null)).resolves.toEqual({ status: 'current' });
    await expect(resolveUpdateCheck(async () => update)).resolves.toEqual({ status: 'available', update });
  });

  test('surfaces updater errors instead of calling the app current', async () => {
    await expect(resolveUpdateCheck(async () => {
      throw new Error('signature mismatch');
    })).resolves.toEqual({ status: 'error', message: 'signature mismatch' });
  });
});

describe('formatUpdateCheckMessage', () => {
  test('does not call updater errors latest-version checks', () => {
    expect(formatUpdateCheckMessage({ status: 'error', message: 'signature mismatch' }))
      .toBe('Could not check for updates: signature mismatch');
  });
});
