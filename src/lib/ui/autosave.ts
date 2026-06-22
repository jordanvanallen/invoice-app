export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveController {
  notifyChanged(): void;
  flush(): Promise<void>;
  cancelPending(): void;
  dispose(): void;
}

export function flushPendingAutosave(
  autosave: AutosaveController | null,
  canFlush: boolean,
): Promise<void> | undefined {
  if (!autosave || !canFlush) return undefined;
  return autosave.flush();
}

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
  let disposed = false;
  let saveQueue = Promise.resolve();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function run(token: number) {
    if (disposed || token !== generation) return;
    setState('saving');
    const value = read();
    const json = serialize(value);
    if (isSaved(json)) {
      setState('saved');
      onSaved?.();
      return;
    }

    try {
      await save(value);
      if (disposed || token !== generation) return;
      markSaved(json);
      setState('saved');
      onSaved?.();
    } catch {
      if (disposed || token !== generation) return;
      setState('error');
      schedule(retryDelayMs, false);
    }
  }

  function enqueueRun(token: number): Promise<void> {
    const next = saveQueue.then(() => run(token), () => run(token));
    saveQueue = next.catch(() => {});
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
      schedule(delayMs, true);
    },
    async flush() {
      clearTimer();
      const token = ++generation;
      await enqueueRun(token);
    },
    cancelPending() {
      clearTimer();
      generation += 1;
    },
    dispose() {
      disposed = true;
      clearTimer();
      generation += 1;
    },
  };
}
