import { describe, expect, test } from 'vitest';
import {
  appendExpenseEditorRow,
  emptyExpenseEditorSections,
  expenseAddButtonId,
  expenseAmountCents,
  expenseBlockingRowCount,
  expenseDraftItems,
  expenseEditorRowUids,
  expenseEditorSections,
  expenseRowFieldId,
  expenseRowWarningsByUid,
  expenseUndoButtonId,
  firstExpenseBlockerTarget,
  moveExpenseEditorRow,
  newExpenseEditorRow,
  prepareExpensePreview,
  removeExpenseEditorRow,
  restoreExpenseEditorRow,
  sortExpenseEditorSections,
  type ExpenseEditorSections,
} from './expenseEditor';
import { orderExpenseItems } from '../expense/order';
import { expenseFinalizeBlockers } from '../expense/validation';
import type { ExpenseDraft, ExpenseItem } from '../expense/types';
import type { Settings } from '../types';

const settings: Settings = {
  inspectorName: 'North Star', inspectorAddress: '1 Main', inspectorNumber: 'ON-7',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: '',
};

const header = {
  seq: 4, year: 2026, reportDate: '2026-07-15', periodStart: '2026-07-01', periodEnd: '2026-07-15',
};

const item = (over: Partial<ExpenseItem> = {}): ExpenseItem => ({
  position: 0, category: 'general', date: '2026-07-10', description: 'Fuel', amountCents: 5_000, ...over,
});

function draftOf(sections: ExpenseEditorSections): ExpenseDraft {
  return { ...header, items: expenseDraftItems(sections) };
}

const describeRows = (sections: ExpenseEditorSections) => ({
  vehicle: sections.vehicle.map((row) => row.description),
  general: sections.general.map((row) => row.description),
});

describe('expense editor sections', () => {
  test('splits saved rows into sections and rebuilds the canonical draft order', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'general', description: 'Ink', amountCents: 1_250 }),
      item({ position: 1, category: 'vehicle', description: 'Fuel', amountCents: 5_000 }),
      item({ position: 2, category: 'general', description: 'Postage', amountCents: 0 }),
    ]);

    expect(describeRows(sections)).toEqual({ vehicle: ['Fuel'], general: ['Ink', 'Postage'] });
    expect(sections.general.map((row) => row.amountText)).toEqual(['12.50', '']);
    expect(expenseDraftItems(sections)).toEqual([
      item({ position: 0, category: 'vehicle', description: 'Fuel', amountCents: 5_000 }),
      item({ position: 1, category: 'general', description: 'Ink', amountCents: 1_250 }),
      item({ position: 2, category: 'general', description: 'Postage', amountCents: 0 }),
    ]);
    expect(expenseEditorRowUids(sections)).toEqual([
      sections.vehicle[0].uid, sections.general[0].uid, sections.general[1].uid,
    ]);
  });

  test('keeps both sections present when the report has no rows', () => {
    const sections = expenseEditorSections([]);
    expect(sections).toEqual({ vehicle: [], general: [] });
    expect(expenseDraftItems(sections)).toEqual([]);
  });

  test('gives every row a uid that is unique across both sections', () => {
    const sections = expenseEditorSections([
      item({ category: 'vehicle' }), item({ category: 'general' }), item({ category: 'vehicle' }),
    ]);
    const added = appendExpenseEditorRow(sections, 'general', newExpenseEditorRow('2026-07-15'));
    const uids = expenseEditorRowUids(added);

    expect(new Set(uids).size).toBe(4);
    expect(uids.every((uid) => /^expense-item-\d+$/.test(uid))).toBe(true);
  });

  test('parses typed dollars to integer cents and treats unparseable text as zero', () => {
    expect(expenseAmountCents('12.5')).toBe(1_250);
    expect(expenseAmountCents('$1,234.56')).toBe(123_456);
    expect(expenseAmountCents('')).toBe(0);
    expect(expenseAmountCents('12.345')).toBe(0);
    expect(expenseAmountCents('abc')).toBe(0);
  });

  test('moves a row to the end of the other section with its uid and contents intact', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'vehicle', description: 'Fuel' }),
      item({ position: 1, category: 'general', description: 'Ink' }),
      item({ position: 2, category: 'general', description: 'Car wash' }),
    ]);
    const carWash = sections.general[1];
    const before = structuredClone(sections);

    const moved = moveExpenseEditorRow(sections, carWash.uid, 'vehicle');

    expect(describeRows(moved)).toEqual({ vehicle: ['Fuel', 'Car wash'], general: ['Ink'] });
    expect(moved.vehicle[1]).toBe(carWash);
    expect(expenseDraftItems(moved).map((row) => `${row.position}:${row.category}:${row.description}`))
      .toEqual(['0:vehicle:Fuel', '1:vehicle:Car wash', '2:general:Ink']);
    expect(sections).toEqual(before);
    expect(moveExpenseEditorRow(moved, carWash.uid, 'vehicle')).toBe(moved);
    expect(moveExpenseEditorRow(moved, 'expense-item-missing', 'general')).toBe(moved);
  });

  test('sends the blocker jump to the same row after it moves between sections', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'vehicle', description: 'Fuel' }),
      item({ position: 1, category: 'general', description: '' }),
    ]);
    const blank = sections.general[0];
    expect(firstExpenseBlockerTarget(draftOf(sections), expenseEditorRowUids(sections))).toEqual({
      id: `${blank.uid}-description`, message: 'Enter a description for General/Admin expense 1.',
    });

    const moved = moveExpenseEditorRow(sections, blank.uid, 'vehicle');

    expect(firstExpenseBlockerTarget(draftOf(moved), expenseEditorRowUids(moved))).toEqual({
      id: `${blank.uid}-description`, message: 'Enter a description for Vehicle expense 2.',
    });
  });

  test('restores a removed row into its own section, even after other rows moved', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'vehicle', description: 'Fuel' }),
      item({ position: 1, category: 'vehicle', description: 'Parking' }),
      item({ position: 2, category: 'vehicle', description: 'Tolls' }),
      item({ position: 3, category: 'general', description: 'Ink' }),
    ]);
    const parking = sections.vehicle[1];

    const result = removeExpenseEditorRow(sections, parking.uid);
    if (!result) throw new Error('expected the row to be removed');
    expect(result.removed).toEqual({ row: parking, category: 'vehicle', index: 1 });
    expect(describeRows(result.sections).vehicle).toEqual(['Fuel', 'Tolls']);

    expect(describeRows(restoreExpenseEditorRow(result.sections, result.removed)))
      .toEqual({ vehicle: ['Fuel', 'Parking', 'Tolls'], general: ['Ink'] });

    const shrunk = moveExpenseEditorRow(
      moveExpenseEditorRow(result.sections, sections.vehicle[0].uid, 'general'),
      sections.vehicle[2].uid,
      'general',
    );
    expect(describeRows(restoreExpenseEditorRow(shrunk, result.removed)))
      .toEqual({ vehicle: ['Parking'], general: ['Ink', 'Fuel', 'Tolls'] });

    expect(restoreExpenseEditorRow(sections, result.removed)).toBe(sections);
    expect(removeExpenseEditorRow(sections, 'expense-item-missing')).toBeNull();
  });

  test('sorts each section by date, then description, without mixing sections or mutating the editor rows', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'vehicle', date: '2026-07-09', description: 'Fuel late' }),
      item({ position: 1, category: 'vehicle', date: '', description: 'Undated' }),
      item({ position: 2, category: 'vehicle', date: '2026-07-02', description: 'Fuel early' }),
      item({ position: 3, category: 'general', date: '2026-07-05', description: 'Postage' }),
      item({ position: 4, category: 'general', date: '2026-07-01', description: 'Phone' }),
      item({ position: 5, category: 'general', date: '2026-07-05', description: 'Ink' }),
    ]);
    const before = structuredClone(sections);

    const sorted = sortExpenseEditorSections(sections);

    expect(describeRows(sorted)).toEqual({
      vehicle: ['Fuel early', 'Fuel late', 'Undated'],
      general: ['Phone', 'Ink', 'Postage'],
    });
    expect(sections).toEqual(before);
    expect(expenseDraftItems(sorted)).toEqual(orderExpenseItems(expenseDraftItems(sections)));
  });
});

describe('expense editor focus targets', () => {
  test('gives each section its own Undo button id that never collides with rows or Add', () => {
    const row = newExpenseEditorRow('2026-05-01');
    const ids = [
      expenseUndoButtonId('vehicle'),
      expenseUndoButtonId('general'),
      expenseAddButtonId('vehicle'),
      expenseAddButtonId('general'),
      ...(['date', 'description', 'amount', 'move'] as const).map((field) => expenseRowFieldId(row.uid, field)),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('expense editor validation helpers', () => {
  test('prepares a sectioned date/description ordered Preview without moving editor rows', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'general', date: '2026-07-10', description: 'Postage', amountCents: 1_250 }),
      item({ position: 1, category: 'vehicle', date: '2026-07-12', description: 'Parking', amountCents: 800 }),
      item({ position: 2, category: 'vehicle', date: '2026-07-02', description: 'Fuel 10', amountCents: 5_000 }),
      item({ position: 3, category: 'vehicle', date: '2026-07-02', description: 'Fuel 2', amountCents: 2_000 }),
    ]);
    const draft = draftOf(sections);

    const preview = prepareExpensePreview(draft, settings, 4);

    expect(preview.items.map((row) => `${row.category}:${row.description}`))
      .toEqual(['vehicle:Fuel 2', 'vehicle:Fuel 10', 'vehicle:Parking', 'general:Postage']);
    expect(preview).toMatchObject({
      vehicleSubtotalCents: 7_800, generalSubtotalCents: 1_250, totalCents: 9_050,
    });
    expect(describeRows(sections)).toEqual({ vehicle: ['Parking', 'Fuel 10', 'Fuel 2'], general: ['Postage'] });
  });

  test('keeps Preview available while targeting an out-of-range row', () => {
    const sections = expenseEditorSections([
      item({ position: 0, date: '2026-07-10', description: 'Parking', amountCents: 1_250 }),
      item({ position: 1, date: '2026-07-16', description: 'Fuel', amountCents: 5_000 }),
    ]);
    const draft = draftOf(sections);
    const uids = expenseEditorRowUids(sections);
    const warnings = expenseRowWarningsByUid(expenseFinalizeBlockers(draft), uids);

    expect(firstExpenseBlockerTarget(draft, uids)).toEqual({
      id: `${sections.general[1].uid}-date`,
      message: 'Date is outside the reporting period',
    });
    expect(warnings.has(uids[0])).toBe(false);
    expect(warnings.get(uids[1])).toEqual(['Date is outside the reporting period']);
    expect(prepareExpensePreview(draft, settings, 4).items.map((row) => row.description))
      .toEqual(['Parking', 'Fuel']);
  });

  test('returns every row blocker in validation order with concise display copy keyed by uid', () => {
    const sections = expenseEditorSections([
      item({ position: 0, category: 'vehicle', date: '2026-06-30', description: '', amountCents: 0 }),
      item({ position: 1, category: 'general', date: '2026-07-16', description: 'Parking', amountCents: 1_250 }),
      item({ position: 2, category: 'general', date: '', description: 'Meals', amountCents: 2_000 }),
      item({ position: 3, category: 'general', date: '2026-07-02', description: 'Ink', amountCents: 300 }),
    ]);
    const uids = expenseEditorRowUids(sections);
    const blockers = expenseFinalizeBlockers(draftOf(sections));
    const warnings = expenseRowWarningsByUid(blockers, uids);

    expect(warnings.get(uids[0])).toEqual([
      'Date is outside the reporting period',
      'Enter a description',
      'Enter an amount greater than $0.00',
    ]);
    expect(warnings.get(uids[1])).toEqual(['Date is outside the reporting period']);
    expect(warnings.get(uids[2])).toEqual(['Choose a date']);
    expect(warnings.has(uids[3])).toBe(false);
    expect(expenseBlockingRowCount(blockers)).toBe(3);
  });

  test('shows a concise warning for a row outside both sections', () => {
    const draft = { ...header, items: [item({ category: 'fuel' as ExpenseItem['category'] })] };

    expect(expenseRowWarningsByUid(expenseFinalizeBlockers(draft), ['expense-item-x'])).toEqual(
      new Map([['expense-item-x', ['Move this row to the Vehicle or General/Admin section']]]),
    );
    expect(firstExpenseBlockerTarget(draft, ['expense-item-x'])).toEqual({
      id: 'expense-item-x-move',
      message: 'Put expense 1 in the Vehicle or General/Admin section.',
    });
  });

  test('points to the first header field, then the first row field, then the Vehicle add button', () => {
    const sections = expenseEditorSections([item({ date: '', description: '', amountCents: 0 })]);
    const uids = expenseEditorRowUids(sections);
    const incomplete = { ...draftOf(sections), reportDate: '', periodStart: '', periodEnd: '' };

    expect(firstExpenseBlockerTarget(incomplete, uids)).toEqual({
      id: 'expense-report-date', message: 'Choose a report date.',
    });
    expect(firstExpenseBlockerTarget(draftOf(sections), uids)).toEqual({
      id: `${uids[0]}-date`, message: 'Choose a date for General/Admin expense 1.',
    });
    expect(firstExpenseBlockerTarget(draftOf(emptyExpenseEditorSections()), [])).toEqual({
      id: 'expense-add-vehicle', message: 'Add at least one expense.',
    });
  });

  test('refuses to resolve a blocker against row ids from a different render', () => {
    const sections = expenseEditorSections([item(), item({ position: 1 })]);

    expect(() => firstExpenseBlockerTarget(draftOf(sections), expenseEditorRowUids(sections).slice(1)))
      .toThrow('Expense rows and their ids are out of sync.');
  });
});
