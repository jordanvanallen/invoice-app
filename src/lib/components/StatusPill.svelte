<script lang="ts">
  let { status, invoiceNumber = '' }:
    { status: 'draft' | 'finalized' | 'void'; invoiceNumber?: string } = $props();

  const text = $derived(
    status === 'draft' ? 'DRAFT — not sent yet, you can still edit'
    : status === 'finalized' ? `FINALIZED · Invoice #${invoiceNumber}`
    : `VOID #${invoiceNumber}`,
  );
</script>

<span class="pill {status}">{text}</span>

<style>
  .pill { display: inline-flex; align-items: center; height: 36px; padding: 0 var(--sp-4);
    border-radius: var(--r-full); font-size: var(--fs-sm); font-weight: 600; }
  .draft { background: var(--amber-50); color: var(--amber-600); }
  .finalized { background: var(--accent-tint); color: var(--accent-strong); }
  .void { background: var(--bg-sunken); color: var(--text-muted); }
</style>
