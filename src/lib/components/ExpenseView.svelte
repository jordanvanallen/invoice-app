<script lang="ts">
  import { formatDollars } from '$lib/money';
  import type { ExpenseSnapshot } from '$lib/expense/types';

  let { snap }: { snap: ExpenseSnapshot } = $props();
</script>

<article class="sheet">
  <header class="top">
    <div>
      {#if snap.logoDataUrl}<img class="logo" src={snap.logoDataUrl} alt="" />{/if}
      <div class="title">EXPENSE REPORT</div>
    </div>
    <div class="meta">
      <div class="number">#{snap.reportNumber}</div>
      <div class="muted">Report date {snap.reportDate}</div>
      <div class="muted">Period {snap.periodStart} - {snap.periodEnd}</div>
    </div>
  </header>

  <div class="identity">
    <div class="label">Prepared by</div>
    <div class="strong">{snap.inspectorName}</div>
    <div>{snap.inspectorAddress}</div>
    <div>Inspector # {snap.inspectorNumber}</div>
  </div>

  <table>
    <thead><tr><th>Date</th><th>Description</th><th class="right">Amount</th></tr></thead>
    <tbody>
      {#each snap.items as item}
        <tr>
          <td class="date tnum">{item.date}</td>
          <td>{item.description}</td>
          <td class="right tnum">{formatDollars(item.amountCents)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="total">
    <span>TOTAL</span><span class="tnum">{formatDollars(snap.totalCents)}</span>
  </div>
</article>

<style>
  .sheet { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    box-shadow: var(--shadow-card); padding: var(--sp-8); max-width: 820px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
  .logo { max-width: 200px; max-height: 72px; object-fit: contain; display: block; margin-bottom: var(--sp-2); }
  .title { font-size: var(--fs-2xl); font-weight: 800; color: var(--accent-strong); letter-spacing: 1px; }
  .meta { text-align: right; }
  .number { font-size: var(--fs-lg); font-weight: 700; }
  .muted { color: var(--text-secondary); font-size: var(--fs-sm); }
  .identity { margin: var(--sp-6) 0; }
  .label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px;
    color: var(--accent-strong); font-weight: 700; margin-bottom: var(--sp-1); }
  .strong { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--sp-3); border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px; color: var(--text-secondary); }
  .date { width: 140px; }
  .right { text-align: right; white-space: nowrap; }
  .total { margin: var(--sp-6) 0 0 auto; max-width: 360px; display: flex;
    justify-content: space-between; align-items: center; padding: var(--sp-3) var(--sp-4);
    background: var(--accent-fill); color: #fff; border-radius: var(--r-md);
    font-size: var(--fs-xl); font-weight: 700; }
  @media (max-width: 700px) {
    .sheet { padding: var(--sp-4); }
    .top { flex-direction: column; }
    .meta { text-align: left; }
    th, td { padding: var(--sp-2); }
    .date { width: auto; }
  }
</style>
