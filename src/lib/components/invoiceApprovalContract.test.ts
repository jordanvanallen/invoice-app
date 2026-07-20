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

  test('combobox retains explicit selection, close, and exact blur paths', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    const commit = source.slice(source.indexOf('async function commit('), source.indexOf('function onKeydown('));
    const keydown = source.slice(source.indexOf('function onKeydown('), source.indexOf('function onBlur('));
    const blur = source.slice(source.indexOf('function onBlur('), source.indexOf('// Keep the highlighted index'));

    expect(commit).toContain("if (opt.kind === 'entry')");
    expect(commit).toContain('const id = await onAddNew(opt.label);');
    expect(commit).toContain('selectedId = id;');
    expect(commit).toContain('text = opt.label;');
    expect(commit.match(/onEdited\(\);/g)).toHaveLength(1);
    expect(commit.indexOf('open = false;')).toBeLessThan(commit.indexOf('onEdited();'));
    expect(keydown.match(/open = false;/g)).toHaveLength(2);
    expect(blur).toContain('if (selectedId === null && result.exactId !== null)');
    expect(blur).toContain('selectedId = result.exactId;');
    expect(blur).toContain('if (m) text = m.name;');
    expect(blur).toContain('open = false;');
  });

  test('date picker exposes stable focus and validation hooks', () => {
    const source = readSource('src/lib/components/DatePicker.svelte');
    expect(source).toContain('id={fieldId}');
    expect(source).toContain("${ariaLabel}${required ? ' (required)' : ''}");
    expect(source).toContain('aria-invalid={invalid}');
    expect(source).toContain('aria-describedby={errorId || undefined}');
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
    expect(section).toContain('grid-column: 1 / -1');
    expect(section).toContain('container-type: inline-size');
    expect(section).toContain('overflow: visible');
    expect(section).toContain('.card:focus-within { position: relative; z-index: 30; }');
  });

  test('invoice sections preserve deterministic mileage disclosure transitions', () => {
    const section = readSource('src/lib/components/InvoiceSection.svelte');
    const mileageHandler = section.slice(
      section.indexOf('function onMileage('),
      section.indexOf('function blurFee('),
    );

    expect(mileageHandler).toContain('const priorCents = rows[i].mileageCents;');
    expect(mileageHandler).toContain('priorCents <= 0 && row.mileageCents > 0');
    expect(mileageHandler).toContain('row.approvalCollapsed = false;');
    expect(mileageHandler).not.toContain('.focus(');
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
    expect(route).toContain('mileage-approver-${row.uid}');
    expect(route).toContain('mileage-approval-date-${row.uid}');
    expect(route).toContain('<InvoiceView snap={previewSnap} preview />');
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
    expect(jumpHandler).toContain('row.approvalCollapsed = false;');
    expect(jumpHandler).toContain('await tick();');
    expect(jumpHandler).toContain('document.getElementById(`mileage-approver-${row.uid}`)');
    expect(jumpHandler).toContain('document.getElementById(`mileage-approval-date-${row.uid}`)');
    expect(jumpHandler).toContain("el?.querySelector('input')");
  });
});
