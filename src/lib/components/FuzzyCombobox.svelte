<script lang="ts">
  import { comboboxOptions, type ComboOption } from '$lib/ui/combobox';

  let {
    label,
    entries = [],
    selectedId = $bindable(null),
    text = $bindable(''),
    noun = 'item',
    onAddNew,
    warning = '',
  }: {
    label: string;
    entries?: { id: number; name: string }[];
    selectedId?: number | null;
    text?: string;
    noun?: string;
    onAddNew: (name: string) => Promise<number>;
    warning?: string;
  } = $props();

  let open = $state(false);
  let highlight = $state(0);

  const result = $derived(comboboxOptions(entries, text));
  const options = $derived(result.options);
  const unlinked = $derived(selectedId === null && text.trim() !== '');
  const fieldId = `cb-${Math.random().toString(36).slice(2)}`;

  function onInput() {
    open = true;
    selectedId = null; // unlinked until a row is committed
    highlight = 0;
  }

  async function commit(opt: ComboOption) {
    if (opt.kind === 'entry') {
      selectedId = opt.id ?? null;
      text = opt.label;
    } else {
      const id = await onAddNew(opt.label);
      selectedId = id;
      text = opt.label;
    }
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      open = true;
      return;
    }
    if (e.key === 'ArrowDown') {
      highlight = Math.min(highlight + 1, options.length - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      highlight = Math.max(0, highlight - 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (open && options[highlight]) {
        commit(options[highlight]);
        e.preventDefault();
      }
    } else if (e.key === 'Tab') {
      // Leave the field WITHOUT committing a highlighted option — Tab must never
      // silently create a new entry or pick a fuzzy guess. blur binds only an exact match.
      open = false;
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function onBlur() {
    // Never silently pick the WRONG entry: only auto-bind on an EXACT name match.
    if (selectedId === null && result.exactId !== null) {
      selectedId = result.exactId;
      const m = entries.find((x) => x.id === result.exactId);
      if (m) text = m.name;
    }
    open = false;
  }

  // Keep the highlighted index valid as the option list changes under typing.
  $effect(() => {
    if (highlight > options.length - 1) highlight = Math.max(0, options.length - 1);
  });
</script>

<div class="field">
  {#if label}<label for={fieldId}>{label}</label>{/if}
  <div class="control">
    <input
      id={fieldId}
      type="text"
      autocomplete="off"
      bind:value={text}
      class:linked={selectedId !== null}
      class:warn={!!warning || unlinked}
      oninput={onInput}
      onfocus={() => (open = true)}
      onkeydown={onKeydown}
      onblur={onBlur}
    />
    {#if unlinked}<span class="dot" title="Not in your list yet"></span>{/if}
    {#if open && options.length}
      <ul class="menu" role="listbox">
        {#each options as opt, i}
          <li>
            <button
              type="button"
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
  {#if warning}
    <p class="warn-text">{warning}</p>
  {:else if unlinked}
    <p class="warn-text">Not in your list yet — it'll print exactly as typed.</p>
  {/if}
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
</style>
