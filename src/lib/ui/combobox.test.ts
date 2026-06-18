import { test, expect, describe } from 'vitest';
import { comboboxOptions } from './combobox';

const entries = [
  { id: 1, name: 'Globex Finance Group' },
  { id: 2, name: 'Summit Motors' },
  { id: 3, name: 'Pioneer Motor Finance' },
];

describe('comboboxOptions', () => {
  test('empty query returns all entries, no add row', () => {
    const r = comboboxOptions(entries, '');
    expect(r.options.map((o) => o.kind)).toEqual(['entry', 'entry', 'entry']);
    expect(r.exactId).toBeNull();
  });

  test('substring match is case-insensitive', () => {
    const r = comboboxOptions(entries, 'summit');
    expect(r.options.some((o) => o.kind === 'entry' && o.id === 2)).toBe(true);
  });

  test('non-exact query pins an "add" row first', () => {
    const r = comboboxOptions(entries, 'Zephyr');
    expect(r.options[0]).toEqual({ kind: 'add', label: 'Zephyr' });
    expect(r.exactId).toBeNull();
  });

  test('exact (case-insensitive) match: no add row, exactId set', () => {
    const r = comboboxOptions(entries, 'summit motors');
    expect(r.options.some((o) => o.kind === 'add')).toBe(false);
    expect(r.exactId).toBe(2);
  });

  test('partial match that is also a prefix still offers add when not exact', () => {
    const r = comboboxOptions(entries, 'Pioneer');
    expect(r.options[0]).toEqual({ kind: 'add', label: 'Pioneer' });
    expect(r.options.some((o) => o.kind === 'entry' && o.id === 3)).toBe(true);
  });
});
