import { test, expect, describe } from 'vitest';
import {
  applyComboboxInputEdit,
  comboboxBlurState,
  comboboxKeyAction,
  comboboxOptions,
  comboboxPopupState,
  runComboboxAddAction,
} from './combobox';

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

describe('combobox keyboard and blur state', () => {
  test('Arrow keys open then move the active option without committing', () => {
    const opened = comboboxKeyAction({ open: false, highlight: 0, optionCount: 3, pending: false }, 'ArrowDown');
    expect(opened).toEqual({
      open: true, highlight: 0, commitIndex: null, preventDefault: false, suppressBlurCommit: false,
    });

    expect(comboboxKeyAction({ ...opened, optionCount: 3, pending: false }, 'ArrowDown')).toEqual({
      open: true, highlight: 1, commitIndex: null, preventDefault: true, suppressBlurCommit: false,
    });
    expect(comboboxKeyAction({ open: true, highlight: 1, optionCount: 3, pending: false }, 'ArrowUp')).toEqual({
      open: true, highlight: 0, commitIndex: null, preventDefault: true, suppressBlurCommit: false,
    });
  });

  test('Enter commits only a valid active option and Escape only closes', () => {
    expect(comboboxKeyAction({ open: true, highlight: 1, optionCount: 3, pending: false }, 'Enter')).toEqual({
      open: true, highlight: 1, commitIndex: 1, preventDefault: true, suppressBlurCommit: false,
    });
    expect(comboboxKeyAction({ open: true, highlight: 1, optionCount: 3, pending: false }, 'Escape')).toEqual({
      open: false, highlight: 1, commitIndex: null, preventDefault: false, suppressBlurCommit: false,
    });
  });

  test('pending add ignores repeat Enter activation', () => {
    expect(comboboxKeyAction({ open: true, highlight: 0, optionCount: 1, pending: true }, 'Enter')).toEqual({
      open: true, highlight: 0, commitIndex: null, preventDefault: true, suppressBlurCommit: false,
    });
  });

  test('Tab closes and suppresses exactly one following exact-match blur commit', () => {
    const tab = comboboxKeyAction({ open: true, highlight: 0, optionCount: 1, pending: false }, 'Tab');
    expect(tab).toEqual({
      open: false, highlight: 0, commitIndex: null, preventDefault: false, suppressBlurCommit: true,
    });

    expect(comboboxBlurState({
      selectedId: null,
      text: 'Summit Motors',
      exactMatch: { id: 2, name: 'Summit Motors' },
      suppressCommit: tab.suppressBlurCommit,
    })).toEqual({ selectedId: null, text: 'Summit Motors', open: false, suppressBlurCommit: false });
  });

  test('non-Tab blur retains exact-match binding and non-exact text', () => {
    expect(comboboxBlurState({
      selectedId: null,
      text: 'summit motors',
      exactMatch: { id: 2, name: 'Summit Motors' },
      suppressCommit: false,
    })).toEqual({ selectedId: 2, text: 'Summit Motors', open: false, suppressBlurCommit: false });

    expect(comboboxBlurState({
      selectedId: null,
      text: 'Typed only',
      exactMatch: undefined,
      suppressCommit: false,
    })).toEqual({ selectedId: null, text: 'Typed only', open: false, suppressBlurCommit: false });
  });
});

describe('runComboboxAddAction', () => {
  test('pending add ignores repeat activation without invoking persistence', async () => {
    let calls = 0;
    await expect(runComboboxAddAction({
      pending: true,
      noun: 'approver',
      label: 'Jordan Lee',
      add: async () => { calls += 1; return 7; },
    })).resolves.toEqual({ status: 'ignored' });
    expect(calls).toBe(0);
  });

  test('successful add returns its id and noun-specific polite status', async () => {
    await expect(runComboboxAddAction({
      pending: false,
      noun: 'approver',
      label: 'Jordan Lee',
      add: async () => 7,
    })).resolves.toEqual({
      status: 'added',
      id: 7,
      message: 'Added approver "Jordan Lee".',
    });
  });

  test('rejected add resolves with a noun-specific error instead of escaping', async () => {
    await expect(runComboboxAddAction({
      pending: false,
      noun: 'approver',
      label: 'Jordan Lee',
      add: async () => { throw new Error('database unavailable'); },
    })).resolves.toEqual({
      status: 'failed',
      message: "Couldn't add this approver: database unavailable",
    });
  });
});
