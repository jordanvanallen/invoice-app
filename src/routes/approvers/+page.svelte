<script lang="ts">
  import CatalogManager from '$lib/components/CatalogManager.svelte';
</script>

<CatalogManager
  table="approvers"
  title="Approvers"
  noun="approver"
  helper="People who can approve mileage charges on invoices."
  addLabel="Add an approver (e.g. Jordan Lee)"
  examples="Jordan Lee, Casey Morgan"
/>
