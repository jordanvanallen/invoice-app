import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateLike = Pick<Update, 'version' | 'body'>;

export type UpdateCheckResult<T extends UpdateLike = Update> =
  | { status: 'available'; update: T }
  | { status: 'current' }
  | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function resolveUpdateCheck<T extends UpdateLike>(
  checkUpdates: () => Promise<T | null>,
): Promise<UpdateCheckResult<T>> {
  try {
    const update = await checkUpdates();
    return update ? { status: 'available', update } : { status: 'current' };
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  }
}

export function formatUpdateCheckMessage(result: UpdateCheckResult): string {
  if (result.status === 'current') return "You're on the latest version.";
  if (result.status === 'error') return `Could not check for updates: ${result.message}`;
  return `Installing version ${result.update.version}...`;
}

/** Check GitHub Releases for a newer signed version. Errors are surfaced so the
 *  UI doesn't report a failed check as "latest". */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  return resolveUpdateCheck(check);
}

/** Download + install the update, then relaunch into the new version. */
export async function installAndRestart(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

export type { Update };
