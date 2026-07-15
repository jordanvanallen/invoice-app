<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ExpenseView from '$lib/components/ExpenseView.svelte';
  import { getDb } from '$lib/db';
  import {
    deleteVoidedExpenseReport,
    duplicateExpenseReport,
    getExpenseStatus,
    reprintExpenseSnapshot,
    restoreExpenseReport,
    voidExpenseReport,
  } from '$lib/db/expense-repo';
  import type { ExpenseSnapshot, ExpenseStatus } from '$lib/expense/types';
  import { saveExpensePdf } from '$lib/pdf/generate';
  import { showSaveToast } from '$lib/stores/toast';
  import { defaultInvoicePeriod } from '$lib/ui/date';

  const id = $derived(Number($page.params.id));
  let snap = $state<ExpenseSnapshot | null>(null);
  let status = $state<ExpenseStatus | null>(null);
  let errorMessage = $state('');
  let busyAction = $state('');
  let showCancel = $state(false);
  let deleteStep = $state<0 | 1 | 2>(0);
  const cancelled = $derived(status === 'void');

  onMount(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      errorMessage = 'That expense report number is not valid.';
      return;
    }
    try {
      const db = await getDb();
      [snap, status] = await Promise.all([
        reprintExpenseSnapshot(db, id),
        getExpenseStatus(db, id),
      ]);
    } catch (error) {
      errorMessage = (error as Error).message;
    }
  });

  async function runAction(key: string, action: () => Promise<void>) {
    if (busyAction) return;
    busyAction = key;
    errorMessage = '';
    try { await action(); } catch (error) { errorMessage = (error as Error).message; }
    finally { busyAction = ''; }
  }

  function downloadPdf() {
    if (!snap) return;
    return runAction('pdf', async () => { showSaveToast(await saveExpensePdf(snap as ExpenseSnapshot)); });
  }

  function duplicate() {
    return runAction('duplicate', async () => {
      const defaults = defaultInvoicePeriod();
      await duplicateExpenseReport(await getDb(), id, {
        year: defaults.year,
        reportDate: defaults.issueDate,
        periodStart: defaults.periodStart,
        periodEnd: defaults.periodEnd,
      });
      await goto('/expenses');
    });
  }

  function cancelReport() {
    return runAction('cancel', async () => {
      await voidExpenseReport(await getDb(), id);
      showCancel = false;
      await goto('/expense-history');
    });
  }

  function restore() {
    return runAction('restore', async () => {
      await restoreExpenseReport(await getDb(), id);
      await goto('/expense-history');
    });
  }

  function deleteForever() {
    return runAction('delete', async () => {
      const deleted = await deleteVoidedExpenseReport(await getDb(), id);
      if (!deleted) throw new Error('This report is no longer cancelled, so it was not deleted.');
      deleteStep = 0;
      await goto('/expense-history');
    });
  }
</script>

<div class="bar">
  <BigButton variant="secondary" onclick={() => goto('/expense-history')}>← Back to expense history</BigButton>
  <span class="spacer"></span>
  {#if snap}
    <BigButton variant="secondary" disabled={!!busyAction} onclick={downloadPdf}>
      {busyAction === 'pdf' ? 'Saving...' : 'Download PDF'}
    </BigButton>
    <BigButton disabled={!!busyAction} onclick={duplicate}>
      {busyAction === 'duplicate' ? 'Opening...' : 'Duplicate'}
    </BigButton>
    {#if cancelled}
      <BigButton variant="secondary" disabled={!!busyAction} onclick={restore}>
        {busyAction === 'restore' ? 'Restoring...' : 'Restore'}
      </BigButton>
      <BigButton variant="destructive" disabled={!!busyAction} onclick={() => (deleteStep = 1)}>Delete permanently</BigButton>
    {:else}
      <BigButton variant="destructive" disabled={!!busyAction} onclick={() => (showCancel = true)}>Cancel report</BigButton>
    {/if}
  {/if}
</div>

{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
{#if cancelled}<p class="cancelled-banner">This expense report is cancelled and is not included in expense totals.</p>{/if}

{#if showCancel && snap}
  <ConfirmDialog title="Cancel this expense report?" confirmLabel={busyAction === 'cancel' ? 'Cancelling...' : 'Cancel report'}
    confirmVariant="destructive" confirmDisabled={!!busyAction} onConfirm={cancelReport} onCancel={() => (showCancel = false)}>
    <p>Expense report <b>#{snap.reportNumber}</b> will move to the Cancelled section and stop counting toward totals.</p>
    <p class="muted">It stays in your records and can be restored later.</p>
  </ConfirmDialog>
{/if}

{#if deleteStep === 1 && snap}
  <ConfirmDialog title="Delete this cancelled report?" confirmLabel="Continue" confirmVariant="destructive"
    onConfirm={() => (deleteStep = 2)} onCancel={() => (deleteStep = 0)}>
    <p>Expense report <b>#{snap.reportNumber}</b> and all of its rows will be permanently removed.</p>
    <p class="muted">Restoring it is safer if you may need it later.</p>
  </ConfirmDialog>
{/if}

{#if deleteStep === 2 && snap}
  <ConfirmDialog title="Are you absolutely sure?" confirmLabel={busyAction === 'delete' ? 'Deleting...' : 'Delete permanently'}
    confirmVariant="destructive" confirmDisabled={!!busyAction} onConfirm={deleteForever} onCancel={() => (deleteStep = 0)}>
    <p><b>This can't be undone.</b> Expense report #{snap.reportNumber} will be gone permanently.</p>
  </ConfirmDialog>
{/if}

{#if snap}
  <ExpenseView {snap} />
{:else if !errorMessage}
  <p class="muted">Loading...</p>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-6); }
  .spacer { flex: 1; }
  .error { padding: var(--sp-3) var(--sp-4); color: var(--red-600); border: 1px solid var(--red-600); background: var(--bg-surface); border-radius: var(--r-sm); }
  .cancelled-banner { max-width: 820px; padding: var(--sp-3) var(--sp-4); color: var(--text-secondary); background: var(--bg-sunken); border-radius: var(--r-sm); }
  .muted { color: var(--text-secondary); }
</style>
