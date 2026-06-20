import { afterEach, describe, expect, test, vi } from 'vitest';
import { handleWindowCloseRequest } from './windowClose';

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
});
