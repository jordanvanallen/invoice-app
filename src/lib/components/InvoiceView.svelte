<script lang="ts">
  import StatusPill from './StatusPill.svelte';
  import { formatDollars } from '$lib/money';
  import { hasCompleteMileageApproval, mileageApprovalText } from '$lib/mileageApproval';
  import { bpToPercentInput } from '$lib/ui/format';
  import type { FinalizedSnapshot, LineItem } from '$lib/types';

  let { snap, preview = false }: { snap: FinalizedSnapshot; preview?: boolean } = $props();

  const completed = $derived(snap.lines.filter((l) => l.type === 'completed'));
  const noshow = $derived(snap.lines.filter((l) => l.type === 'noshow'));
  const showMileage = $derived(completed.some((l) => l.mileageCents > 0));
  const noshowMileage = $derived(noshow.some((l) => l.mileageCents > 0));
</script>

<article class="sheet">
  <header class="top">
    <div>
      {#if snap.logoDataUrl}<img class="logo" src={snap.logoDataUrl} alt="" />{/if}
      <div class="title">INVOICE</div>
      <div class="sub">Vehicle Inspection Services</div>
    </div>
    <div class="meta">
      <StatusPill status="finalized" invoiceNumber={snap.invoiceNumber} />
      <div class="muted">Issued {snap.issueDate}</div>
      <div class="muted">Billing {snap.periodStart} – {snap.periodEnd}</div>
    </div>
  </header>

  <div class="parties">
    <div>
      <div class="label">From</div>
      <div class="strong">{snap.inspectorName}</div>
      <div>{snap.inspectorAddress}</div>
      <div>Inspector # {snap.inspectorNumber}</div>
      {#if snap.registered && snap.gstHstRegistrationNumber}<div>GST/HST # {snap.gstHstRegistrationNumber}</div>{/if}
    </div>
    <div>
      <div class="label">Bill to</div>
      <div class="strong">{snap.billToName}</div>
      <div>{snap.billToAddress}</div>
    </div>
  </div>

  {#snippet section(heading: string, rows: LineItem[], mileage: boolean)}
    {@const columnCount = mileage ? 8 : 7}
    <h3>{heading}</h3>
    <table>
      <thead>
        <tr><th>#</th><th>Inspection #</th><th>Client</th><th>Location</th><th>Date</th><th>VIN (last 8)</th>{#if mileage}<th class="r">Mileage</th>{/if}<th class="r">Fee</th></tr>
      </thead>
      <tbody>
        {#each rows as l, i}
          <tr>
            <td>{i + 1}</td><td class="tnum">{l.inspectionNumber}</td><td>{l.clientName}</td>
            <td>{l.location}</td><td>{l.date}</td><td class="tnum">{l.vin8}</td>
            {#if mileage}<td class="r tnum">{l.mileageCents ? formatDollars(l.mileageCents) : ''}</td>{/if}
            <td class="r tnum">{formatDollars(l.feeCents)}</td>
          </tr>
          {@const approvalText = !preview || hasCompleteMileageApproval(l)
            ? mileageApprovalText(l)
            : null}
          {#if approvalText || (preview && l.mileageCents > 0)}
            <tr class="mileage-approval">
              <td colspan={columnCount}>
                {approvalText ?? 'Mileage approval required'}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/snippet}

  {@render section('Completed Inspections', completed, showMileage)}
  {#if noshow.length}{@render section('No-Shows', noshow, noshowMileage)}{/if}

  <div class="totals">
    <div class="line"><span>Completed subtotal</span><span class="tnum">{formatDollars(snap.totals.completedSubtotalCents)}</span></div>
    <div class="line"><span>No-show subtotal</span><span class="tnum">{formatDollars(snap.totals.noshowSubtotalCents)}</span></div>
    <div class="line"><span>Subtotal</span><span class="tnum">{formatDollars(snap.totals.subtotalCents)}</span></div>
    {#if snap.registered}<div class="line"><span>HST {bpToPercentInput(snap.taxRateBp)}%</span><span class="tnum">{formatDollars(snap.totals.taxCents)}</span></div>{/if}
    <div class="grand"><span>TOTAL</span><span class="tnum">{formatDollars(snap.totals.totalCents)}</span></div>
  </div>

  {#if snap.footerNotes || snap.paymentEmail}
    <footer>
      {#if snap.footerNotes}<div class="muted">{snap.footerNotes}</div>{/if}
      {#if snap.paymentEmail}<div class="email">{snap.paymentEmail}</div>{/if}
    </footer>
  {/if}
</article>

<style>
  .sheet { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    box-shadow: var(--shadow-card); padding: var(--sp-8); max-width: 820px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); }
  .logo { max-width: 200px; max-height: 72px; object-fit: contain; display: block; margin-bottom: var(--sp-2); }
  .title { font-size: var(--fs-2xl); font-weight: 800; color: var(--accent-strong); letter-spacing: 1px; }
  .sub { color: var(--text-secondary); }
  .meta { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-1); }
  .muted { color: var(--text-secondary); font-size: var(--fs-sm); }
  .parties { display: flex; gap: var(--sp-8); margin: var(--sp-6) 0; }
  .label { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px; color: var(--accent-strong); font-weight: 700; margin-bottom: var(--sp-1); }
  .strong { font-weight: 700; }
  h3 { font-size: var(--fs-lg); font-weight: 600; color: var(--accent-strong); margin: var(--sp-6) 0 var(--sp-2); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); }
  th { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .4px; color: var(--text-secondary); }
  .mileage-approval td { padding-top: var(--sp-1); color: var(--text-secondary); font-size: var(--fs-xs); font-style: italic; }
  .r { text-align: right; }
  .totals { margin: var(--sp-6) 0 0; margin-left: auto; max-width: 360px; display: flex; flex-direction: column; gap: var(--sp-1); }
  .line { display: flex; justify-content: space-between; color: var(--text-secondary); padding: var(--sp-1) 0; }
  .grand { display: flex; justify-content: space-between; align-items: center; margin-top: var(--sp-2);
    padding: var(--sp-3) var(--sp-4); background: var(--accent-fill); color: #fff; border-radius: var(--r-md); font-size: var(--fs-xl); font-weight: 700; }
  footer { margin-top: var(--sp-8); border-top: 1px solid var(--border); padding-top: var(--sp-3); }
  .email { color: var(--accent-strong); font-weight: 600; }
</style>
