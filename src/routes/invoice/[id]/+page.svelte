<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getDb } from '$lib/db';
  import { reprintSnapshot, duplicateInvoice, voidInvoice, unvoidInvoice, getInvoiceStatus, deleteVoidedInvoice } from '$lib/db/invoice-repo';
  import { saveInvoicePdf } from '$lib/pdf/generate';
  import { defaultInvoicePeriod } from '$lib/ui/date';
  import { showSaveToast } from '$lib/stores/toast';
  import InvoiceView from '$lib/components/InvoiceView.svelte';
  import BigButton from '$lib/components/BigButton.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import type { FinalizedSnapshot } from '$lib/types';

  let snap = $state<FinalizedSnapshot | null>(null);
  let status = $state<string | null>(null);
  let errorMsg = $state('');
  let showCancel = $state(false);
  let showDelete = $state(false);
  const id = $derived(Number($page.params.id));
  const cancelled = $derived(status === 'void');

  onMount(async () => {
    try {
      const db = await getDb();
      snap = await reprintSnapshot(db, id);
      status = await getInvoiceStatus(db, id);
    } catch (e) {
      errorMsg = (e as Error).message;
    }
  });

  async function downloadPdf() {
    if (snap) showSaveToast(await saveInvoicePdf(snap));
  }

  async function duplicate() {
    await duplicateInvoice(await getDb(), id, defaultInvoicePeriod());
    await goto('/');
  }

  async function cancelInvoice() {
    await voidInvoice(await getDb(), id);
    showCancel = false;
    await goto('/history');
  }

  async function restore() {
    await unvoidInvoice(await getDb(), id);
    await goto('/history');
  }

  async function deleteForever() {
    await deleteVoidedInvoice(await getDb(), id);
    showDelete = false;
    await goto('/history');
  }
</script>

<div class="bar">
  <BigButton variant="secondary" onclick={() => goto('/history')}>← Back to history</BigButton>
  <span class="sp"></span>
  {#if snap}
    <BigButton variant="secondary" onclick={downloadPdf}>Download PDF</BigButton>
    <BigButton onclick={duplicate}>Duplicate</BigButton>
    {#if cancelled}
      <BigButton variant="secondary" onclick={restore}>Restore</BigButton>
      <BigButton variant="destructive" onclick={() => (showDelete = true)}>Delete permanently</BigButton>
    {:else}
      <BigButton variant="destructive" onclick={() => (showCancel = true)}>Cancel invoice</BigButton>
    {/if}
  {/if}
</div>

{#if showCancel && snap}
  <ConfirmDialog
    title="Cancel this invoice?"
    confirmLabel="Cancel invoice"
    confirmVariant="destructive"
    onConfirm={cancelInvoice}
    onCancel={() => (showCancel = false)}
  >
    <p>Invoice <b>#{snap.invoiceNumber}</b> will be marked cancelled and removed from your totals and History.</p>
    <p style="color:var(--text-secondary)">It stays in your records (it isn't deleted) and won't count toward income or HST. If it was a mistake, you can <b>Restore</b> it anytime from History → Cancelled.</p>
  </ConfirmDialog>
{/if}

{#if showDelete && snap}
  <ConfirmDialog
    title="Permanently delete this invoice?"
    confirmLabel="Delete permanently"
    confirmVariant="destructive"
    onConfirm={deleteForever}
    onCancel={() => (showDelete = false)}
  >
    <p>Cancelled invoice <b>#{snap.invoiceNumber}</b> and its line items will be <b>permanently deleted</b>. This can't be undone.</p>
    <p style="color:var(--text-secondary)">If you might need it again, use <b>Restore</b> instead.</p>
  </ConfirmDialog>
{/if}

{#if errorMsg}
  <p class="err">Couldn't load this invoice: {errorMsg}</p>
{:else if snap}
  <InvoiceView {snap} />
{:else}
  <p style="color:var(--text-secondary)">Loading…</p>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-6); }
  .bar .sp { flex: 1; }
  .err { color: var(--red-600); }
</style>
