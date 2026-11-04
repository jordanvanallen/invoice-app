export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveController {
  notifyChanged(): void;
  /**
   * Saves the visible draft now. Rejects with the save error when that write fails;
   * the background retry stays scheduled either way.
   */
  flush(): Promise<void>;
  cancelPending(): void;
  dispose(): void;
  /** True while the visible draft differs from the last one saved. */
  hasUnsavedChanges(): boolean;
}

export function flushPendingAutosave(
  autosave: AutosaveController | null,
  canFlush: boolean,
): Promise<void> | undefined {
  if (!autosave || !canFlush) return undefined;
  return autosave.flush();
}

/** Rejects, leaving the retry running, when the flush fails, so a manual save never goes ahead. */
export async function settleAutosaveBeforeManualSave(
  autosave: AutosaveController | null,
  canFlush: boolean,
): Promise<void> {
  await flushPendingAutosave(autosave, canFlush);
  autosave?.cancelPending();
}

type RunOutcome =
  | { status: 'saved' }
  | { status: 'stale' }
  | { status: 'failed'; error: unknown };

const SAVED: RunOutcome = { status: 'saved' };
const STALE: RunOutcome = { status: 'stale' };

interface AutosaveOptions<T> {
  read: () => T;
  serialize: (value: T) => string;
  isSaved: (json: string) => boolean;
  markSaved: (json: string) => void;
  save: (value: T) => Promise<void>;
  setState: (state: SaveState) => void;
  onSaved?: () => void;
  delayMs?: number;
  retryDelayMs?: number;
}

export function createAutosaveController<T>({
  read,
  serialize,
  isSaved,
  markSaved,
  save,
  setState,
  onSaved,
  delayMs = 1500,
  retryDelayMs = 3000,
}: AutosaveOptions<T>): AutosaveController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let changeVersion = 0;
  let flushRequestVersion = 0;
  let cancelVersion = 0;
  let disposed = false;
  let saveQueue = Promise.resolve();
  let flushInFlight: Promise<void> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function run(token: number): Promise<RunOutcome> {
    if (disposed || token !== generation) return STALE;
    setState('saving');
    const value = read();
    const json = serialize(value);
    if (isSaved(json)) {
      setState('saved');
      onSaved?.();
      return SAVED;
    }

    try {
      await save(value);
      if (disposed || token !== generation) return STALE;
      markSaved(json);
      setState('saved');
      onSaved?.();
      return SAVED;
    } catch (error) {
      // A newer edit or cancel already replaced this attempt; its own save decides.
      if (disposed || token !== generation) return STALE;
      setState('error');
      schedule(retryDelayMs, false);
      return { status: 'failed', error };
    }
  }

  function enqueueRun(token: number): Promise<RunOutcome> {
    const next = saveQueue.then(() => run(token), () => run(token));
    saveQueue = next.then(() => {}, () => {});
    return next;
  }

  function schedule(delay: number, showSaving: boolean) {
    if (disposed) return;
    clearTimer();
    if (showSaving) setState('saving');
    const token = ++generation;
    timer = setTimeout(() => {
      timer = null;
      void enqueueRun(token);
    }, delay);
  }

  return {
    notifyChanged() {
      const json = serialize(read());
      if (isSaved(json)) return;
      changeVersion += 1;
      schedule(delayMs, true);
    },
    flush() {
      clearTimer();
      flushRequestVersion += 1;
      if (flushInFlight) return flushInFlight;
      const startingCancelVersion = cancelVersion;
      const drain = (async () => {
        while (!disposed && cancelVersion === startingCancelVersion) {
          const observedChangeVersion = changeVersion;
          const observedFlushRequestVersion = flushRequestVersion;
          clearTimer();
          const token = ++generation;
          const outcome = await enqueueRun(token);
          // The retry is already scheduled; the caller still needs to know this write failed.
          if (outcome.status === 'failed') throw outcome.error;
          if (
            observedChangeVersion === changeVersion
            && observedFlushRequestVersion === flushRequestVersion
          ) return;
        }
      })();
      const tracked = drain.finally(() => {
        if (flushInFlight === tracked) flushInFlight = null;
      });
      flushInFlight = tracked;
      return tracked;
    },
    cancelPending() {
      clearTimer();
      generation += 1;
      cancelVersion += 1;
      flushInFlight = null;
    },
    dispose() {
      disposed = true;
      clearTimer();
      generation += 1;
    },
    hasUnsavedChanges() {
      return !isSaved(serialize(read()));
    },
  };
}
