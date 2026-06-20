<script lang="ts">
  import { onMount } from 'svelte';
  import TextField from '$lib/components/TextField.svelte';
  import BigButton from '$lib/components/BigButton.svelte';
  import SaveStatusChip from '$lib/components/SaveStatusChip.svelte';
  import { loadSettings, saveSettings } from '$lib/stores/settings';
  import { centsToInput, inputToCents, bpToPercentInput, percentInputToBp } from '$lib/ui/format';
  import { businessFieldErrors, hasNoErrors } from '$lib/validation';
  import { getTheme, applyTheme, getTextSize, applyTextSize, type Theme, type TextSize } from '$lib/ui/theme';
  import { getInvoiceFolder, setInvoiceFolder } from '$lib/stores/prefs';
  import { openPdfPath } from '$lib/pdf/generate';
  import { checkForUpdate, installAndRestart } from '$lib/updater';
  import { open } from '@tauri-apps/plugin-dialog';
  import { getVersion } from '@tauri-apps/api/app';
  import type { Settings } from '$lib/types';

  let loaded = $state(false);
  let theme = $state<Theme>('dark');
  let textSize = $state<TextSize>('normal');
  let invoiceFolder = $state('');

  function markSaved() {
    saveState = 'saved';
    savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    errorMsg = '';
  }
  function setTheme(t: Theme) { theme = t; applyTheme(t); markSaved(); }
  function setSize(s: TextSize) { textSize = s; applyTextSize(s); markSaved(); }

  async function chooseInvoiceFolder() {
    const picked = await open({ directory: true, title: 'Choose where to save invoice PDFs' });
    if (typeof picked === 'string') { setInvoiceFolder(picked); invoiceFolder = picked; markSaved(); }
  }
  function useDownloadsInvoice() { setInvoiceFolder(''); invoiceFolder = ''; markSaved(); }

  let appVersion = $state('');
  let updateMsg = $state('');
  async function checkUpdates() {
    updateMsg = 'Checking…';
    const u = await checkForUpdate();
    if (!u) { updateMsg = "You're on the latest version."; return; }
    updateMsg = `Installing version ${u.version}…`;
    try { await installAndRestart(u); } catch (e) { updateMsg = `Update failed: ${(e as Error).message}`; }
  }
  async function openInvoiceFolder() {
    const { downloadDir } = await import('@tauri-apps/api/path');
    await openPdfPath(invoiceFolder || (await downloadDir()));
  }
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let savedAt = $state('');
  let errorMsg = $state('');

  let inspectorName = $state('');
  let inspectorAddress = $state('');
  let inspectorNumber = $state('');
  let gstHstRegistrationNumber = $state('');
  let billToName = $state('');
  let billToAddress = $state('');
  let registered = $state(true);
  let taxPercent = $state('13');
  let completedFee = $state('38.00');
  let noshowFee = $state('25.00');
  let paymentEmail = $state('');
  let footerNotes = $state('');
  let logoDataUrl = $state('');

  /** Read a chosen image, downscale to <=320px wide, store as a PNG data URL
   *  (kept small so it travels in the DB/backups and every invoice snapshot). */
  function onLogoFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 320 / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        logoDataUrl = canvas.toDataURL('image/png');
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  function removeLogo() { logoDataUrl = ''; }

  // Same validation as the first-run wizard, so required fields can't be blanked
  // or mistyped here either. Errors show only after a save attempt.
  let attempted = $state(false);
  const errs = $derived(businessFieldErrors({
    inspectorName, inspectorAddress, inspectorNumber, gstHstRegistrationNumber,
    taxPercent, completedFee, noshowFee, billToName, billToAddress, paymentEmail, footerNotes,
  }));
  const allValid = $derived(hasNoErrors(errs));
  const show = (msg: string) => (attempted ? msg : '');

  onMount(async () => {
    theme = getTheme();
    textSize = getTextSize();
    invoiceFolder = getInvoiceFolder();
    try { appVersion = await getVersion(); } catch { /* not in Tauri */ }
    const s = await loadSettings();
    inspectorName = s.inspectorName;
    inspectorAddress = s.inspectorAddress;
    inspectorNumber = s.inspectorNumber;
    gstHstRegistrationNumber = s.gstHstRegistrationNumber;
    billToName = s.billToName;
    billToAddress = s.billToAddress;
    registered = s.registered;
    taxPercent = bpToPercentInput(s.taxRateBp);
    completedFee = centsToInput(s.defaultCompletedFeeCents);
    noshowFee = centsToInput(s.defaultNoshowFeeCents);
    paymentEmail = s.paymentEmail;
    footerNotes = s.footerNotes;
    logoDataUrl = s.logoDataUrl;
    loaded = true;
  });

  async function save() {
    attempted = true;
    if (!allValid) { saveState = 'idle'; return; }
    saveState = 'saving';
    errorMsg = '';
    try {
      const s: Settings = {
        inspectorName: inspectorName.trim(),
        inspectorAddress: inspectorAddress.trim(),
        inspectorNumber: inspectorNumber.trim(),
        gstHstRegistrationNumber: gstHstRegistrationNumber.replace(/\s/g, '').toUpperCase(),
        billToName: billToName.trim(),
        billToAddress: billToAddress.trim(),
        registered,
        taxRateBp: percentInputToBp(taxPercent),
        defaultCompletedFeeCents: inputToCents(completedFee),
        defaultNoshowFeeCents: inputToCents(noshowFee),
        paymentEmail: paymentEmail.trim(),
        footerNotes: footerNotes.trim(),
        logoDataUrl,
      };
      await saveSettings(s);
      markSaved();
    } catch (e) {
      saveState = 'error';
      errorMsg = (e as Error).message;
    }
  }
</script>

<div class="head">
  <h1>Settings</h1>
  <SaveStatusChip state={saveState} {savedAt} />
</div>

{#if !loaded}
  <p style="color:var(--text-secondary)">Loading…</p>
{:else}
  <div class="form">
    <section>
      <h2>Display</h2>
      <div class="seg-label">Theme</div>
      <div class="seg">
        <button class:on={theme === 'dark'} onclick={() => setTheme('dark')}>Dark</button>
        <button class:on={theme === 'light'} onclick={() => setTheme('light')}>Light</button>
      </div>
      <div class="seg-label">Text size</div>
      <div class="seg">
        <button class:on={textSize === 'normal'} onclick={() => setSize('normal')}>Normal</button>
        <button class:on={textSize === 'large'} onclick={() => setSize('large')}>Large</button>
        <button class:on={textSize === 'xlarge'} onclick={() => setSize('xlarge')}>Extra-large</button>
      </div>
    </section>

    <section>
      <h2>Where invoices are saved</h2>
      <p class="folder-now">Invoice PDFs save to: <b>{invoiceFolder || 'Downloads (default)'}</b></p>
      <p class="seg-label">Each invoice is filed under a year subfolder (e.g. <b>2026-invoices</b>); tax summaries go in <b>tax-summaries</b>. Tip: point this at something like <b>~/Documents/MyCompany-invoices</b>.</p>
      <div class="seg">
        <button onclick={chooseInvoiceFolder}>Choose folder…</button>
        <button onclick={openInvoiceFolder}>Open this folder</button>
        {#if invoiceFolder}<button onclick={useDownloadsInvoice}>Use Downloads</button>{/if}
      </div>
    </section>

    <section>
      <h2>You / your business</h2>
      <TextField label="Your name" bind:value={inspectorName} warning={show(errs.inspectorName)} />
      <TextField label="Your address" bind:value={inspectorAddress} warning={show(errs.inspectorAddress)} />
      <TextField label="Inspector number" bind:value={inspectorNumber} numeric warning={show(errs.inspectorNumber)} />
    </section>

    <section>
      <h2>Logo (optional)</h2>
      <p class="seg-label">Shown at the top of every invoice. A small PNG/JPG works best; it's stored with your data and included in backups.</p>
      {#if logoDataUrl}<img class="logo-preview" src={logoDataUrl} alt="Your logo" />{/if}
      <div class="seg">
        <label class="filebtn">
          {logoDataUrl ? 'Replace logo…' : 'Choose logo…'}
          <input type="file" accept="image/png,image/jpeg" onchange={onLogoFile} />
        </label>
        {#if logoDataUrl}<button onclick={removeLogo}>Remove</button>{/if}
      </div>
    </section>

    <section>
      <h2>Tax</h2>
      <TextField label="GST/HST registration number" bind:value={gstHstRegistrationNumber}
        helper="Format: 123456789RT0001 — shown on every invoice." warning={show(errs.gstHstRegistrationNumber)} />
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
      <h2>Invoice footer</h2>
      <TextField label="Payment email" bind:value={paymentEmail} warning={show(errs.paymentEmail)} />
      <TextField label="Footer note" bind:value={footerNotes} warning={show(errs.footerNotes)} />
    </section>

    <section>
      <h2>About &amp; updates</h2>
      <p class="folder-now">Version <b>{appVersion || '—'}</b></p>
      <div class="seg"><button onclick={checkUpdates}>Check for updates</button></div>
      {#if updateMsg}<p class="seg-label">{updateMsg}</p>{/if}
    </section>

    {#if errorMsg}<p class="err">Couldn't save: {errorMsg}</p>{/if}
    {#if attempted && !allValid}<p class="err">Please fix the highlighted fields before saving.</p>{/if}
    <div class="save-row">
      <BigButton onclick={save}>Save settings</BigButton>
      <SaveStatusChip state={saveState} {savedAt} />
    </div>
  </div>
{/if}

<style>
  .head { display: flex; align-items: center; gap: var(--sp-4); margin-bottom: var(--sp-6); }
  h1 { font-size: var(--fs-xl); font-weight: 700; margin: 0; }
  .form { display: flex; flex-direction: column; gap: var(--sp-8); max-width: 640px; }
  .save-row { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  section { display: flex; flex-direction: column; gap: var(--sp-4); }
  h2 { font-size: var(--fs-lg); font-weight: 600; margin: 0; color: var(--accent-strong); }
  .err { color: var(--red-600); margin: 0; }
  .seg-label { font-size: var(--fs-sm); font-weight: 600; color: var(--text-secondary); }
  .folder-now { margin: 0; font-size: var(--fs-base); }
  .folder-now b { overflow-wrap: anywhere; }
  .seg { display: inline-flex; gap: var(--sp-2); flex-wrap: wrap; }
  .seg button { min-height: var(--target); padding: 0 var(--sp-4); font-size: var(--fs-base); font-weight: 600;
    border: 1px solid var(--border-strong); background: var(--bg-surface); color: var(--text-primary); border-radius: var(--r-sm); cursor: pointer; }
  .seg button:hover { background: var(--accent-tint); }
  .seg button.on { background: var(--accent-fill); color: var(--on-accent); border-color: var(--accent-fill); }
  .logo-preview { max-width: 220px; max-height: 100px; object-fit: contain; background: #fff;
    border: 1px solid var(--border); border-radius: var(--r-sm); padding: var(--sp-2); }
  .filebtn { display: inline-flex; align-items: center; min-height: var(--target); padding: 0 var(--sp-4);
    border: 1px solid var(--border-strong); background: var(--bg-surface); color: var(--text-primary);
    border-radius: var(--r-sm); font-size: var(--fs-base); font-weight: 600; cursor: pointer; }
  .filebtn:hover { background: var(--accent-tint); }
  .filebtn input { display: none; }
</style>
