<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="toast" role="status" aria-live="polite">
  {@render children()}
</div>

<style>
  .toast {
    position: fixed; left: 50%; bottom: var(--sp-8); transform: translateX(-50%);
    display: flex; align-items: center; gap: var(--sp-4); max-width: 92vw; z-index: 60;
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border); box-shadow: var(--shadow-pop);
    border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); font-size: var(--fs-base);
    animation: toast-in .28s cubic-bezier(.2, .8, .2, 1);
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translate(-50%, 20px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
</style>
