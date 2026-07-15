import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAutosaveController, flushPendingAutosave } from './autosave';
import { handleAutosavingWindowCloseRequest, handleWindowCloseRequest } from './windowClose';

function closeEvent() {
  return { preventDefault: vi.fn() };
}

describe('handleWindowCloseRequest', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('prevents the native close, saves, then destroys the window', async () => {
    const event = closeEvent();
    const save = vi.fn(async () => {});
    const destroy = vi.fn(async () => {});

    await handleWindowCloseRequest(event, { save, destroy });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  test('still destroys the window when best-effort save fails', async () => {
    const destroy = vi.fn(async () => {});

    await handleWindowCloseRequest(closeEvent(), {
      save: async () => { throw new Error('save failed'); },
      destroy,
    });

    expect(destroy).toHaveBeenCalledOnce();
  });

  test('falls back to process exit when destroy fails', async () => {
    const exit = vi.fn(async () => {});

    await handleWindowCloseRequest(closeEvent(), {
      save: async () => {},
      destroy: async () => { throw new Error('destroy failed'); },
      exit,
    });

    expect(exit).toHaveBeenCalledWith(0);
  });

  test('falls back to process exit when destroy hangs', async () => {
    vi.useFakeTimers();
    const exit = vi.fn(async () => {});
    const closing = handleWindowCloseRequest(closeEvent(), {
      save: async () => {},
      destroy: () => new Promise<void>(() => {}),
      exit,
      destroyTimeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    await closing;

    expect(exit).toHaveBeenCalledWith(0);
  });

  test('does not let a hung save block window close forever', async () => {
    vi.useFakeTimers();
    const destroy = vi.fn(async () => {});
    const closing = handleWindowCloseRequest(closeEvent(), {
      save: () => new Promise<void>(() => {}),
      destroy,
      saveTimeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    await closing;

    expect(destroy).toHaveBeenCalledOnce();
  });

  test('queues the latest draft behind an in-flight autosave before closing', async () => {
    vi.useFakeTimers();
    let draft = 'unsorted';
    let savedDraft = '';
    let releaseFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedDrafts: string[] = [];
    const autosave = createAutosaveController({
      read: () => draft,
      serialize: (value) => value,
      isSaved: (json) => json === savedDraft,
      markSaved: (json) => { savedDraft = json; },
      save: async (value) => {
        savedDrafts.push(value);
        if (value === 'unsorted') await firstSave;
      },
      setState: () => {},
      delayMs: 25,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    expect(savedDrafts).toEqual(['unsorted']);

    draft = 'preview-sorted';
    const destroy = vi.fn(async () => {});
    const closing = handleAutosavingWindowCloseRequest(closeEvent(), {
      autosave,
      canFlush: true,
      destroy,
      saveTimeoutMs: 1_000,
    });
    await Promise.resolve();

    expect(savedDrafts).toEqual(['unsorted']);
    expect(destroy).not.toHaveBeenCalled();

    releaseFirstSave();
    await closing;

    expect(savedDrafts).toEqual(['unsorted', 'preview-sorted']);
    expect(savedDraft).toBe('preview-sorted');
    expect(destroy).toHaveBeenCalledOnce();
    autosave.dispose();
  });

  test('keeps double-close callers on the same latest-draft flush', async () => {
    vi.useFakeTimers();
    let draft = 'unsorted';
    let savedDraft = '';
    let releaseFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedDrafts: string[] = [];
    const autosave = createAutosaveController({
      read: () => draft,
      serialize: (value) => value,
      isSaved: (json) => json === savedDraft,
      markSaved: (json) => { savedDraft = json; },
      save: async (value) => {
        savedDrafts.push(value);
        if (value === 'unsorted') await firstSave;
      },
      setState: () => {},
      delayMs: 25,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    draft = 'preview-sorted';

    const firstClose = handleAutosavingWindowCloseRequest(closeEvent(), {
      autosave,
      canFlush: true,
      destroy: async () => { autosave.dispose(); },
    });
    const secondClose = handleAutosavingWindowCloseRequest(closeEvent(), {
      autosave,
      canFlush: true,
      destroy: async () => {},
    });

    releaseFirstSave();
    await Promise.all([firstClose, secondClose]);

    expect(savedDrafts).toEqual(['unsorted', 'preview-sorted']);
    expect(savedDraft).toBe('preview-sorted');
  });

  test('shares the latest-draft flush between navigation and close', async () => {
    vi.useFakeTimers();
    let draft = 'unsorted';
    let savedDraft = '';
    let releaseFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    const savedDrafts: string[] = [];
    const autosave = createAutosaveController({
      read: () => draft,
      serialize: (value) => value,
      isSaved: (json) => json === savedDraft,
      markSaved: (json) => { savedDraft = json; },
      save: async (value) => {
        savedDrafts.push(value);
        if (value === 'unsorted') await firstSave;
      },
      setState: () => {},
      delayMs: 25,
    });

    autosave.notifyChanged();
    await vi.advanceTimersByTimeAsync(25);
    draft = 'preview-sorted';

    const navigation = flushPendingAutosave(autosave, true)?.then(() => {
      autosave.dispose();
    });
    const closing = handleAutosavingWindowCloseRequest(closeEvent(), {
      autosave,
      canFlush: true,
      destroy: async () => {},
    });

    releaseFirstSave();
    await Promise.all([navigation, closing]);

    expect(savedDrafts).toEqual(['unsorted', 'preview-sorted']);
    expect(savedDraft).toBe('preview-sorted');
  });
});
