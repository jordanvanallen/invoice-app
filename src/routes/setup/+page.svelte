<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import TextField from '$lib/components/TextField.svelte';
  import BigButton from '$lib/components/BigButton.svelte';
  import RestoreBackup from '$lib/components/RestoreBackup.svelte';
  import { loadSettings, saveSettings } from '$lib/stores/settings';
  import { centsToInput, inputToCents, bpToPercentInput, percentInputToBp } from '$lib/ui/format';
  import { businessFieldErrors, hasNoErrors } from '$lib/validation';
  import type { Settings } from '$lib/types';

  let loaded = $state(false);
  let saving = $state(false);
  let attempted = $state(false);
  let errorMsg = $state('');
  let showRestore = $state(false);

  let inspectorName = $state('');
  let inspectorAddress = $state('');
  let inspectorNumber = $state('');
  let gstHstRegistrationNumber = $state('');
  let billToName = $state('');
  let billToAddress = $state('');
  let paymentEmail = $state('');
  let footerNotes = $state('');
  let taxPercent = $state('13');
  let completedFee = $state('38.00');
  let noshowFee = $state('25.00');

  // Shared validation (identical rules in Settings). Errors show after a save attempt.
  const errs = $derived(businessFieldErrors({
    inspectorName, inspectorAddress, inspectorNumber, gstHstRegistrationNumber,
    taxPercent, completedFee, noshowFee, billToName, billToAddress, paymentEmail, footerNotes,
  }));
  const allValid = $derived(hasNoErrors(errs));
  const show = (msg: string) => (attempted ? msg : '');

  onMount(async () => {
    const s = await loadSettings();
    if (s.inspectorName) inspectorName = s.inspectorName;
    if (s.inspectorAddress) inspectorAddress = s.inspectorAddress;
    if (s.inspectorNumber) inspectorNumber = s.inspectorNumber;
    if (s.gstHstRegistrationNumber) gstHstRegistrationNumber = s.gstHstRegistrationNumber;
    if (s.billToName) billToName = s.billToName;
    if (s.billToAddress) billToAddress = s.billToAddress;
    if (s.paymentEmail) paymentEmail = s.paymentEmail;
    if (s.footerNotes) footerNotes = s.footerNotes;
    taxPercent = bpToPercentInput(s.taxRateBp);
    completedFee = centsToInput(s.defaultCompletedFeeCents);
    noshowFee = centsToInput(s.defaultNoshowFeeCents);
    loaded = true;
  });

  async function finish() {
    attempted = true;
    if (!allValid) return;
    saving = true;
    errorMsg = '';
    try {
      const s: Settings = {
        inspectorName: inspectorName.trim(),
        inspectorAddress: inspectorAddress.trim(),
        inspectorNumber: inspectorNumber.trim(),
        gstHstRegistrationNumber: gstHstRegistrationNumber.replace(/\s/g, '').toUpperCase(),
        billToName: billToName.trim(),
        billToAddress: billToAddress.trim(),
        registered: true,
        taxRateBp: percentInputToBp(taxPercent),
        defaultCompletedFeeCents: inputToCents(completedFee),
        defaultNoshowFeeCents: inputToCents(noshowFee),
        paymentEmail: paymentEmail.trim(),
        footerNotes: footerNotes.trim(),
        logoDataUrl: '',
      };
      await saveSettings(s);
      await goto('/');
    } catch (e) {
      saving = false;
      errorMsg = (e as Error).message;
    }
  }
</script>

<div class="wrap">
  <div class="card">
    <h1>Let's set up your invoices</h1>
    <p class="sub">A few one-time details. They print on every invoice — you can change them later in Settings.</p>

    {#if loaded}
      <section>
        <h2>You / your business</h2>
        <TextField label="Your name" bind:value={inspectorName} warning={show(errs.inspectorName)} />
        <TextField label="Your address" bind:value={inspectorAddress} warning={show(errs.inspectorAddress)} />
        <TextField label="Inspector number" bind:value={inspectorNumber} numeric warning={show(errs.inspectorNumber)} />
      </section>
      <section>
        <h2>Tax</h2>
        <TextField label="GST/HST registration number" bind:value={gstHstRegistrationNumber}
          helper="Format: 123456789RT0001 — it prints on every invoice." warning={show(errs.gstHstRegistrationNumber)} />
        <TextField label="Tax rate (%)" bind:value={taxPercent} numeric inputmode="decimal" warning={show(errs.taxPercent)} />
      </section>
      <section>
        <h2>Default prices</h2>
        <TextField label="Completed inspection ($)" bind:value={completedFee} numeric inputmode="decimal" warning={show(errs.completedFee)} />
        <TextField label="No-show ($)" bind:value={noshowFee} numeric inputmode="decimal" warning={show(errs.noshowFee)} />
      </section>
      <section>
        <h2>Who you bill</h2>
        <TextField label="Bill to (company)" bind:value={billToName} warning={show(errs.billToName)} />
        <TextField label="Their address" bind:value={billToAddress} warning={show(errs.billToAddress)} />
      </section>
      <section>
        <h2>Payment details (printed on the invoice)</h2>
        <TextField label="Payment email" bind:value={paymentEmail} inputmode="text" warning={show(errs.paymentEmail)} />
        <TextField label="Footer note" bind:value={footerNotes}
          helper="e.g. how/where to send payment." warning={show(errs.footerNotes)} />
      </section>

      {#if errorMsg}<p class="err">Couldn't save: {errorMsg}</p>{/if}
      <BigButton onclick={finish} disabled={saving}>
        {saving ? 'Saving…' : 'Save and start my first invoice'}
      </BigButton>
      {#if attempted && !allValid}
        <p class="err">Please complete the highlighted fields above before continuing.</p>
      {:else}
        <p class="hint">All fields are required — they all appear on your invoices.</p>
      {/if}

      <hr class="div" />
      {#if showRestore}
        <section>
          <h2>Restore from a backup</h2>
          <RestoreBackup />
        </section>
      {:else}
        <button class="linkish" onclick={() => (showRestore = true)}>
          Setting up a new computer and have a backup? Restore it instead →
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .wrap { display: grid; place-items: start center; min-height: 100vh; padding: var(--sp-12) var(--sp-4); }
  .card { width: 100%; max-width: 560px; background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: var(--r-lg); box-shadow: var(--shadow-card); padding: var(--sp-8);
    display: flex; flex-direction: column; gap: var(--sp-8); }
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .sub { margin: calc(-1 * var(--sp-6)) 0 0; color: var(--text-secondary); }
  section { display: flex; flex-direction: column; gap: var(--sp-4); }
  h2 { font-size: var(--fs-lg); font-weight: 600; margin: 0; color: var(--accent-strong); }
  .err { color: var(--red-600); margin: 0; }
  .hint { color: var(--text-muted); font-size: var(--fs-sm); margin: 0; }
  .div { border: none; border-top: 1px solid var(--border); margin: 0; }
  .linkish { align-self: flex-start; background: none; border: none; padding: 0; cursor: pointer;
    color: var(--accent-strong); font-size: var(--fs-sm); font-weight: 600; text-align: left; }
  .linkish:hover { text-decoration: underline; }
</style>
