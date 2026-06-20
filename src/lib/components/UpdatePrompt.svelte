<script lang="ts">
  import { onMount } from 'svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { checkForUpdate, installAndRestart, type Update } from '$lib/updater';

  let update = $state<Update | null>(null);
  let installing = $state(false);
  let err = $state('');

  onMount(async () => {
    const result = await checkForUpdate();
    update = result.status === 'available' ? result.update : null;
  });

  async function install() {
    if (!update) return;
    installing = true;
    err = '';
    try {
      await installAndRestart(update);
    } catch (e) {
      err = (e as Error).message;
      installing = false;
    }
  }
</script>

{#if update}
  <ConfirmDialog
    title="Update available"
    confirmLabel={installing ? 'Installing…' : 'Install & restart'}
    confirmDisabled={installing}
    onConfirm={install}
    onCancel={() => (update = null)}
  >
    <p>Version <b>{update.version}</b> is ready. It'll install and the app will restart.</p>
    {#if update.body}<p style="color:var(--text-secondary)">{update.body}</p>{/if}
    {#if err}<p style="color:var(--red-600)">Update failed: {err}</p>{/if}
  </ConfirmDialog>
{/if}
