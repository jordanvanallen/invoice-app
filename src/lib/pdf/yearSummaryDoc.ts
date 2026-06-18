import { formatDollars } from '../money';
import type { YearRollup, ClientBreakdownRow } from '../db/invoice-repo';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

export interface SummaryInput {
  title: string;
  note: string;
  preparedOn: string;
  businessName: string;
  rollup: YearRollup;
  breakdown: ClientBreakdownRow[];
}

/** Tax-time summary for the accountant — pure (testable without pdfmake). */
export function buildSummaryDoc(p: SummaryInput): Record<string, unknown> {
  const incomeBeforeTax = p.rollup.totalBilledCents - p.rollup.totalTaxCents;

  const summaryRows: unknown[][] = [
    [{ text: 'Invoices issued' }, { text: String(p.rollup.count), alignment: 'right' }],
    [{ text: 'Income before tax' }, { text: formatDollars(incomeBeforeTax), alignment: 'right' }],
    [{ text: 'HST collected' }, { text: formatDollars(p.rollup.totalTaxCents), alignment: 'right' }],
    [
      { text: 'Total billed (incl. HST)', bold: true },
      { text: formatDollars(p.rollup.totalBilledCents), alignment: 'right', bold: true },
    ],
  ];

  const clientBody: unknown[][] = [[
    { text: 'Client', style: 'th' },
    { text: 'Inspections', style: 'th', alignment: 'right' },
    { text: 'Amount (before tax)', style: 'th', alignment: 'right' },
  ]];
  for (const c of p.breakdown) {
    clientBody.push([
      { text: c.clientName },
      { text: String(c.count), alignment: 'right' },
      { text: formatDollars(c.subtotalCents), alignment: 'right' },
    ]);
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { fontSize: 10, color: '#1C2826' },
    content: [
      { text: p.title, fontSize: 22, bold: true, color: TEAL },
      { text: `${p.businessName} · prepared ${p.preparedOn}`, color: MUTED, margin: [0, 2, 0, 0] },
      { text: p.note, color: MUTED, fontSize: 8, margin: [0, 2, 0, 12] },
      { table: { widths: ['*', 'auto'], body: summaryRows }, layout: 'lightHorizontalLines' },
      { text: 'By client', style: 'sectionHead', margin: [0, 16, 0, 4] },
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: clientBody }, layout: 'lightHorizontalLines' },
    ],
    styles: {
      th: { bold: true, color: TEAL, fontSize: 8 },
      sectionHead: { bold: true, color: TEAL, fontSize: 12 },
    },
  };
}
