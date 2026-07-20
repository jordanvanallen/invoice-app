import { test, expect, describe } from 'vitest';
import { applyComboboxInputEdit, comboboxOptions, comboboxPopupState } from './combobox';

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

describe('comboboxPopupState', () => {
  test('closed state exposes no popup targets', () => {
    expect(comboboxPopupState({ inputId: 'client', open: false, optionCount: 2, highlight: 0 }))
      .toEqual({ visible: false, controlsId: undefined, activeDescendantId: undefined, activeIndex: null });
  });

  test('open state with no options exposes no missing popup targets', () => {
    expect(comboboxPopupState({ inputId: 'client', open: true, optionCount: 0, highlight: 0 }))
      .toEqual({ visible: false, controlsId: undefined, activeDescendantId: undefined, activeIndex: null });
  });

  test('visible popup exposes matching listbox and active option ids', () => {
    expect(comboboxPopupState({ inputId: 'client', open: true, optionCount: 3, highlight: 1 }))
      .toEqual({
        visible: true,
        controlsId: 'client-listbox',
        activeDescendantId: 'client-option-1',
        activeIndex: 1,
      });
  });

  test('out-of-range highlight exposes no active option', () => {
    expect(comboboxPopupState({ inputId: 'client', open: true, optionCount: 2, highlight: 2 }))
      .toEqual({
        visible: true,
        controlsId: 'client-listbox',
        activeDescendantId: undefined,
        activeIndex: null,
      });
  });
});

describe('applyComboboxInputEdit', () => {
  test('applies the complete input state before notifying exactly once', () => {
    let state = { text: 'Old', selectedId: 7 as number | null, open: false, highlight: 2 };
    const observed: typeof state[] = [];
    let callbackCount = 0;

    applyComboboxInputEdit(
      'New value',
      (next) => { state = next; },
      () => {
        callbackCount += 1;
        observed.push({ ...state });
      },
    );

    const expected = { text: 'New value', selectedId: null, open: true, highlight: 0 };
    expect(state).toEqual(expected);
    expect(observed).toEqual([expected]);
    expect(callbackCount).toBe(1);
  });
});
