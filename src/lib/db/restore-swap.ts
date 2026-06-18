/**
 * Swap-on-launch for backup restore. The restore flow stages a validated backup
 * as PENDING_FILE and relaunches; this runs at startup BEFORE the DB is opened,
 * so the file is replaced cleanly with no live connection and no stale WAL.
 *
 * Tauri-only (dynamic imports); a no-op everywhere else.
 */
export const CANDIDATE_FILE = 'restore-candidate.db';
export const PENDING_FILE = 'restore-pending.db';
const LIVE_FILE = 'invoice.db';

/** Returns true if a pending backup was applied (caller then opens the new DB). */
export async function applyPendingRestore(): Promise<boolean> {
  try {
    const { appConfigDir, join } = await import('@tauri-apps/api/path');
    const { exists, readFile, writeFile, remove } = await import('@tauri-apps/plugin-fs');
    const dir = await appConfigDir();
    const pending = await join(dir, PENDING_FILE);
    if (!(await exists(pending))) return false;

    const bytes = await readFile(pending);
    const live = await join(dir, LIVE_FILE);
    // Drop stale WAL/SHM first so SQLite can't replay the OLD db onto the new file.
    await remove(live + '-wal').catch(() => {});
    await remove(live + '-shm').catch(() => {});
    await writeFile(live, bytes);
    await remove(pending).catch(() => {});
    await remove(await join(dir, CANDIDATE_FILE)).catch(() => {});
    return true;
  } catch {
    return false; // not in Tauri, or nothing pending
  }
}
