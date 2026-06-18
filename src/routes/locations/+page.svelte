<script lang="ts">
  import CatalogManager from '$lib/components/CatalogManager.svelte';
</script>

<CatalogManager
  table="locations"
  title="Locations"
  helper="The places you do inspections."
  addLabel="Add a location (e.g. Springvale)"
  examples="Springvale, Lakeside, Fairview, Glenwood" />
