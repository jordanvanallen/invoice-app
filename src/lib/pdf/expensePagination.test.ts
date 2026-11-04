import pdfMake from 'pdfmake/build/pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { expect, test } from 'vitest';
import { buildExpenseSnapshot } from '../expense/snapshot';
import type { ExpenseItem } from '../expense/types';
import type { Settings } from '../types';
import { buildExpenseDoc } from './expenseDoc';
import './generate'; // Register the same bundled fonts used by PDF export.

interface RenderedPage {
  items: Array<{
    type: string;
    item: { inlines?: Array<{ text: string }> };
  }>;
}

const settings: Settings = {
  inspectorName: 'Jane Tester', inspectorAddress: '123 Test Street', inspectorNumber: 'ON-42',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: '',
};

function pageText(page: RenderedPage): string {
  return page.items.filter((item) => item.type === 'line')
    .map(({ item }) => item.inlines?.map((inline) => inline.text).join('') ?? '')
    .join('\n');
}

test.each([29, 30, 31, 60])(
  'keeps the General/Admin heading with its first expense after %i vehicle rows',
  async (vehicleCount) => {
    const items: ExpenseItem[] = Array.from({ length: vehicleCount }, (_, index) => ({
      position: index, category: 'vehicle',
      date: `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
      description: `Fuel stop ${index + 1}`, amountCents: 4_000 + index,
    }));
    for (let index = 0; index < 4; index += 1) {
      items.push({
        position: items.length, category: 'general', date: '2026-07-31',
        description: `Office item ${index + 1} with a long description that may wrap onto a second line inside the column`,
        amountCents: 99_999 + index,
      });
    }
    const snapshot = buildExpenseSnapshot({
      seq: 12, year: 2026, reportDate: '2026-07-31',
      periodStart: '2026-07-01', periodEnd: '2026-07-31', items,
    }, settings, 12);
    const pdf = pdfMake.createPdf(buildExpenseDoc(snapshot) as unknown as TDocumentDefinitions);
    const stream = await pdf.getStream();
    await pdf.getBuffer();

    // Inspect actual pdfmake layout rather than a mocked pagination callback.
    const pages = (stream as unknown as { _pdfMakePages: RenderedPage[] })
      ._pdfMakePages.map(pageText);
    const headingPage = pages.findIndex((text) => text.includes('General/Admin expenses'));
    const firstExpensePage = pages.findIndex((text) => text.includes('Office item 1'));
    expect(headingPage).toBeGreaterThanOrEqual(0);
    expect(firstExpensePage).toBe(headingPage);
  },
);
