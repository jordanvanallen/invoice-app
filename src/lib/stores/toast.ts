import { writable } from 'svelte/store';
import type { SaveResult } from '$lib/pdf/generate';

/** The currently-visible save toast (null = hidden). App-wide. */
export const toast = writable<SaveResult | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;

export function showSaveToast(r: SaveResult): void {
  toast.set(r);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => toast.set(null), 6000);
}

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  toast.set(null);
}
