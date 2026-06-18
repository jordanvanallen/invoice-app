<script lang="ts">
  import '@fontsource/inter/400.css';
  import '@fontsource/inter/600.css';
  import '@fontsource/inter/700.css';
  import '@fontsource/inter/800.css';
  import '../app.css';
  import { getDb } from '$lib/db';
  import AppShell from '$lib/components/AppShell.svelte';
  import GlobalToast from '$lib/components/GlobalToast.svelte';
  import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
  import { loadSettings, isFirstRun } from '$lib/stores/settings';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  let { children } = $props();

  async function init() {
    await getDb();
    const s = await loadSettings();
    const onSetup = $page.url.pathname === '/setup';
    if (isFirstRun(s) && !onSetup) await goto('/setup');
    else if (!isFirstRun(s) && onSetup) await goto('/');
  }
  const ready = init();

  const isSetup = $derived($page.url.pathname === '/setup');
</script>

{#await ready}
  <div style="display:grid;place-items:center;min-height:100vh;color:var(--text-secondary)">
    Starting up…
  </div>
{:then}
  {#if isSetup}
    {@render children()}
  {:else}
    <AppShell>{@render children()}</AppShell>
  {/if}
{:catch err}
  <div style="display:grid;place-items:center;min-height:100vh;padding:var(--sp-8);text-align:center">
    <div>
      <h1 style="color:var(--red-600)">Couldn't open your data</h1>
      <p style="color:var(--text-secondary)">{err.message}</p>
    </div>
  </div>
{/await}

<GlobalToast />
<UpdatePrompt />
