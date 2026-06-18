<script lang="ts">
  import CatalogManager from '$lib/components/CatalogManager.svelte';
</script>

<CatalogManager
  table="clients"
  title="Clients"
  helper="The finance companies you inspect for."
  addLabel="Add a client (e.g. Globex Finance Group)"
  examples="Globex Finance, Summit Motors, Northbridge Credit" />
