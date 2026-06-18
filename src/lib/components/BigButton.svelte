<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    variant = 'primary',
    type = 'button',
    disabled = false,
    onclick,
    children,
  }: {
    variant?: 'primary' | 'secondary' | 'destructive';
    type?: 'button' | 'submit';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button {type} class="btn {variant}" {disabled} {onclick}>{@render children()}</button>

<style>
  .btn {
    min-height: 56px; min-width: 160px; padding: 0 var(--sp-6);
    border-radius: var(--r-sm); font-size: var(--fs-base); font-weight: 600;
    border: 1px solid transparent; cursor: pointer;
  }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .primary { background: var(--accent-fill); color: #fff; }
  .primary:hover:not(:disabled) { background: var(--accent-fill-hover); }
  .secondary { background: var(--bg-surface); border-color: var(--border-strong); color: var(--text-primary); }
  .secondary:hover:not(:disabled) { background: var(--bg-sunken); }
  .destructive { background: var(--red-600); color: #fff; }
</style>
