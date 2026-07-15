import { formatDollars } from '../money';
import type { ExpenseSnapshot } from '../expense/types';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

/** A pure pdfmake definition built only from a frozen expense snapshot. */
export type ExpenseDoc = Record<string, unknown>;

export function buildExpenseDoc(snapshot: ExpenseSnapshot): ExpenseDoc {
  const titleStack: unknown[] = [];
  if (snapshot.logoDataUrl) {
    titleStack.push({ image: snapshot.logoDataUrl, fit: [180, 64], margin: [0, 0, 0, 6] });
  }
  titleStack.push({ text: 'EXPENSE REPORT', color: TEAL, fontSize: 24, bold: true });

  const body: unknown[][] = [[
    { text: 'Date', style: 'th' },
    { text: 'Description', style: 'th' },
    { text: 'Amount', style: 'th', alignment: 'right' },
  ]];
  for (const item of snapshot.items) {
    body.push([
      { text: item.date },
      { text: item.description },
      { text: formatDollars(item.amountCents), alignment: 'right', noWrap: true },
    ]);
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 52],
    defaultStyle: { fontSize: 10, color: '#1C2826' },
    content: [
      {
        columns: [
          { stack: titleStack },
          {
            width: 'auto',
            stack: [
              { text: `#${snapshot.reportNumber}`, fontSize: 13, bold: true, alignment: 'right' },
              { text: `Report date ${snapshot.reportDate}`, alignment: 'right', color: MUTED },
              {
                text: `Period ${snapshot.periodStart} - ${snapshot.periodEnd}`,
                alignment: 'right',
                color: MUTED,
              },
            ],
          },
        ],
      },
      {
        stack: [
          { text: 'PREPARED BY', style: 'label' },
          { text: snapshot.inspectorName, bold: true },
          { text: snapshot.inspectorAddress },
          { text: `Inspector # ${snapshot.inspectorNumber}` },
        ],
        margin: [0, 16, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: [82, '*', 82],
          body,
        },
        layout: 'lightHorizontalLines',
      },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 240,
            table: {
              widths: ['*', 'auto'],
              body: [[
                {
                  text: 'TOTAL', bold: true, color: '#fff', fillColor: TEAL,
                  fontSize: 12, margin: [5, 4, 5, 4],
                },
                {
                  text: formatDollars(snapshot.totalCents), bold: true, color: '#fff',
                  fillColor: TEAL, fontSize: 12, alignment: 'right',
                  margin: [5, 4, 5, 4], noWrap: true,
                },
              ]],
            },
            layout: 'noBorders',
          },
        ],
        margin: [0, 16, 0, 0],
      },
    ],
    styles: {
      th: { bold: true, color: TEAL, fontSize: 9 },
      label: { bold: true, color: MUTED, fontSize: 8, margin: [0, 0, 0, 2] },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Expense report #${snapshot.reportNumber}`, color: MUTED, fontSize: 8 },
        { text: `Page ${currentPage} of ${pageCount}`, color: MUTED, fontSize: 8, alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
    }),
  };
}
