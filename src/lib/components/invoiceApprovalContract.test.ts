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
});
