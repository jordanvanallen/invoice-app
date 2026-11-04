import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAutosaveController, flushPendingAutosave, settleAutosaveBeforeManualSave } from './autosave';

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

  test('waits for an in-flight save before flushing the latest snapshot', async () => {
    vi.useFakeTimers();
    let value = 'default';
    let savedJson = '';
    let releaseFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedValues: string[] = [];

    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => {
        savedValues.push(v);
        if (v === 'default') await firstSave;
      },
      setState: () => {},
      delayMs: 25,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    expect(savedValues).toEqual(['default']);

    value = 'edited';
    const flushPromise = autosave.flush();
    await Promise.resolve();
    expect(savedValues).toEqual(['default']);

    releaseFirstSave();
    await flushPromise;

    expect(savedValues).toEqual(['default', 'edited']);
    expect(savedJson).toBe('edited');

    autosave.dispose();
  });

  test('shares one promise across concurrent flush callers', async () => {
    vi.useFakeTimers();
    let value = 'before-preview';
    let savedJson = '';
    let releaseFirstSave!: () => void;
    let markFirstSaveStarted!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve;
    });
    const savedValues: string[] = [];
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (current) => current,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (current) => {
        savedValues.push(current);
        if (current === 'before-preview') {
          markFirstSaveStarted();
          await firstSave;
        }
      },
      setState: () => {},
      delayMs: 25,
    });

    const firstFlush = autosave.flush();
    await firstSaveStarted;
    value = 'preview-sorted';
    autosave.notifyChanged();

    const secondFlush = autosave.flush();
    releaseFirstSave();
    await Promise.all([firstFlush, secondFlush]);

    expect(secondFlush).toBe(firstFlush);
    expect(savedValues).toEqual(['before-preview', 'preview-sorted']);
    expect(savedJson).toBe('preview-sorted');
    autosave.dispose();
  });

  test('starts a successor flush after canceling an active drain', async () => {
    let value = 'before-cancel';
    let savedJson = '';
    let releaseFirstSave!: () => void;
    let markFirstSaveStarted!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve;
    });
    const savedValues: string[] = [];
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (current) => current,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (current) => {
        savedValues.push(current);
        if (current === 'before-cancel') {
          markFirstSaveStarted();
          await firstSave;
        }
      },
      setState: () => {},
    });

    const canceledFlush = autosave.flush();
    await firstSaveStarted;
    autosave.cancelPending();
    value = 'after-cancel';
    const successorFlush = autosave.flush();

    expect(successorFlush).not.toBe(canceledFlush);
    releaseFirstSave();
    await Promise.all([canceledFlush, successorFlush]);

    expect(savedValues).toEqual(['before-cancel', 'after-cancel']);
    expect(savedJson).toBe('after-cancel');
    autosave.dispose();
  });

  test('rejects an explicit flush whose save fails, and keeps retrying until it saves', async () => {
    vi.useFakeTimers();
    let value = 'unsaved edit';
    let savedJson = '';
    let failing = true;
    const states: string[] = [];
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async () => {
        if (failing) throw new Error('disk is locked');
      },
      setState: (state) => { states.push(state); },
      delayMs: 25,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    await expect(autosave.flush()).rejects.toThrow('disk is locked');
    expect(states.at(-1)).toBe('error');
    expect(autosave.hasUnsavedChanges()).toBe(true);

    failing = false;
    await vi.advanceTimersByTimeAsync(100);

    expect(savedJson).toBe('unsaved edit');
    expect(states.at(-1)).toBe('saved');
    expect(autosave.hasUnsavedChanges()).toBe(false);
    await expect(autosave.flush()).resolves.toBeUndefined();
    autosave.dispose();
  });

  test('gives every concurrent flush caller the same failure', async () => {
    let savedJson = '';
    const autosave = createAutosaveController({
      read: () => 'edit',
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async () => { throw new Error('write failed'); },
      setState: () => {},
      retryDelayMs: 60_000,
    });

    const first = autosave.flush();
    const second = autosave.flush();

    expect(second).toBe(first);
    await expect(first).rejects.toThrow('write failed');
    await expect(second).rejects.toThrow('write failed');
    autosave.dispose();
  });

  test('resolves a flush when its own save succeeds after an earlier background failure', async () => {
    vi.useFakeTimers();
    let value = 'first';
    let savedJson = '';
    let releaseFirstSave!: (error: Error) => void;
    const firstSave = new Promise<void>((_, reject) => {
      releaseFirstSave = reject;
    });
    const savedValues: string[] = [];
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => {
        savedValues.push(v);
        if (v === 'first') await firstSave;
      },
      setState: () => {},
      delayMs: 25,
      retryDelayMs: 100,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    value = 'second';
    const flushing = autosave.flush();
    releaseFirstSave(new Error('background save failed'));

    await expect(flushing).resolves.toBeUndefined();
    expect(savedValues).toEqual(['first', 'second']);
    expect(savedJson).toBe('second');
    autosave.dispose();
  });

  test('keeps edits made during a failing flush save in the same flush', async () => {
    let value = 'before';
    let savedJson = '';
    let rejectFirstSave!: (error: Error) => void;
    let markFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      markFirstSaveStarted = resolve;
    });
    const savedValues: string[] = [];
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async (v) => {
        savedValues.push(v);
        if (v === 'before') {
          markFirstSaveStarted();
          await new Promise<void>((_, reject) => { rejectFirstSave = reject; });
        }
      },
      setState: () => {},
      retryDelayMs: 60_000,
    });

    const flushing = autosave.flush();
    await firstSaveStarted;
    value = 'typed during save';
    autosave.notifyChanged();
    rejectFirstSave(new Error('superseded write failed'));

    await expect(flushing).resolves.toBeUndefined();
    expect(savedValues).toEqual(['before', 'typed during save']);
    expect(savedJson).toBe('typed during save');
    autosave.dispose();
  });

  test('never turns a timed or retried save failure into an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let attempts = 0;
      const autosave = createAutosaveController({
        read: () => 'edit',
        serialize: (v) => v,
        isSaved: () => false,
        markSaved: () => {},
        save: async () => {
          attempts += 1;
          throw new Error('still failing');
        },
        setState: () => {},
        delayMs: 1,
        retryDelayMs: 1,
      });

      autosave.notifyChanged();
      await new Promise((resolve) => setTimeout(resolve, 40));
      autosave.dispose();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(attempts).toBeGreaterThan(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('reports whether the visible draft differs from the last saved one', async () => {
    let value = 'saved';
    let savedJson = 'saved';
    const autosave = createAutosaveController({
      read: () => value,
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async () => {},
      setState: () => {},
    });

    expect(autosave.hasUnsavedChanges()).toBe(false);
    value = 'edited';
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await autosave.flush();
    expect(autosave.hasUnsavedChanges()).toBe(false);
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
      hasUnsavedChanges: () => true,
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
      hasUnsavedChanges: () => true,
    }, false);

    await promise;

    expect(flushed).toBe(false);
  });
});

describe('settleAutosaveBeforeManualSave', () => {
  test('waits for autosave flush before canceling pending autosave work', async () => {
    let releaseFlush!: () => void;
    const flushPromise = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const calls: string[] = [];

    const pending = settleAutosaveBeforeManualSave({
      notifyChanged: () => {},
      flush: async () => {
        calls.push('flush-start');
        await flushPromise;
        calls.push('flush-done');
      },
      cancelPending: () => { calls.push('cancel'); },
      dispose: () => {},
      hasUnsavedChanges: () => true,
    }, true);

    await Promise.resolve();
    expect(calls).toEqual(['flush-start']);

    releaseFlush();
    await pending;

    expect(calls).toEqual(['flush-start', 'flush-done', 'cancel']);
  });

  test('rejects without canceling the background retry when the flush fails', async () => {
    vi.useFakeTimers();
    let savedJson = '';
    let failing = true;
    const autosave = createAutosaveController({
      read: () => 'visible draft',
      serialize: (v) => v,
      isSaved: (json) => json === savedJson,
      markSaved: (json) => { savedJson = json; },
      save: async () => {
        if (failing) throw new Error('database is busy');
      },
      setState: () => {},
      retryDelayMs: 100,
    });

    await expect(settleAutosaveBeforeManualSave(autosave, true)).rejects.toThrow('database is busy');

    failing = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(savedJson).toBe('visible draft');
    autosave.dispose();
    vi.useRealTimers();
  });
});
