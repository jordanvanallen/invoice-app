import { createTauriDb } from '../db/tauri-adapter';
import { getDb } from '../db';
import { validateBackup, type BackupCheck } from '../db/restore';
import { CANDIDATE_FILE, PENDING_FILE } from '../db/restore-swap';
import { vacuumIntoSql } from '../db/backup';
import { getBackupFolder } from './prefs';

/** Let the user pick a .db backup file. Returns its absolute path, or null if cancelled. */
export async function pickBackupFile(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: false,
    directory: false,
    title: 'Choose your backup file (invoice-backup-YYYY-MM-DD.db)',
    filters: [{ name: 'Invoice backup', extensions: ['db'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

/**
 * Copy the picked file into a sandbox candidate and validate it in its OWN
 * connection — the live database is never touched. On success the candidate is
 * left staged for commitRestore(); on failure callers should discardCandidate().
 */
export async function validateBackupFile(sourcePath: string): Promise<BackupCheck> {
  const { appConfigDir, join } = await import('@tauri-apps/api/path');
  const { readFile, writeFile, remove } = await import('@tauri-apps/plugin-fs');
  const dir = await appConfigDir();
  const candidate = await join(dir, CANDIDATE_FILE);
  // Drop any stale candidate journal so it can't replay onto the new candidate.
  await remove(candidate + '-wal').catch(() => {});
  await remove(candidate + '-shm').catch(() => {});
  const bytes = await readFile(sourcePath);
  await writeFile(candidate, bytes);

  const candidateDb = await createTauriDb(`sqlite:${CANDIDATE_FILE}`);
  try {
    return await validateBackup(candidateDb);
  } finally {
    try { await candidateDb.raw.close(); } catch { /* ignore */ }
  }
}

/**
 * Commit a validated candidate: snapshot the CURRENT data as a safety net,
 * promote the candidate to PENDING_FILE, then relaunch so it is swapped in at
 * startup (clean, no live connection).
 */
export async function commitRestore(): Promise<void> {
  const { appConfigDir, join, downloadDir } = await import('@tauri-apps/api/path');
  const { readFile, writeFile, remove } = await import('@tauri-apps/plugin-fs');

  // Safety net: copy current data to invoice-before-restore.db (best effort).
  try {
    const db = await getDb();
    const out = getBackupFolder() || (await downloadDir());
    const snap = await join(out, 'invoice-before-restore.db');
    await remove(snap).catch(() => {});
    await db.execute(vacuumIntoSql(snap));
  } catch { /* don't block the restore if the snapshot can't be written */ }

  const dir = await appConfigDir();
  const bytes = await readFile(await join(dir, CANDIDATE_FILE));
  await writeFile(await join(dir, PENDING_FILE), bytes);

  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** Remove a staged candidate when the user backs out. */
export async function discardCandidate(): Promise<void> {
  try {
    const { appConfigDir, join } = await import('@tauri-apps/api/path');
    const { remove } = await import('@tauri-apps/plugin-fs');
    const dir = await appConfigDir();
    const candidate = await join(dir, CANDIDATE_FILE);
    await remove(candidate).catch(() => {});
    await remove(candidate + '-wal').catch(() => {});
    await remove(candidate + '-shm').catch(() => {});
  } catch { /* ignore */ }
}
