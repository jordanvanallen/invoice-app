import type { FinalizedSnapshot, LineItem } from '../types';
import { formatDollars } from '../money';
import { mileageApprovalText } from '../mileageApproval';
import { bpToPercentInput } from '../ui/format';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

/** A pdfmake-compatible document definition (kept as a plain object so this
 *  module stays pure and unit-testable without importing pdfmake). */
export type InvoiceDoc = Record<string, unknown>;

function sectionTable(title: string, rows: LineItem[], showMileage: boolean): unknown[] {
  const widths = showMileage
    ? ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto']
    : ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto'];
  const head: unknown[] = [
    { text: '#', style: 'th' },
    { text: 'Inspection #', style: 'th' },
    { text: 'Client', style: 'th' },
    { text: 'Location', style: 'th' },
    { text: 'Date', style: 'th' },
    { text: 'VIN (last 8)', style: 'th' },
  ];
  if (showMileage) head.push({ text: 'Mileage', style: 'th', alignment: 'right' });
  head.push({ text: 'Fee', style: 'th', alignment: 'right' });

  const body: unknown[][] = [head];
  rows.forEach((l, i) => {
    const row: unknown[] = [
      { text: String(i + 1) },
      { text: l.inspectionNumber },
      { text: l.clientName },
      { text: l.location },
      { text: l.date },
      { text: l.vin8 },
    ];
    if (showMileage) row.push({ text: l.mileageCents ? formatDollars(l.mileageCents) : '', alignment: 'right' });
    row.push({ text: formatDollars(l.feeCents), alignment: 'right' });
    body.push(row);
    const approvalText = mileageApprovalText(l);
    if (approvalText) {
      body.push([
        { text: approvalText, colSpan: widths.length, style: 'approval' },
        ...Array(widths.length - 1).fill(''),
      ]);
    }
  });

  return [
    { text: title, style: 'sectionHead', margin: [0, 12, 0, 4] },
    { table: { headerRows: 1, widths, body }, layout: 'lightHorizontalLines' },
  ];
}

export function buildInvoiceDoc(snap: FinalizedSnapshot): InvoiceDoc {
  const completed = snap.lines.filter((l) => l.type === 'completed');
  const noshow = snap.lines.filter((l) => l.type === 'noshow');
  const completedMileage = completed.some((l) => l.mileageCents > 0);
  const noshowMileage = noshow.some((l) => l.mileageCents > 0);
  const t = snap.totals;

  const totalsBody: unknown[][] = [
    [{ text: 'Completed subtotal' }, { text: formatDollars(t.completedSubtotalCents), alignment: 'right' }],
    [{ text: 'No-show subtotal' }, { text: formatDollars(t.noshowSubtotalCents), alignment: 'right' }],
    [{ text: 'Subtotal' }, { text: formatDollars(t.subtotalCents), alignment: 'right' }],
  ];
  if (snap.registered) {
    totalsBody.push([
      { text: `HST ${bpToPercentInput(snap.taxRateBp)}%` },
      { text: formatDollars(t.taxCents), alignment: 'right' },
    ]);
  }
  totalsBody.push([
    { text: 'TOTAL', bold: true, color: '#fff', fillColor: TEAL, fontSize: 12, margin: [4, 2, 4, 2] },
    { text: formatDollars(t.totalCents), bold: true, color: '#fff', fillColor: TEAL, fontSize: 12, alignment: 'right', margin: [4, 2, 4, 2] },
  ]);

  const fromStack: unknown[] = [
    { text: 'FROM', style: 'label' },
    { text: snap.inspectorName, bold: true },
    { text: snap.inspectorAddress },
    { text: `Inspector # ${snap.inspectorNumber}` },
  ];
  if (snap.registered && snap.gstHstRegistrationNumber) {
    fromStack.push({ text: `GST/HST # ${snap.gstHstRegistrationNumber}` });
  }

  const titleStack: unknown[] = [];
  if (snap.logoDataUrl) titleStack.push({ image: snap.logoDataUrl, fit: [180, 64], margin: [0, 0, 0, 6] });
  titleStack.push({ text: 'INVOICE', color: TEAL, fontSize: 24, bold: true });
  titleStack.push({ text: 'Vehicle Inspection Services', color: MUTED });

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 60],
    defaultStyle: { fontSize: 9, color: '#1C2826' },
    content: [
      {
        columns: [
          { stack: titleStack },
          {
            width: 'auto',
            stack: [
              { text: `#${snap.invoiceNumber}`, fontSize: 13, bold: true, alignment: 'right' },
              { text: `Issued ${snap.issueDate}`, alignment: 'right', color: MUTED },
              { text: `Billing ${snap.periodStart} – ${snap.periodEnd}`, alignment: 'right', color: MUTED },
            ],
          },
        ],
      },
      {
        columns: [
          { stack: fromStack, margin: [0, 14, 0, 0] },
          { stack: [{ text: 'BILL TO', style: 'label' }, { text: snap.billToName, bold: true }, { text: snap.billToAddress }], margin: [0, 14, 0, 0] },
        ],
      },
      ...sectionTable('Completed Inspections', completed, completedMileage),
      ...(noshow.length ? sectionTable('No-Shows', noshow, noshowMileage) : []),
      {
        columns: [
          { width: '*', text: '' },
          { width: 240, table: { widths: ['*', 'auto'], body: totalsBody }, layout: 'noBorders' },
        ],
        margin: [0, 14, 0, 0],
      },
    ],
    styles: {
      th: { bold: true, color: TEAL, fontSize: 8 },
      sectionHead: { bold: true, color: TEAL, fontSize: 11 },
      label: { bold: true, color: MUTED, fontSize: 8, margin: [0, 0, 0, 2] },
      approval: { color: MUTED, fontSize: 8, italics: true },
    },
    footer: {
      margin: [40, 16, 40, 0],
      stack: [
        { text: snap.footerNotes, color: MUTED, fontSize: 8 },
        { text: snap.paymentEmail, color: TEAL, fontSize: 8 },
      ],
    },
  };
}
