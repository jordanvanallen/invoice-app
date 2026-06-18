<script lang="ts">
  let { state = 'idle', savedAt = '' }:
    { state?: 'idle' | 'saving' | 'saved' | 'error'; savedAt?: string } = $props();
</script>

<span class="chip {state}">
  {#if state === 'saving'}Saving…
  {:else if state === 'saved'}✓ Saved{savedAt ? ` ${savedAt}` : ''}
  {:else if state === 'error'}Couldn't save — retrying
  {:else}&nbsp;{/if}
</span>

<style>
  .chip { display: inline-flex; align-items: center; height: 32px; padding: 0 var(--sp-3);
    font-size: var(--fs-sm); border-radius: var(--r-full); color: var(--text-muted); }
  .saved { color: var(--green-600); }
  .saving { color: var(--text-secondary); }
  .error { color: var(--amber-600); background: var(--amber-50); }
</style>
