<script lang="ts">
  import { onMount } from 'svelte';
  import RestoreBackup from '$lib/components/RestoreBackup.svelte';
  import { getBackupFolder, setBackupFolder } from '$lib/stores/prefs';
  import { backupNow, latestBackupDate, lastBackupAt, backupFailed, backupError } from '$lib/stores/backup';
  import { openPdfPath } from '$lib/pdf/generate';
  import { open } from '@tauri-apps/plugin-dialog';

  let backupFolder = $state('');
  let backingUp = $state(false);
  let latestDate = $state<string | null>(null);

  async function refreshLatest() { latestDate = await latestBackupDate(); }

  /** Whole days between a YYYY-MM-DD backup date and today (null if no/invalid date). */
  function daysSince(d: string | null): number | null {
    const m = d && /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return null;
    const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((now.getTime() - then.getTime()) / 86_400_000);
  }
  const ageDays = $derived(daysSince(latestDate));
  const stale = $derived(latestDate === null || (ageDays !== null && ageDays > 7));

  onMount(async () => { backupFolder = getBackupFolder(); await refreshLatest(); });

  async function chooseFolder() {
    const picked = await open({ directory: true, title: 'Choose where to save backups' });
    if (typeof picked === 'string') { setBackupFolder(picked); backupFolder = picked; await refreshLatest(); }
  }
  async function useDownloads() { setBackupFolder(''); backupFolder = ''; await refreshLatest(); }
  async function openFolder() {
    const { downloadDir } = await import('@tauri-apps/api/path');
    await openPdfPath(backupFolder || (await downloadDir()));
  }
  async function doBackup() { backingUp = true; await backupNow(); await refreshLatest(); backingUp = false; }
</script>

<h1>Backups</h1>
<p class="lead">Your safety net — a full copy of every invoice and setting, so nothing is lost if your computer fails or you move to a new one.</p>

<div class="form">
  <section>
    <h2>Where backups are saved</h2>
    <p class="folder-now">Backups save here as dated files (invoice-backup-YYYY-MM-DD.db, last 14 kept): <b>{backupFolder || 'Downloads (default)'}</b></p>
    <p class="seg-label">Point this at Dropbox / OneDrive / Google&nbsp;Drive to keep an off-machine copy of all your data — then a dead computer never means lost invoices.</p>
    <div class="seg">
      <button onclick={chooseFolder}>Choose folder…</button>
      <button onclick={openFolder}>Open this folder</button>
      {#if backupFolder}<button onclick={useDownloads}>Use Downloads</button>{/if}
    </div>
    <div class="seg">
      <button onclick={doBackup} disabled={backingUp}>{backingUp ? 'Backing up…' : 'Back up now'}</button>
      <span class="bk-status" class:warn={$backupFailed}>
        {#if $backupFailed}⚠ Last backup failed{$backupError ? `: ${$backupError}` : ''}{:else if $lastBackupAt}✓ Backed up {$lastBackupAt}{:else}Backs up automatically when you finalize an invoice{/if}
      </span>
    </div>
    <p class="age" class:warn={stale}>
      {#if latestDate === null}
        ⚠ No backup found in this folder yet — click “Back up now”.
      {:else if ageDays !== null && ageDays > 7}
        ⚠ Newest backup is {ageDays} days old ({latestDate}) — back up soon.
      {:else}
        ✓ Newest backup: {latestDate}{ageDays === 0 ? ' (today)' : ageDays !== null ? ` (${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago)` : ''}
      {/if}
    </p>
  </section>

  <section>
    <h2>Restore from a backup</h2>
    <RestoreBackup />
  </section>
</div>

<style>
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0 0 var(--sp-2); }
  .lead { margin: 0 0 var(--sp-6); color: var(--text-secondary); max-width: 640px; }
  .form { display: flex; flex-direction: column; gap: var(--sp-8); max-width: 640px; }
  section { display: flex; flex-direction: column; gap: var(--sp-4); }
  h2 { font-size: var(--fs-lg); font-weight: 600; margin: 0; color: var(--accent-strong); }
  .seg-label { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); }
  .folder-now { margin: 0; font-size: var(--fs-base); }
  .folder-now b { overflow-wrap: anywhere; }
  .bk-status { display: inline-flex; align-items: center; color: var(--green-600); font-size: var(--fs-sm); }
  .bk-status.warn { color: var(--amber-600); }
  .age { margin: 0; font-size: var(--fs-sm); color: var(--green-600); }
  .age.warn { color: var(--amber-600); }
  .seg { display: inline-flex; gap: var(--sp-2); flex-wrap: wrap; }
  .seg button { min-height: var(--target); padding: 0 var(--sp-4); font-size: var(--fs-base); font-weight: 600;
    border: 1px solid var(--border-strong); background: var(--bg-surface); color: var(--text-primary); border-radius: var(--r-sm); cursor: pointer; }
  .seg button:hover { background: var(--accent-tint); }
  .seg button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
