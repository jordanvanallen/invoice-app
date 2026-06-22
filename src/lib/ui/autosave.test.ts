import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAutosaveController, flushPendingAutosave } from './autosave';

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

  test('flushes a pending change immediately before teardown', async () => {
    vi.useFakeTimers();
    let value = 'edited';
    let savedJson = '';
    const savedValues: string[] = [];

    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => { savedValues.push(v); },
      setState: () => {},
      delayMs: 1500,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    value = 'edited-again';
    await autosave.flush();

    expect(savedValues).toEqual(['edited-again']);
    expect(savedJson).toBe('edited-again');

    autosave.dispose();
  });
});

describe('flushPendingAutosave', () => {
  test('returns the flush promise when the current draft can be persisted', async () => {
    let flushed = false;
    const promise = flushPendingAutosave({
      notifyChanged: () => {},
      flush: async () => { flushed = true; },
      cancelPending: () => {},
      dispose: () => {},
    }, true);

    await promise;

    expect(flushed).toBe(true);
  });

  test('skips flushing when the current draft cannot be persisted', async () => {
    let flushed = false;
    const promise = flushPendingAutosave({
      notifyChanged: () => {},
      flush: async () => { flushed = true; },
      cancelPending: () => {},
      dispose: () => {},
    }, false);

    await promise;

    expect(flushed).toBe(false);
  });
});
