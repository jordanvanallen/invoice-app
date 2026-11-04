<script lang="ts">
  import { formatKm, formatOdometerInput } from '$lib/mileage/odometer';
  import type { MileageSnapshot } from '$lib/mileage/types';

  let { snap }: { snap: MileageSnapshot } = $props();
</script>

<article class="sheet">
  <header class="top">
    <div>
      {#if snap.logoDataUrl}<img class="logo" src={snap.logoDataUrl} alt="" />{/if}
      <div class="title">CAR MILEAGE REPORT</div>
    </div>
    <div class="meta">
      <div class="number">#{snap.reportNumber}</div>
      <div class="muted">Report date {snap.reportDate}</div>
      <div class="muted">Period {snap.periodStart} - {snap.periodEnd}</div>
    </div>
  </header>

  <div class="identity">
    <div>
      <div class="label">Prepared by</div>
      <div class="strong">{snap.inspectorName}</div>
      <div>{snap.inspectorAddress}</div>
      <div>Inspector # {snap.inspectorNumber}</div>
    </div>
    <div>
      <div class="label">Vehicle</div>
      <div class="strong">{snap.vehicle}</div>
      <div class="muted">{snap.trips.length} {snap.trips.length === 1 ? 'trip' : 'trips'}</div>
    </div>
  </div>

  <!-- A horizontally scrollable region must be reachable from the keyboard. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="table-wrap" role="region" aria-label="Trips" tabindex="0">
    <table>
      <thead>
        <tr>
          <th>Date</th><th>From</th><th>To</th><th>Purpose</th>
          <th class="right">Start (km)</th><th class="right">End (km)</th><th class="right">Distance</th>
        </tr>
      </thead>
      <tbody>
        {#each snap.trips as trip}
          <tr>
            <td class="date tnum">{trip.date}</td>
            <td>{trip.from}</td>
            <td>{trip.to}</td>
            <td>{trip.purpose}</td>
            <td class="right tnum">{formatOdometerInput(trip.startOdometerKm)}</td>
            <td class="right tnum">{formatOdometerInput(trip.endOdometerKm)}</td>
            <td class="right tnum">{formatKm(trip.distanceKm)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="total">
    <span>TOTAL DISTANCE</span><span class="tnum">{formatKm(snap.totalKm)}</span>
  </div>
</article>

<style>
  .sheet { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    box-shadow: var(--shadow-card); padding: var(--sp-8); max-width: 1040px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
  .logo { max-width: 200px; max-height: 72px; object-fit: contain; display: block; margin-bottom: var(--sp-2); }
  .title { font-size: var(--fs-2xl); font-weight: 800; color: var(--accent-strong); letter-spacing: 1px; }
  .meta { text-align: right; }
  .number { font-size: var(--fs-lg); font-weight: 700; }
  .muted { color: var(--text-secondary); font-size: var(--fs-sm); }
  .identity { display: flex; flex-wrap: wrap; gap: var(--sp-4) var(--sp-12); margin: var(--sp-6) 0; }
  .label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px;
    color: var(--accent-strong); font-weight: 700; margin-bottom: var(--sp-1); }
  .strong { font-weight: 700; }
  .table-wrap { overflow-x: auto; }
  .table-wrap:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--sp-3); border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px; color: var(--text-secondary); white-space: nowrap; }
  .date { width: 130px; white-space: nowrap; }
  .right { text-align: right; white-space: nowrap; }
  .total { margin: var(--sp-6) 0 0 auto; max-width: 400px; display: flex; gap: var(--sp-4);
    justify-content: space-between; align-items: center; padding: var(--sp-3) var(--sp-4);
    background: var(--accent-fill); color: var(--on-accent); border-radius: var(--r-md);
    font-size: var(--fs-xl); font-weight: 700; }
  @media (max-width: 700px) {
    .sheet { padding: var(--sp-4); }
    .top { flex-direction: column; }
    .meta { text-align: left; }
    th, td { padding: var(--sp-2); }
    .date { width: auto; }
  }
</style>
