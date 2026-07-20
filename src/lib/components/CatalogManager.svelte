<script lang="ts">
  import { onMount } from 'svelte';
  import { getDb } from '$lib/db';
  import { listEntries, addEntry, renameEntry, setActive, deleteEntryIfUnused, type CatalogTable, type CatalogEntry } from '$lib/db/catalog-repo';
  import BigButton from './BigButton.svelte';

  interface Props {
    table: CatalogTable;
    title: string;
    noun: string;
    helper: string;
    addLabel: string;
    examples: string;
  }

  let { table, title, noun, helper, addLabel, examples }: Props = $props();

  let loaded = $state(false);
  let entries = $state<CatalogEntry[]>([]);
  let newName = $state('');
  let note = $state('');

  async function refresh() { entries = await listEntries(await getDb(), table); }
  onMount(async () => { await refresh(); loaded = true; });

  async function add() {
    const name = newName.trim();
    if (!name) return;
    const existing = table === 'clients' || table === 'approvers'
      ? entries.find((e) => e.name.toLowerCase() === name.toLowerCase())
      : null;
    try {
      await addEntry(await getDb(), table, name);
      newName = '';
      note = existing ? `"${existing.name}" is already in your list.` : '';
      await refresh();
    } catch (e) {
      note = (e as Error).message;
    }
  }
  async function rename(id: number, name: string) {
    if (!name.trim()) return;
    try {
      await renameEntry(await getDb(), table, id, name.trim());
      note = '';
      await refresh();
    } catch (e) {
      note = (e as Error).message;
      await refresh();
    }
  }
  async function toggle(e: CatalogEntry) {
    await setActive(await getDb(), table, e.id, !e.active);
    await refresh();
  }
  async function del(e: CatalogEntry) {
    const ok = await deleteEntryIfUnused(await getDb(), table, e.id);
    if (!ok) {
      await setActive(await getDb(), table, e.id, false);
      note = `This ${noun} is used on past invoices, so "${e.name}" can't be deleted — it was deactivated and is now hidden from new rows.`;
    } else {
      note = `Deleted ${noun} "${e.name}".`;
    }
    await refresh();
  }
</script>

<h1>{title}</h1>
<p class="helper">{helper}</p>

<div class="add">
  <input aria-label={`Add ${noun}`} placeholder={addLabel} bind:value={newName} onkeydown={(e) => e.key === 'Enter' && add()} />
  <BigButton onclick={add}>Add</BigButton>
</div>

<p class="note" class:visible={note !== ''} role="status" aria-live="polite">{note}</p>

{#if loaded && entries.length === 0}
  <p class="empty">Nothing here yet — add your first one above (e.g. {examples}).</p>
{:else}
  <ul>
    {#each entries as e (e.id)}
      <li class:inactive={!e.active}>
        <input aria-label={`Rename ${noun} ${e.name}`} class="name" value={e.name} onblur={(ev) => rename(e.id, (ev.currentTarget as HTMLInputElement).value)} />
        <button class="toggle" class:on={e.active} onclick={() => toggle(e)}>{e.active ? '● Active' : 'Inactive'}</button>
        <button class="del" onclick={() => del(e)}>Delete</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0 0 var(--sp-1); }
  .helper { color: var(--text-secondary); margin: 0 0 var(--sp-6); }
  .add { display: flex; gap: var(--sp-3); margin-bottom: var(--sp-4); max-width: calc(560px * var(--fs-scale)); }
  .add input { flex: 1; height: var(--input-h); padding: 0 14px; font-size: var(--fs-base); border: 1px solid var(--border); border-radius: var(--r-sm); }
  .note { background: var(--amber-50); color: var(--amber-600); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-sm); max-width: calc(560px * var(--fs-scale)); }
  .note:not(.visible) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .empty { color: var(--text-secondary); }
  ul { list-style: none; margin: 0; padding: 0; max-width: calc(560px * var(--fs-scale)); }
  li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--sp-3); min-height: var(--input-h); border-bottom: 1px solid var(--border); }
  li.inactive .name { color: var(--text-muted); text-decoration: line-through; }
  .name { height: var(--target); padding: 0 12px; font-size: var(--fs-base); border: 1px solid transparent; border-radius: var(--r-sm); background: transparent; }
  .name:hover, .name:focus { border-color: var(--border); background: var(--bg-surface); }
  .toggle, .del { min-height: var(--target); padding: 0 var(--sp-4); white-space: nowrap; border: 1px solid var(--border-strong); background: var(--bg-surface); border-radius: var(--r-sm); font-size: var(--fs-sm); font-weight: 600; cursor: pointer; }
  .toggle { color: var(--text-secondary); }
  .toggle.on { color: var(--green-600); border-color: var(--green-600); }
  .del { color: var(--red-600); border-color: transparent; }
  .del:hover { border-color: var(--red-600); }
</style>
