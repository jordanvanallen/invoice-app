<script lang="ts">
  import { tick } from 'svelte';
  import {
    applyComboboxInputEdit,
    comboboxBlurState,
    comboboxKeyAction,
    comboboxOptions,
    comboboxPopupState,
    runComboboxAddAction,
    type ComboOption,
  } from '$lib/ui/combobox';

  let {
    label,
    entries = [],
    selectedId = $bindable(null),
    text = $bindable(''),
    noun = 'item',
    onAddNew,
    warning = '',
    inputId = `cb-${Math.random().toString(36).slice(2)}`,
    required = false,
    invalid = false,
    error = '',
    onEdited = () => {},
  }: {
    label: string;
    entries?: { id: number; name: string }[];
    selectedId?: number | null;
    text?: string;
    noun?: string;
    onAddNew: (name: string) => Promise<number>;
    warning?: string;
    inputId?: string;
    required?: boolean;
    invalid?: boolean;
    error?: string;
    onEdited?: () => void;
  } = $props();

  let open = $state(false);
  let highlight = $state(0);
  let inputEl = $state<HTMLInputElement>();
  let suppressBlurCommit = $state(false);
  let pending = $state(false);
  let status = $state('');
  let statusError = $state(false);

  const result = $derived(comboboxOptions(entries, text));
  const options = $derived(result.options);
  const popup = $derived(comboboxPopupState({ inputId, open, optionCount: options.length, highlight }));
  const unlinked = $derived(selectedId === null && text.trim() !== '');
  const describedBy = $derived([
    error ? `${inputId}-error` : '',
    status ? `${inputId}-status` : '',
  ].filter(Boolean).join(' ') || undefined);

  function onInput(event: Event) {
    applyComboboxInputEdit(
      (event.currentTarget as HTMLInputElement).value,
      (next) => {
        text = next.text;
        selectedId = next.selectedId;
        open = next.open;
        highlight = next.highlight;
      },
      onEdited,
    );
    suppressBlurCommit = false;
    status = '';
    statusError = false;
  }

  async function commit(opt: ComboOption) {
    if (pending) return;
    if (opt.kind === 'entry') {
      selectedId = opt.id ?? null;
      text = opt.label;
      status = '';
      statusError = false;
    } else {
      pending = true;
      status = `Adding ${noun} "${opt.label}"…`;
      statusError = false;
      const result = await runComboboxAddAction({
        pending: false,
        noun,
        label: opt.label,
        add: onAddNew,
      });
      pending = false;
      if (result.status === 'ignored') return;
      if (result.status === 'failed') {
        status = result.message;
        statusError = true;
        open = true;
        await tick();
        inputEl?.focus();
        return;
      }
      selectedId = result.id;
      text = opt.label;
      status = result.message;
    }
    open = false;
    onEdited();
  }

  function onKeydown(e: KeyboardEvent) {
    const action = comboboxKeyAction({ open, highlight, optionCount: options.length, pending }, e.key);
    open = action.open;
    highlight = action.highlight;
    suppressBlurCommit = action.suppressBlurCommit;
    if (action.preventDefault) e.preventDefault();
    if (action.commitIndex !== null) void commit(options[action.commitIndex]);
  }

  function onBlur() {
    const next = comboboxBlurState({
      selectedId,
      text,
      exactMatch: result.exactId === null
        ? undefined
        : entries.find((entry) => entry.id === result.exactId),
      suppressCommit: suppressBlurCommit,
    });
    selectedId = next.selectedId;
    text = next.text;
    open = next.open;
    suppressBlurCommit = next.suppressBlurCommit;
  }

  // Keep the highlighted index valid as the option list changes under typing.
  $effect(() => {
    if (highlight > options.length - 1) highlight = Math.max(0, options.length - 1);
  });
</script>

<div class="field">
  {#if label}<label for={inputId}>{label}</label>{/if}
  <div class="control">
    <input
      id={inputId}
      type="text"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={popup.visible}
      aria-controls={popup.controlsId}
      aria-activedescendant={popup.activeDescendantId}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      aria-required={required}
      aria-busy={pending}
      value={text}
      bind:this={inputEl}
      class:linked={selectedId !== null}
      class:warn={!!error || !!warning || unlinked}
      oninput={onInput}
      onfocus={() => (open = true)}
      onkeydown={onKeydown}
      onblur={onBlur}
    />
    {#if unlinked}<span class="dot" title="Not in your list yet"></span>{/if}
    {#if popup.visible}
      <ul id={`${inputId}-listbox`} class="menu" role="listbox">
        {#each options as opt, i}
          <li role="presentation">
            <button
              id={`${inputId}-option-${i}`}
              type="button"
              tabindex="-1"
              role="option"
              aria-selected={popup.activeIndex === i}
              disabled={pending}
              class:hi={i === highlight}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => commit(opt)}
            >
              {#if opt.kind === 'add'}
                <span class="add">+ Add “{opt.label}” as new {noun}</span>
              {:else}
                {opt.label}
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if error}
    <p id={`${inputId}-error`} class="warn-text">{error}</p>
  {:else if warning}
    <p class="warn-text">{warning}</p>
  {:else if unlinked}
    <p class="warn-text">Not in your list yet — it'll print exactly as typed.</p>
  {/if}
  <p
    id={`${inputId}-status`}
    class="status-text"
    class:error={statusError}
    class:visible={status !== ''}
    role="status" aria-live="polite"
  >{status}</p>
</div>

<style>
  .field { display: flex; flex-direction: column; gap: var(--sp-2); }
  label { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); }
  .control { position: relative; }
  input {
    width: 100%; height: var(--input-h); padding: 0 14px; font-size: var(--fs-base);
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); color: var(--text-primary);
  }
  input.linked { font-weight: 600; }
  input.warn { border-color: var(--amber-600); border-left-width: 3px; }
  .dot { position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    width: 10px; height: 10px; border-radius: 50%; background: var(--amber-600); }
  .menu { position: absolute; z-index: 20; left: 0; right: 0; top: calc(var(--input-h) + 4px);
    margin: 0; padding: var(--sp-1); list-style: none; max-height: 280px; overflow: auto;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-pop); }
  .menu button {
    display: block; width: 100%; text-align: left; min-height: 48px; padding: 0 var(--sp-3);
    border: none; background: transparent; font-size: var(--fs-base); color: var(--text-primary);
    border-radius: var(--r-sm); cursor: pointer;
  }
  .menu button.hi, .menu button:hover { background: var(--accent-tint); }
  .add { color: var(--accent-strong); font-weight: 600; }
  .warn-text { margin: 0; font-size: var(--fs-sm); color: var(--amber-600); }
  .status-text { margin: 0; font-size: var(--fs-sm); color: var(--green-600); }
  .status-text.error { color: var(--red-600); }
  .status-text:not(.visible) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
