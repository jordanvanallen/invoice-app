import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAutosaveController } from './autosave';

describe('createAutosaveController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('debounces changes and saves the latest snapshot', async () => {
    vi.useFakeTimers();
    let value = 'first';
    let savedJson = '';
    const savedValues: string[] = [];

    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => { savedValues.push(v); },
      setState: () => {},
      delayMs: 25,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    value = 'second';
    autosave.notifyChanged();

    await vi.advanceTimersByTimeAsync(24);
    expect(savedValues).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(savedValues).toEqual(['second']);
    expect(savedJson).toBe('second');

    autosave.dispose();
  });

  test('retries a failed save and retries the current snapshot', async () => {
    vi.useFakeTimers();
    let value = 'first';
    let savedJson = '';
    let attempts = 0;
    const states: string[] = [];
    const savedValues: string[] = [];

    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => {
        attempts += 1;
        savedValues.push(v);
        if (attempts === 1) throw new Error('temporarily unavailable');
      },
      setState: (state) => { states.push(state); },
      delayMs: 25,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    expect(states).toContain('error');

    value = 'second';
    await vi.advanceTimersByTimeAsync(100);

    expect(savedValues).toEqual(['first', 'second']);
    expect(savedJson).toBe('second');
    expect(states.at(-1)).toBe('saved');

    autosave.dispose();
  });
});
