import { describe, expect, test } from 'vitest';
import { sortInvoiceSections } from '../lineOrder';
import { prepareInvoicePreview } from './preview';

type PreviewRow = {
  id: string;
  date: string;
  inspectionNumber: string;
};

describe('prepareInvoicePreview', () => {
  test('builds the snapshot after retaining the sorted editor rows', () => {
    let completed: PreviewRow[] = [
      { id: 'completed-10', date: '2026-07-14', inspectionNumber: '10' },
      { id: 'completed-old', date: '2026-07-10', inspectionNumber: '99' },
      { id: 'completed-2', date: '2026-07-14', inspectionNumber: '2' },
    ];
    let noshow: PreviewRow[] = [
      { id: 'noshow-new', date: '2026-07-13', inspectionNumber: '2' },
      { id: 'noshow-old', date: '2026-07-09', inspectionNumber: '1' },
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
      completed: ['completed-old', 'completed-2', 'completed-10'],
      noshow: ['noshow-old', 'noshow-new'],
    });
    expect(completed.map((row) => row.id)).toEqual(snapshot.completed);
    expect(noshow.map((row) => row.id)).toEqual(snapshot.noshow);
  });
});
