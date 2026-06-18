<script lang="ts">
  let {
    label,
    value = $bindable(''),
    helper = '',
    warning = '',
    type = 'text',
    placeholder = '',
    inputmode,
    numeric = false,
    onblur,
  }: {
    label: string;
    value?: string;
    helper?: string;
    warning?: string;
    type?: string;
    placeholder?: string;
    inputmode?: 'text' | 'numeric' | 'decimal';
    numeric?: boolean;
    onblur?: (e: FocusEvent) => void;
  } = $props();

  const fieldId = `f-${Math.random().toString(36).slice(2)}`;
</script>

<div class="field">
  <label for={fieldId}>{label}</label>
  <input
    id={fieldId}
    {type}
    {placeholder}
    {inputmode}
    class:tnum={numeric}
    class:warn={!!warning}
    bind:value
    {onblur}
  />
  {#if warning}
    <p class="warn-text">{warning}</p>
  {:else if helper}
    <p class="helper">{helper}</p>
  {/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: var(--sp-2); }
  label { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); }
  input {
    height: var(--input-h); padding: 0 14px; font-size: var(--fs-base);
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-surface); color: var(--text-primary);
  }
  input:hover { border-color: var(--border-strong); }
  input.warn { border-color: var(--amber-600); border-left-width: 3px; }
  .helper { margin: 0; font-size: var(--fs-sm); color: var(--text-muted); }
  .warn-text { margin: 0; font-size: var(--fs-sm); color: var(--amber-600); }
</style>
