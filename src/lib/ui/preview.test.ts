import { describe, expect, test } from 'vitest';
import { sortInvoiceSections } from '../lineOrder';
import { prepareInvoicePreview } from './preview';

type PreviewRow = {
  id: string;
  date: string;
};

describe('prepareInvoicePreview', () => {
  test('builds the snapshot after retaining the sorted editor rows', () => {
    let completed: PreviewRow[] = [
      { id: 'completed-new', date: '2026-07-14' },
      { id: 'completed-old', date: '2026-07-10' },
    ];
    let noshow: PreviewRow[] = [
      { id: 'noshow-new', date: '2026-07-13' },
      { id: 'noshow-old', date: '2026-07-09' },
    ];

    const snapshot = prepareInvoicePreview({
      sortRows: () => {
        const sorted = sortInvoiceSections(completed, noshow);
        completed = sorted.completed;
        noshow = sorted.noshow;
      },
      buildSnapshot: () => ({
        completed: completed.map((row) => row.id),
        noshow: noshow.map((row) => row.id),
      }),
    });

    expect(snapshot).toEqual({
      completed: ['completed-old', 'completed-new'],
      noshow: ['noshow-old', 'noshow-new'],
    });
    expect(completed.map((row) => row.id)).toEqual(snapshot.completed);
    expect(noshow.map((row) => row.id)).toEqual(snapshot.noshow);
  });
});
