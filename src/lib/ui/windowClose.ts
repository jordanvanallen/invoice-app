interface CloseEventLike {
  preventDefault(): void;
}

interface WindowCloseOptions {
  save: () => Promise<void>;
  destroy: () => Promise<void>;
  exit?: (code: number) => Promise<void> | void;
  saveTimeoutMs?: number;
  destroyTimeoutMs?: number;
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleWindowCloseRequest(
  event: CloseEventLike,
  { save, destroy, exit, saveTimeoutMs = 800, destroyTimeoutMs = 800 }: WindowCloseOptions,
): Promise<void> {
  event.preventDefault();
  try {
    await Promise.race([save(), timeout(saveTimeoutMs)]);
  } catch {
    // Best effort only. Closing the app is more important than blocking forever.
  }

  const destroyed = await Promise.race([
    destroy().then(() => true).catch(() => false),
    timeout(destroyTimeoutMs).then(() => false),
  ]);
  if (!destroyed) {
    await exit?.(0);
  }
}
