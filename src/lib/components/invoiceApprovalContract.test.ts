import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('invoice approval component contracts', () => {
  test('combobox raw input updates bound text before one edit notification', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    const handler = source.slice(source.indexOf('function onInput('), source.indexOf('async function commit('));

    expect(source).not.toContain('bind:value={text}');
    expect(handler).toContain('function onInput(event: Event)');
    expect(handler).toContain('applyComboboxInputEdit(');
    expect(handler).toContain('(event.currentTarget as HTMLInputElement).value');
    for (const assignment of [
      'text = next.text;', 'selectedId = next.selectedId;',
      'open = next.open;', 'highlight = next.highlight;',
    ]) expect(handler).toContain(assignment);
    expect(handler.match(/onEdited/g)).toHaveLength(1);
  });

  test('combobox exposes selection and validation semantics', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    for (const contract of [
      'role="combobox"', 'aria-autocomplete="list"', 'aria-expanded={popup.visible}',
      'aria-controls=', 'aria-activedescendant=', 'aria-invalid={invalid}',
      'aria-describedby=', 'aria-required={required}', 'id={inputId}',
      'role="listbox"', 'role="option"',
    ]) expect(source).toContain(contract);
    expect(source).toContain('{#if error}');
  });

  test('combobox popup markup follows the tested popup state', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    for (const contract of [
      'comboboxPopupState({',
      'inputId, open, optionCount: options.length, highlight',
      'aria-expanded={popup.visible}',
      'aria-controls={popup.controlsId}',
      'aria-activedescendant={popup.activeDescendantId}',
      '{#if popup.visible}',
      '<li role="presentation">',
      'aria-selected={popup.activeIndex === i}',
    ]) expect(source).toContain(contract);
    expect(source).not.toContain('{#if open && options.length}');
  });

  test('combobox wires tested keyboard and one-shot Tab blur state', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    const commit = source.slice(source.indexOf('async function commit('), source.indexOf('function onKeydown('));
    const keydown = source.slice(source.indexOf('function onKeydown('), source.indexOf('function onBlur('));
    const blur = source.slice(source.indexOf('function onBlur('), source.indexOf('// Keep the highlighted index'));

    expect(commit).toContain("if (opt.kind === 'entry')");
    expect(commit).toContain('selectedId = result.id;');
    expect(commit).toContain('text = opt.label;');
    expect(commit.match(/onEdited\(\);/g)).toHaveLength(1);
    expect(commit.indexOf('open = false;')).toBeLessThan(commit.indexOf('onEdited();'));
    expect(keydown).toContain('comboboxKeyAction({ open, highlight, optionCount: options.length, pending }, e.key)');
    expect(keydown).toContain('suppressBlurCommit = action.suppressBlurCommit;');
    expect(keydown).toContain('if (action.commitIndex !== null) void commit(options[action.commitIndex]);');
    expect(blur).toContain('comboboxBlurState({');
    expect(blur).toContain('suppressCommit: suppressBlurCommit');
    expect(blur).toContain('suppressBlurCommit = next.suppressBlurCommit;');
    expect(source).toContain('tabindex="-1"');
  });

  test('combobox quick-add is guarded, recoverable, and politely linked', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    const commit = source.slice(source.indexOf('async function commit('), source.indexOf('function onKeydown('));

    expect(commit).toContain('if (pending) return;');
    expect(commit).toContain('pending = true;');
    expect(commit).toContain('await runComboboxAddAction({');
    expect(commit).toContain("if (result.status === 'failed')");
    expect(commit).toContain('open = true;');
    expect(commit).toContain('await tick();');
    expect(commit).toContain('inputEl?.focus();');
    expect(source).toContain('bind:this={inputEl}');
    expect(source).toContain('aria-busy={pending}');
    expect(source).toContain('aria-describedby={describedBy}');
    expect(source).toContain('disabled={pending}');
    expect(source).toContain('id={`${inputId}-status`}');
    expect(source).toContain('role="status" aria-live="polite"');
  });

  test('date picker exposes stable focus and validation hooks', () => {
    const source = readSource('src/lib/components/DatePicker.svelte');
    expect(source).toContain('id={fieldId}');
    expect(source).toContain("${ariaLabel}${required ? ' (required)' : ''}");
    expect(source).toContain('aria-invalid={invalid}');
    expect(source).toContain('aria-describedby={errorId || undefined}');
  });

  test('date picker implements dialog focus, date names, and grid keyboard integration', () => {
    const source = readSource('src/lib/components/DatePicker.svelte');
    for (const contract of [
      "import { tick } from 'svelte';",
      'initialCalendarDate(value)',
      'moveCalendarDateByKey(date, event.key)',
      'calendarDateLabel(dateForDay(day))',
      'async function focusDay()',
      "root?.querySelector<HTMLButtonElement>('.day')",
      'async function closeAndRestoreFocus()',
      'fieldEl?.focus();',
      'function onDialogKeydown(event: KeyboardEvent)',
      "dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex=\"-1\"])')",
      'role="dialog" aria-modal="true"',
      'bind:this={dialogEl} onkeydown={onDialogKeydown}',
      'role="grid"',
      'role="row"',
      'role="gridcell"',
      'aria-selected={isSel(day)}',
      'tabindex={isFocused(day) ? 0 : -1}',
      'onkeydown={(event) => onDayKeydown(event, dateForDay(day))}',
    ]) expect(source).toContain(contract);

    const pick = source.slice(source.indexOf('async function pick('), source.indexOf('// WebKitGTK'));
    expect(pick).toContain('open = false;');
    expect(pick).toContain('onChange();');
    expect(pick).toContain('await tick();');
    expect(pick).toContain('fieldEl?.focus();');
    expect(source).toContain("if (event.key === 'Escape' && open)");
    expect(source).toContain('void closeAndRestoreFocus();');
    expect(source).toContain('.days { display: flex; flex-direction: column; gap: 2px; }');
    expect(source).toContain('.week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }');
    expect(source).not.toContain('.week { display: contents; }');
  });

  test('invoice sections render responsive row-local mileage approval disclosures', () => {
    const section = readSource('src/lib/components/InvoiceSection.svelte');
    expect(section).toContain('approvers: CatalogEntry[]');
    expect(section).toContain('addApprover: (name: string) => Promise<number>');
    expect(section).toContain('id="mileage-approval-{row.uid}"');
    expect(section).toContain('aria-expanded={!row.approvalCollapsed}');
    expect(section).toContain('aria-controls="mileage-approval-{row.uid}"');
    expect(section).toContain('inputId={`mileage-approver-${row.uid}`}');
    expect(section).toContain('fieldId={`mileage-approval-date-${row.uid}`}');
    expect(section).toContain('id={`inspection-number-${row.uid}`}');
    expect(section).toContain('inputId={`client-${row.uid}`}');
    expect(section).toContain('inputId={`location-${row.uid}`}');
    expect(section).toContain('fieldId={`inspection-date-${row.uid}`}');
    expect(section).toContain('id={`vin8-${row.uid}`}');
    expect(section).toContain('grid-column: 1 / -1');
    expect(section).toContain('container-type: inline-size');
    expect(section).toContain('overflow: visible');
    expect(section).toContain('.card:focus-within { position: relative; z-index: 30; }');
  });

  test('invoice sections preserve deterministic mileage disclosure transitions', () => {
    const section = readSource('src/lib/components/InvoiceSection.svelte');
    const inputHandlers = section.slice(
      section.indexOf('function onFee('),
      section.indexOf('function blurFee('),
    );

    expect(section).not.toContain('bind:value={row.mileageText}');
    expect(section).not.toContain('bind:value={row.feeText}');
    expect(inputHandlers).toContain('function onFee(i: number, event: Event)');
    expect(inputHandlers).toContain('function onMileage(i: number, event: Event)');
    expect(inputHandlers.match(/\(event\.currentTarget as HTMLInputElement\)\.value/g)).toHaveLength(2);
    expect(inputHandlers).toContain('row.feeText = next.text;');
    expect(inputHandlers).toContain('row.feeCents = next.cents;');
    expect(inputHandlers).toContain('row.mileageText = next.text;');
    expect(inputHandlers).toContain('row.mileageCents = next.cents;');
    expect(inputHandlers).toContain('if (next.becamePositive)');
    expect(inputHandlers).toContain('row.approvalCollapsed = false;');
    expect(inputHandlers).not.toContain('.focus(');
    expect(section).toContain('value={row.mileageText} oninput={(event) => onMileage(i, event)}');
    expect(section).toContain('value={row.feeText} oninput={(event) => onFee(i, event)}');
    expect(section).toContain('canonicalInvoiceMoneyInput(rows[i].feeCents)');
    expect(section).toContain('canonicalInvoiceMoneyInput(rows[i].mileageCents, true)');
    expect(section).toContain('hasCompleteMileageApproval(row)');
    expect(section).toContain('mileageApprovalText(row)');
    expect(section).toContain('const approvalExpanded = !approvalComplete || !row.approvalCollapsed');
    expect(section).toContain('{#if approvalComplete}');
    expect(section).toContain('<div class="approval-panel" id="mileage-approval-{row.uid}">');
    expect(section).toContain('{#if approvalExpanded}');
    expect(section).toContain('onEdited={() => (row.approvalCollapsed = false)}');
    expect(section).toContain('onChange={() => (row.approvalCollapsed = false)}');
  });

  test('invoice route wires catalogs, blockers, focus, and preview through both sections', () => {
    const route = readSource('src/routes/+page.svelte');
    expect(route.match(/<InvoiceSection/g)).toHaveLength(2);
    expect(route).toContain('{approvers} {addApprover}');
    expect(route).toContain('invoiceFinalizeBlockers(buildDraft())');
    expect(route).toContain('mileage-approver-${uid}');
    expect(route).toContain('mileage-approval-date-${uid}');
    expect(route).toContain('<InvoiceView snap={previewSnap} preview />');
  });

  test('invoice view prints row-local approval evidence and preview-only missing approval copy', () => {
    const view = readSource('src/lib/components/InvoiceView.svelte');

    expect(view).toContain("import { hasCompleteMileageApproval, mileageApprovalText } from '$lib/mileageApproval';");
    expect(view).toContain('let { snap, preview = false }');
    expect(view).toContain('{@const columnCount = mileage ? 8 : 7}');
    expect(view).toContain('{@const approvalText = !preview || hasCompleteMileageApproval(l)');
    expect(view).toContain('? mileageApprovalText(l)');
    expect(view).toContain(': null}');
    expect(view).toContain('{#if approvalText || (preview && l.mileageCents > 0)}');
    expect(view).toContain('<tr class="mileage-approval">');
    expect(view).toContain('<td colspan={columnCount}>');
    expect(view).toContain("{approvalText ?? 'Mileage approval required'}");
    expect(view).toMatch(
      /<\/tr>\s*{@const approvalText = !preview \|\| hasCompleteMileageApproval\(l\)[\s\S]*?{#if approvalText \|\| \(preview && l\.mileageCents > 0\)}\s*<tr class="mileage-approval">/,
    );
  });

  test('invoice route uses the declared preview prop without the temporary type bridge', () => {
    const route = readSource('src/routes/+page.svelte');

    expect(route).toContain("import InvoiceView from '$lib/components/InvoiceView.svelte';");
    expect(route).not.toContain('InvoiceViewBase');
    expect(route).not.toContain('type Component');
    expect(route).not.toContain('Task 8 consumes this route-level preview flag');
  });

  test('invoice route derives row counts and focus targets from shared blockers', () => {
    const route = readSource('src/routes/+page.svelte');
    const jumpHandler = route.slice(
      route.indexOf('async function jumpToBlocker()'),
      route.indexOf('async function doFinalize()'),
    );

    expect(route).toContain('const finalizeBlockers = $derived(invoiceFinalizeBlockers(buildDraft()));');
    expect(route).toContain('const blockedLineIndices = $derived(new Set(');
    expect(route).toContain('const blockerCount = $derived(blockedLineIndices.size);');
    expect(route).toContain("const canFinalize = $derived(finalizeBlockers.length === 0 && seqState.status === 'ready');");
    expect(route).toContain("inspectionNumber: (uid) => `inspection-number-${uid}`");
    expect(route).toContain("client: (uid) => `client-${uid}`");
    expect(route).toContain("location: (uid) => `location-${uid}`");
    expect(route).toContain("date: (uid) => `inspection-date-${uid}`");
    expect(route).toContain("vin8: (uid) => `vin8-${uid}`");
    expect(route).toContain("mileageApprover: (uid) => `mileage-approver-${uid}`");
    expect(route).toContain("mileageApprovalDate: (uid) => `mileage-approval-date-${uid}`");
    expect(jumpHandler).toContain('row.approvalCollapsed = false;');
    expect(jumpHandler).toContain('await tick();');
    expect(jumpHandler).toContain('const targetId = blockerFocusIds[blocker.field]?.(row.uid);');
    expect(jumpHandler).toContain('document.getElementById(targetId)?.focus();');
    expect(jumpHandler).not.toContain("querySelector('input')");
  });
});
