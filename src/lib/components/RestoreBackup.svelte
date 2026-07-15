<script lang="ts">
  import { pickBackupFile, validateBackupFile, commitRestore, discardCandidate } from '$lib/stores/restore';
  import type { BackupSummary } from '$lib/db/restore';

  type Step = 'idle' | 'checking' | 'review' | 'error' | 'applying';
  let step = $state<Step>('idle');
  let errorMsg = $state('');
  let summary = $state<BackupSummary | null>(null);
  let ack = $state(false);
  let typed = $state('');

  const canApply = $derived(ack && typed.trim().toUpperCase() === 'RESTORE');

  function reset() {
    step = 'idle'; errorMsg = ''; summary = null; ack = false; typed = '';
  }

  async function start() {
    errorMsg = '';
    const path = await pickBackupFile();
    if (!path) return;
    step = 'checking';
    try {
      const check = await validateBackupFile(path);
      if (!check.ok) {
        errorMsg = check.reason ?? 'This file could not be used as a backup.';
        step = 'error';
        await discardCandidate();
        return;
      }
      summary = check.summary ?? null;
      ack = false; typed = '';
      step = 'review';
    } catch (e) {
      errorMsg = (e as Error)?.message ?? String(e);
      step = 'error';
      await discardCandidate();
    }
  }

  async function cancel() {
    await discardCandidate();
    reset();
  }

  async function apply() {
    if (!canApply) return;
    step = 'applying';
    try {
      await commitRestore(); // relaunches the app on success
    } catch (e) {
      errorMsg = (e as Error)?.message ?? String(e);
      step = 'error';
    }
  }
</script>

<div class="restore">
  <p class="lead">Restoring replaces <b>all current data</b> with a backup. Use this after a reinstall or a computer change.</p>

  {#if step === 'idle' || step === 'error'}
    <div class="seg">
      <button class="danger" onclick={start}>Restore from a backup…</button>
    </div>
    {#if step === 'error'}<p class="err">⚠ {errorMsg}</p>{/if}

  {:else if step === 'checking'}
    <p class="muted">Checking the backup file…</p>

  {:else if step === 'review' && summary}
    <div class="panel">
      <h3>Review this backup before restoring</h3>
      <ul class="facts">
        <li><span>Business</span><b>{summary.businessName}</b></li>
        <li><span>Finalized invoices</span><b>{summary.invoiceCount}</b></li>
        <li><span>Latest invoice</span><b>{summary.latestInvoiceDate ?? '—'}</b></li>
        <li><span>Finalized expense reports</span><b>{summary.expenseReportCount}</b></li>
        <li><span>Latest expense report</span><b>{summary.latestExpenseReportDate ?? '—'}</b></li>
      </ul>
      <p class="warn">This will <b>replace everything currently in the app</b> and can't be undone. Your current data is saved to <b>invoice-before-restore.db</b> first, just in case.</p>

      <label class="check">
        <input type="checkbox" bind:checked={ack} />
        I understand my current data will be replaced.
      </label>

      <label class="type">
        Type <b>RESTORE</b> to confirm:
        <input type="text" bind:value={typed} placeholder="RESTORE" autocomplete="off" spellcheck="false" />
      </label>

      <div class="seg">
        <button onclick={cancel}>Cancel</button>
        <button class="danger" disabled={!canApply} onclick={apply}>Restore and restart</button>
      </div>
    </div>

  {:else if step === 'applying'}
    <p class="muted">Restoring and restarting the app…</p>
  {/if}
</div>

<style>
  .restore { display: flex; flex-direction: column; gap: var(--sp-3); }
  .lead { margin: 0; color: var(--text-secondary); font-size: var(--fs-sm); }
  .seg { display: inline-flex; gap: var(--sp-2); flex-wrap: wrap; }
  .muted { color: var(--text-secondary); margin: 0; }
  .err { color: var(--red-600); margin: 0; }
  button { min-height: var(--target); padding: 0 var(--sp-4); font-size: var(--fs-base); font-weight: 600;
    border: 1px solid var(--border-strong); background: var(--bg-surface); color: var(--text-primary);
    border-radius: var(--r-sm); cursor: pointer; }
  button:hover { background: var(--accent-tint); }
  button.danger { border-color: var(--red-600); color: var(--red-600); }
  button.danger:hover:not(:disabled) { background: var(--red-600); color: #fff; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .panel { display: flex; flex-direction: column; gap: var(--sp-4);
    border: 1px solid var(--red-600); border-radius: var(--r-md); padding: var(--sp-4); background: var(--bg-surface); }
  h3 { margin: 0; font-size: var(--fs-base); font-weight: 700; }
  .facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .facts li { display: flex; justify-content: space-between; gap: var(--sp-4); border-bottom: 1px solid var(--border); padding-bottom: var(--sp-2); }
  .facts span { color: var(--text-secondary); }
  .warn { margin: 0; color: var(--amber-600); font-size: var(--fs-sm); }
  .check, .type { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-base); }
  .type { flex-wrap: wrap; }
  .type input { min-height: var(--target); padding: 0 var(--sp-3); border: 1px solid var(--border-strong);
    border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-primary); font-size: var(--fs-base); }
  .check input { width: 20px; height: 20px; }
</style>
