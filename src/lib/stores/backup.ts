import { writable } from 'svelte/store';
import { getDb } from '../db';
import { vacuumIntoSql } from '../db/backup';
import { getBackupFolder } from './prefs';

/** Human-readable time of the last successful backup this session (null = none yet). */
export const lastBackupAt = writable<string | null>(null);
export const backupFailed = writable<boolean>(false);
export const backupError = writable<string>('');

/** Keep this many daily backups before pruning the oldest. */
const KEEP_BACKUPS = 14;
const BACKUP_RE = /^invoice-backup-\d{4}-\d{2}-\d{2}\.db$/;

/** Local YYYY-MM-DD (not UTC) so the filename matches the user's calendar day. */
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Write a consistent copy of the database (VACUUM INTO) to the backup folder as
 * a DATED file (invoice-backup-YYYY-MM-DD.db) — one per day — and prune to the
 * most recent KEEP_BACKUPS. Rolling history means a single corrupt write can't
 * wipe the last good copy. Best-effort: never throws.
 */
export async function backupNow(): Promise<boolean> {
  try {
    const { downloadDir, join } = await import('@tauri-apps/api/path');
    const { remove, readDir } = await import('@tauri-apps/plugin-fs');
    const dir = getBackupFolder() || (await downloadDir());
    const path = await join(dir, `invoice-backup-${todayStamp()}.db`);
    await remove(path).catch(() => {}); // same-day rewrite (VACUUM INTO won't overwrite)
    const db = await getDb();
    await db.execute(vacuumIntoSql(path));

    // Prune older dated backups beyond the keep window (lexical sort == date order).
    try {
      const names = (await readDir(dir)).map((e) => e.name).filter((n) => BACKUP_RE.test(n)).sort();
      for (const name of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
        await remove(await join(dir, name)).catch(() => {});
      }
    } catch { /* pruning is best-effort */ }

    lastBackupAt.set(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    backupFailed.set(false);
    backupError.set('');
    return true;
  } catch (e) {
    backupFailed.set(true);
    backupError.set((e as Error)?.message ?? String(e));
    return false;
  }
}

/** The date (YYYY-MM-DD) of the newest dated backup in the folder, or null if none. */
export async function latestBackupDate(): Promise<string | null> {
  try {
    const { downloadDir } = await import('@tauri-apps/api/path');
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const dir = getBackupFolder() || (await downloadDir());
    const names = (await readDir(dir)).map((e) => e.name).filter((n) => BACKUP_RE.test(n)).sort();
    const newest = names.at(-1);
    return newest ? newest.slice('invoice-backup-'.length, 'invoice-backup-'.length + 10) : null;
  } catch {
    return null;
  }
}
