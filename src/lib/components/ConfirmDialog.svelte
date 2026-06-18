<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import BigButton from './BigButton.svelte';

  let {
    title,
    confirmLabel = 'Confirm',
    confirmVariant = 'primary',
    confirmDisabled = false,
    onConfirm,
    onCancel,
    children,
  }: {
    title: string;
    confirmLabel?: string;
    confirmVariant?: 'primary' | 'destructive';
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    children: Snippet;
  } = $props();

  let modalEl = $state<HTMLDivElement | undefined>();

  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    modalEl?.focus();
    return () => prev?.focus?.();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Tab' && modalEl) {
      const f = modalEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="overlay">
  <div class="modal" bind:this={modalEl} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={onKeydown}>
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    <div class="actions">
      <BigButton variant="secondary" onclick={onCancel}>Cancel</BigButton>
      <BigButton variant={confirmVariant} disabled={confirmDisabled} onclick={onConfirm}>{confirmLabel}</BigButton>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(28, 40, 38, .35); display: grid; place-items: center; z-index: 50; padding: var(--sp-4); }
  .modal { background: var(--bg-surface); border-radius: var(--r-lg); box-shadow: var(--shadow-pop);
    width: 100%; max-width: 520px; padding: var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-6); }
  .modal:focus { outline: none; }
  h2 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .body { font-size: var(--fs-base); color: var(--text-primary); }
  .actions { display: flex; justify-content: flex-end; gap: var(--sp-3); }
</style>
