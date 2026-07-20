import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('invoice approval component contracts', () => {
  test('combobox exposes selection and validation semantics', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    for (const contract of [
      'role="combobox"', 'aria-autocomplete="list"', 'aria-expanded={open}',
      'aria-controls=', 'aria-activedescendant=', 'aria-invalid={invalid}',
      'aria-describedby=', 'aria-required={required}', 'id={inputId}',
      'role="listbox"', 'role="option"',
    ]) expect(source).toContain(contract);
    expect(source).toContain('{#if error}');
  });

  test('date picker exposes stable focus and validation hooks', () => {
    const source = readSource('src/lib/components/DatePicker.svelte');
    expect(source).toContain('id={fieldId}');
    expect(source).toContain("${ariaLabel}${required ? ' (required)' : ''}");
    expect(source).toContain('aria-invalid={invalid}');
    expect(source).toContain('aria-describedby={errorId || undefined}');
  });
});
