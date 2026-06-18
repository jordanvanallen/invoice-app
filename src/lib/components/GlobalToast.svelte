<script lang="ts">
  import Toast from './Toast.svelte';
  import { toast, dismissToast } from '$lib/stores/toast';
  import { openPdfPath, revealPdfPath } from '$lib/pdf/generate';

  let openErr = $state(false);
  // Reset the error whenever a new toast appears.
  $effect(() => {
    void $toast;
    openErr = false;
  });

  async function tryOpen(p: string) {
    openErr = false;
    try {
      await openPdfPath(p);
    } catch {
      openErr = true;
    }
  }
</script>

{#if $toast}
  <Toast>
    <span>✓ Saved <b>{$toast.fileName}</b>{#if !$toast.path} to your Downloads{/if}</span>
    {#if $toast.path}
      {@const p = $toast.path}
      <button class="t-act" onclick={() => tryOpen(p)}>Open</button>
      <button class="t-act" onclick={() => revealPdfPath(p)}>Open location</button>
    {/if}
    {#if openErr}<span class="open-err">Couldn't open it — no default PDF app set. Use Open location.</span>{/if}
    <button class="t-close" aria-label="Dismiss" onclick={dismissToast}>✕</button>
  </Toast>
{/if}

<style>
  .t-act { min-height: 40px; padding: 0 var(--sp-4); border: 1px solid var(--accent); background: transparent;
    color: var(--accent); border-radius: var(--r-sm); font-weight: 600; font-size: var(--fs-sm); cursor: pointer; }
  .t-act:hover { background: var(--accent-tint); }
  .open-err { color: var(--amber-600); font-size: var(--fs-sm); }
  .t-close { min-height: 40px; min-width: 40px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-size: var(--fs-base); }
</style>
