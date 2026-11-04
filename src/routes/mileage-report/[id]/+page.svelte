<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import MileageView from '$lib/components/MileageView.svelte';
  import { getDb } from '$lib/db';
  import {
    getMileageStatus,
    reprintMileageSnapshot,
    restoreMileageReport,
    voidMileageReport,
  } from '$lib/db/mileage-repo';
  import { formatKm } from '$lib/mileage/odometer';
  import type { MileageSnapshot, MileageStatus } from '$lib/mileage/types';
  import { saveMileagePdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';

  type LoadState = 'loading' | 'ready' | 'error';

  const id = $derived(Number($page.params.id));
  let loadState = $state<LoadState>('loading');
  let loadError = $state('');
  let snap = $state<MileageSnapshot | null>(null);
  let status = $state<MileageStatus | null>(null);
  let errorMessage = $state('');
  let busyAction = $state('');
  let showCancel = $state(false);
  const cancelled = $derived(status === 'void');

  let loadRequest = 0;
  async function load(reportId: number) {
    const requestId = ++loadRequest;
    loadState = 'loading';
    loadError = '';
    errorMessage = '';
    snap = null;
    status = null;
    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
      loadError = 'That mileage report link is not valid.';
      loadState = 'error';
      return;
    }
    try {
      const db = await getDb();
      const [nextSnap, nextStatus] = await Promise.all([
        reprintMileageSnapshot(db, reportId),
        getMileageStatus(db, reportId),
      ]);
      if (requestId !== loadRequest) return;
      snap = nextSnap;
      status = nextStatus;
      loadState = 'ready';
    } catch (error) {
      if (requestId !== loadRequest) return;
      loadError = (error as Error).message;
      loadState = 'error';
    }
  }

  $effect(() => {
    void load(id);
  });

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    busyAction = key;
    errorMessage = '';
    try { await action(); } catch (error) { errorMessage = (error as Error).message; }
    finally { busyAction = ''; }
  }

  function downloadPdf() {
    const current = snap;
    if (!current) return;
    return runAction('pdf', async () => { showSaveToast(await saveMileagePdf(current)); });
  }

  function cancelReport() {
    return runAction('cancel', async () => {
      await voidMileageReport(await getDb(), id);
      showCancel = false;
      await goto('/mileage-history');
    });
  }

  function closeCancel() {
    if (busyAction !== 'cancel') showCancel = false;
  }

  function restore() {
    return runAction('restore', async () => {
      await restoreMileageReport(await getDb(), id);
      await goto('/mileage-history');
    });
  }
</script>

<div class="bar">
  <BigButton variant="secondary" onclick={() => goto('/mileage-history')}>← Back to mileage history</BigButton>
  <span class="spacer"></span>
  {#if snap}
    <BigButton variant="secondary" disabled={!!busyAction} onclick={downloadPdf}>
      {busyAction === 'pdf' ? 'Saving...' : 'Download PDF'}
    </BigButton>
    {#if cancelled}
      <BigButton disabled={!!busyAction} onclick={restore}>
        {busyAction === 'restore' ? 'Restoring...' : 'Restore'}
      </BigButton>
    {:else if status === 'finalized'}
      <BigButton variant="destructive" disabled={!!busyAction} onclick={() => (showCancel = true)}>Cancel report</BigButton>
    {/if}
  {/if}
</div>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
{#if cancelled}<p class="cancelled-banner">This mileage report is cancelled and is not included in mileage totals.</p>{/if}

{#if showCancel && snap}
  <ConfirmDialog title="Cancel this mileage report?" confirmLabel={busyAction === 'cancel' ? 'Cancelling...' : 'Cancel report'}
    confirmVariant="destructive" confirmDisabled={!!busyAction} onConfirm={cancelReport} onCancel={closeCancel}>
    <p>Mileage report <b>#{snap.reportNumber}</b> ({formatKm(snap.totalKm)}) will move to the Cancelled section and stop counting toward totals.</p>
    <p class="muted">It stays in your records and can be restored later. Its number is never reused.</p>
  </ConfirmDialog>
{/if}

{#if loadState === 'loading'}
  <p class="muted" role="status">Loading...</p>
{:else if loadState === 'error'}
  <div class="load-error">
    <p class="error" role="alert">Couldn't open this mileage report: {loadError}</p>
    <BigButton variant="secondary" onclick={() => load(id)}>Try again</BigButton>
  </div>
{:else if snap}
  <MileageView {snap} />
{/if}

<style>
  .bar { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-6); }
  .spacer { flex: 1; }
  .error { padding: var(--sp-3) var(--sp-4); color: var(--red-600); border: 1px solid var(--red-600); background: var(--bg-surface); border-radius: var(--r-sm); }
  .cancelled-banner { max-width: 1040px; padding: var(--sp-3) var(--sp-4); color: var(--text-secondary); background: var(--bg-sunken); border-radius: var(--r-sm); }
  .muted { color: var(--text-secondary); }
  .load-error { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); }
</style>
