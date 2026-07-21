import type { ExpenseSummaryData } from '../expense/types';
import { formatDollars } from '../money';
import { formatIsoDate } from '../validation';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

export interface ExpenseSummaryInput extends ExpenseSummaryData {
  rangeLabel: string;
  preparedOn: string;
  businessName: string;
}

/** A pure expense-history summary definition built from one frozen range result. */
export function buildExpenseSummaryDoc(input: ExpenseSummaryInput): Record<string, unknown> {
  const totalCents = input.reports.reduce((sum, report) => sum + report.totalCents, 0);
  const summaryRows: unknown[][] = [
    [{ text: 'Reports' }, { text: String(input.reports.length), alignment: 'right' }],
    [
      { text: 'Total expenses', bold: true },
      { text: formatDollars(totalCents), alignment: 'right', bold: true, noWrap: true },
    ],
  ];
  const itemRows: unknown[][] = [[
    { text: 'Expense date', style: 'th' },
    { text: 'Description', style: 'th' },
    { text: 'Report #', style: 'th' },
    { text: 'Amount', style: 'th', alignment: 'right' },
  ]];
  for (const item of input.items) {
    itemRows.push([
      { text: formatIsoDate(item.itemDate), noWrap: true },
      { text: item.description },
      { text: item.reportNumber, noWrap: true },
      { text: formatDollars(item.amountCents), alignment: 'right', noWrap: true },
    ]);
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { fontSize: 10, color: '#1C2826' },
    content: [
      { text: 'Expense Summary', fontSize: 22, bold: true, color: TEAL },
      {
        text: `${input.businessName} · prepared ${input.preparedOn}`,
        color: MUTED,
        margin: [0, 2, 0, 0],
      },
      { text: input.rangeLabel, color: MUTED, fontSize: 9, margin: [0, 2, 0, 12] },
      { table: { widths: ['*', 'auto'], body: summaryRows }, layout: 'lightHorizontalLines' },
      { text: 'Expense detail', style: 'sectionHead', margin: [0, 16, 0, 4] },
      {
        table: { headerRows: 1, widths: [78, '*', 64, 72], body: itemRows },
        layout: 'lightHorizontalLines',
      },
    ],
    styles: {
      th: { bold: true, color: TEAL, fontSize: 8 },
      sectionHead: { bold: true, color: TEAL, fontSize: 12 },
    },
  };
}
