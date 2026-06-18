import { writable } from 'svelte/store';
import type { Settings } from '../types';
import { getDb } from '../db';
import { getSettings, saveSettings as repoSave } from '../db/settings-repo';

/** Current settings (null until first load). */
export const settings = writable<Settings | null>(null);

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const s = await getSettings(db);
  settings.set(s);
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDb();
  await repoSave(db, s);
  settings.set(s);
}

/** First-run when the legally-required identity fields are still blank. */
export function isFirstRun(s: Settings): boolean {
  return !s.inspectorName.trim() || !s.gstHstRegistrationNumber.trim();
}
