import { formatDollars } from '../money';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '../expense/category';
import { expenseSnapshotSection, isSectionedExpenseSnapshot } from '../expense/snapshot';
import type {
  ExpenseSnapshot,
  LegacyExpenseItem,
  LegacyExpenseSnapshot,
  SectionedExpenseSnapshot,
} from '../expense/types';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

/** A pure pdfmake definition built only from a frozen expense snapshot. */
export type ExpenseDoc = Record<string, unknown>;

function itemTableHead(): unknown[] {
  return [
    { text: 'Date', style: 'th' },
    { text: 'Description', style: 'th' },
    { text: 'Amount', style: 'th', alignment: 'right' },
  ];
}

function itemTableRow(item: LegacyExpenseItem): unknown[] {
  return [
    { text: item.date },
    { text: item.description },
    { text: formatDollars(item.amountCents), alignment: 'right', noWrap: true },
  ];
}

function itemTable(body: unknown[][], sectionLabel?: string): unknown {
  return {
    table: {
      headerRows: sectionLabel ? 2 : 1,
      widths: [82, '*', 82],
      body: sectionLabel
        ? [[{ text: sectionLabel, style: 'sectionHead', colSpan: 3, margin: [0, 12, 0, 4] }, '', ''], ...body]
        : body,
      // Repeating section titles and column labels stay with the first expense.
      ...(sectionLabel ? { keepWithHeaderRows: 1 } : {}),
    },
    layout: 'lightHorizontalLines',
  };
}

function totalRow(totalCents: number): unknown[] {
  return [
    {
      text: 'TOTAL', bold: true, color: '#fff', fillColor: TEAL,
      fontSize: 12, margin: [5, 4, 5, 4],
    },
    {
      text: formatDollars(totalCents), bold: true, color: '#fff',
      fillColor: TEAL, fontSize: 12, alignment: 'right',
      margin: [5, 4, 5, 4], noWrap: true,
    },
  ];
}

function totalsBlock(body: unknown[][]): unknown {
  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 240,
        table: {
          widths: ['*', 'auto'],
          body,
        },
        layout: 'noBorders',
      },
    ],
    margin: [0, 16, 0, 0],
  };
}

/** Pre-section reports: one flat table and TOTAL, exactly as they were first printed. */
function legacyBody(snapshot: LegacyExpenseSnapshot): unknown[] {
  return [
    itemTable([itemTableHead(), ...snapshot.items.map(itemTableRow)]),
    totalsBlock([totalRow(snapshot.totalCents)]),
  ];
}

/** Both sections always print, even when empty, with frozen subtotals and the grand total. */
function sectionedBody(snapshot: SectionedExpenseSnapshot): unknown[] {
  const sections = EXPENSE_CATEGORIES.map((category) => ({
    label: EXPENSE_CATEGORY_LABELS[category],
    ...expenseSnapshotSection(snapshot, category),
  }));
  return [
    ...sections.map(({ label, items }) => itemTable([
        itemTableHead(),
        ...(items.length
          ? items.map(itemTableRow)
          : [[{ text: `No ${label.toLowerCase()}`, colSpan: 3, color: MUTED, italics: true }, '', '']]),
    ], label)),
    totalsBlock([
      ...sections.map(({ label, subtotalCents }) => [
        { text: `${label} subtotal`, margin: [5, 2, 5, 2] },
        {
          text: formatDollars(subtotalCents), alignment: 'right',
          margin: [5, 2, 5, 2], noWrap: true,
        },
      ]),
      totalRow(snapshot.totalCents),
    ]),
  ];
}

export function buildExpenseDoc(snapshot: ExpenseSnapshot): ExpenseDoc {
  const sectioned = isSectionedExpenseSnapshot(snapshot);
  const titleStack: unknown[] = [];
  if (snapshot.logoDataUrl) {
    titleStack.push({ image: snapshot.logoDataUrl, fit: [180, 64], margin: [0, 0, 0, 6] });
  }
  titleStack.push({ text: 'EXPENSE REPORT', color: TEAL, fontSize: 24, bold: true });

  const styles: Record<string, unknown> = {
    th: { bold: true, color: TEAL, fontSize: 9 },
    label: { bold: true, color: MUTED, fontSize: 8, margin: [0, 0, 0, 2] },
  };
  if (sectioned) styles.sectionHead = { bold: true, color: TEAL, fontSize: 11 };

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
      ...(sectioned ? sectionedBody(snapshot) : legacyBody(snapshot)),
    ],
    styles,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Expense report #${snapshot.reportNumber}`, color: MUTED, fontSize: 8 },
        { text: `Page ${currentPage} of ${pageCount}`, color: MUTED, fontSize: 8, alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
    }),
  };
}
