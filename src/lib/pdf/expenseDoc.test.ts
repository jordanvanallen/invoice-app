import { describe, expect, test } from 'vitest';
import { buildExpenseDoc } from './expenseDoc';
import { buildExpenseSnapshot, parseExpenseSnapshot } from '../expense/snapshot';
import type { ExpenseItem, LegacyExpenseSnapshot } from '../expense/types';
import type { Settings } from '../types';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

const legacySnapshot = (logoDataUrl = ''): LegacyExpenseSnapshot => ({
  reportNumber: '7-2026',
  seq: 7,
  year: 2026,
  reportDate: '2026-07-15',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-15',
  inspectorName: 'North Star Inspections',
  inspectorAddress: '1 Main Street',
  inspectorNumber: 'ON-7',
  logoDataUrl,
  items: [
    { position: 0, date: '2026-07-02', description: 'Fuel', amountCents: 5_000 },
    { position: 1, date: '2026-07-10', description: 'Parking', amountCents: 1_250 },
  ],
  totalCents: 6_250,
});

/** The stored JSON of a report finalized before expense sections existed. */
const LEGACY_GOLDEN_JSON = JSON.stringify({
  ...legacySnapshot('data:image/png;base64,legacy-logo'),
  items: [
    { position: 0, date: '2026-07-02', description: 'Fuel', amountCents: 5000 },
    { position: 1, date: '2026-07-10', description: 'Parking', amountCents: 1250 },
    { position: 2, date: '2026-07-14', description: 'Hotel, 2 nights', amountCents: 123456 },
  ],
  totalCents: 129706,
});

const legacyRow = (date: string, description: string, amount: string) => [
  { text: date },
  { text: description },
  { text: amount, alignment: 'right', noWrap: true },
];

/**
 * buildExpenseDoc output for LEGACY_GOLDEN_JSON, captured from the pre-section
 * implementation (commit eb8fca2) before category support was added. Old
 * finalized reports must keep reprinting exactly like this.
 */
const LEGACY_GOLDEN_DOC = {
  pageSize: 'LETTER',
  pageMargins: [40, 40, 40, 52],
  defaultStyle: { fontSize: 10, color: '#1C2826' },
  content: [
    {
      columns: [
        {
          stack: [
            { image: 'data:image/png;base64,legacy-logo', fit: [180, 64], margin: [0, 0, 0, 6] },
            { text: 'EXPENSE REPORT', color: TEAL, fontSize: 24, bold: true },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: '#7-2026', fontSize: 13, bold: true, alignment: 'right' },
            { text: 'Report date 2026-07-15', alignment: 'right', color: MUTED },
            { text: 'Period 2026-07-01 - 2026-07-15', alignment: 'right', color: MUTED },
          ],
        },
      ],
    },
    {
      stack: [
        { text: 'PREPARED BY', style: 'label' },
        { text: 'North Star Inspections', bold: true },
        { text: '1 Main Street' },
        { text: 'Inspector # ON-7' },
      ],
      margin: [0, 16, 0, 16],
    },
    {
      table: {
        headerRows: 1,
        widths: [82, '*', 82],
        body: [
          [
            { text: 'Date', style: 'th' },
            { text: 'Description', style: 'th' },
            { text: 'Amount', style: 'th', alignment: 'right' },
          ],
          legacyRow('2026-07-02', 'Fuel', '$50.00'),
          legacyRow('2026-07-10', 'Parking', '$12.50'),
          legacyRow('2026-07-14', 'Hotel, 2 nights', '$1234.56'),
        ],
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
                text: '$1297.06', bold: true, color: '#fff', fillColor: TEAL,
                fontSize: 12, alignment: 'right', margin: [5, 4, 5, 4], noWrap: true,
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
};

const LEGACY_GOLDEN_FOOTER_PAGE_1_OF_2 = {
  columns: [
    { text: 'Expense report #7-2026', color: MUTED, fontSize: 8 },
    { text: 'Page 1 of 2', color: MUTED, fontSize: 8, alignment: 'right' },
  ],
  margin: [40, 16, 40, 0],
};

type Footer = (currentPage: number, pageCount: number) => unknown;

function splitFooter(doc: Record<string, unknown>) {
  const { footer, ...rest } = doc;
  return { rest, footer: footer as Footer };
}

const settings: Settings = {
  inspectorName: 'North Star Inspections', inspectorAddress: '1 Main Street', inspectorNumber: 'ON-7',
  gstHstRegistrationNumber: '', billToName: '', billToAddress: '', registered: false,
  taxRateBp: 0, defaultCompletedFeeCents: 0, defaultNoshowFeeCents: 0,
  paymentEmail: '', footerNotes: '', logoDataUrl: '',
};

function sectioned(items: ExpenseItem[]) {
  return buildExpenseSnapshot({
    seq: 9, year: 2026, reportDate: '2026-07-15', periodStart: '2026-07-01', periodEnd: '2026-07-15', items,
  }, settings, 9);
}

const row = (over: Partial<ExpenseItem>): ExpenseItem => ({
  position: 0, category: 'general', date: '2026-07-02', description: 'Fuel', amountCents: 5_000, ...over,
});

/** Section heading texts and the row descriptions printed under each, in document order. */
function printedSections(doc: Record<string, unknown>): Array<[string, string[]]> {
  const content = doc.content as Array<Record<string, unknown>>;
  const sections: Array<[string, string[]]> = [];
  content.forEach((block) => {
    const table = block.table as { body: Array<Array<{ text?: string; style?: string }>> } | undefined;
    const heading = table?.body[0]?.[0];
    if (heading?.style !== 'sectionHead') return;
    sections.push([heading.text as string, table!.body.slice(2).map((cells) => cells[1]?.text ?? cells[0].text ?? '')]);
  });
  return sections;
}

function totalsRows(doc: Record<string, unknown>): string[][] {
  const content = doc.content as Array<Record<string, unknown>>;
  const totals = content.at(-1) as { columns: Array<{ table?: { body: Array<Array<{ text: string }>> } }> };
  return totals.columns[1].table!.body.map((cells) => cells.map((cell) => cell.text));
}

describe('buildExpenseDoc for reports finalized before sections existed', () => {
  test('reprints a stored legacy snapshot exactly as the pre-section golden', () => {
    const { rest, footer } = splitFooter(buildExpenseDoc(parseExpenseSnapshot(LEGACY_GOLDEN_JSON)));

    expect(rest).toEqual(LEGACY_GOLDEN_DOC);
    expect(footer(1, 2)).toEqual(LEGACY_GOLDEN_FOOTER_PAGE_1_OF_2);
  });

  test('includes frozen identity, report details, rows, amounts, and total', () => {
    const serialized = JSON.stringify(buildExpenseDoc(legacySnapshot()));

    expect(serialized).toContain('EXPENSE REPORT');
    expect(serialized).toContain('North Star Inspections');
    expect(serialized).toContain('1 Main Street');
    expect(serialized).toContain('Inspector # ON-7');
    expect(serialized).toContain('#7-2026');
    expect(serialized).toContain('Report date 2026-07-15');
    expect(serialized).toContain('Period 2026-07-01 - 2026-07-15');
    expect(serialized.indexOf('Fuel')).toBeLessThan(serialized.indexOf('Parking'));
    expect(serialized).toContain('$50.00');
    expect(serialized).toContain('$12.50');
    expect(serialized).toContain('$62.50');
    expect(serialized).not.toContain('Vehicle expenses');
    expect(serialized).not.toContain('subtotal');
  });

  test('embeds the frozen logo only when one exists', () => {
    const logo = 'data:image/png;base64,expense-logo';
    expect(JSON.stringify(buildExpenseDoc(legacySnapshot(logo)))).toContain(logo);
    expect(JSON.stringify(buildExpenseDoc(legacySnapshot()))).not.toContain('"image"');
  });
});

describe('buildExpenseDoc for sectioned reports', () => {
  test('prints Vehicle then General/Admin rows with stored subtotals and the grand total', () => {
    const snapshot = sectioned([
      row({ position: 0, category: 'general', date: '2026-07-03', description: 'Printer ink', amountCents: 1_250 }),
      row({ position: 1, category: 'vehicle', date: '2026-07-09', description: 'Parking', amountCents: 800 }),
      row({ position: 2, category: 'vehicle', date: '2026-07-02', description: 'Fuel', amountCents: 5_000 }),
    ]);
    const doc = buildExpenseDoc(snapshot);

    expect(printedSections(doc)).toEqual([
      ['Vehicle expenses', ['Fuel', 'Parking']],
      ['General/Admin expenses', ['Printer ink']],
    ]);
    expect(totalsRows(doc)).toEqual([
      ['Vehicle expenses subtotal', '$58.00'],
      ['General/Admin expenses subtotal', '$12.50'],
      ['TOTAL', '$70.50'],
    ]);
    expect((doc.styles as Record<string, unknown>).sectionHead).toEqual({ bold: true, color: TEAL, fontSize: 11 });
    const { rest } = splitFooter(doc);
    expect(rest.content).toEqual(expect.arrayContaining([LEGACY_GOLDEN_DOC.content[1]]));
  });

  test('prints an empty section with a placeholder and a zero subtotal', () => {
    const doc = buildExpenseDoc(sectioned([
      row({ category: 'general', description: 'Postage', amountCents: 300 }),
    ]));

    expect(printedSections(doc)).toEqual([
      ['Vehicle expenses', ['No vehicle expenses']],
      ['General/Admin expenses', ['Postage']],
    ]);
    expect(totalsRows(doc)).toEqual([
      ['Vehicle expenses subtotal', '$0.00'],
      ['General/Admin expenses subtotal', '$3.00'],
      ['TOTAL', '$3.00'],
    ]);
  });

  test('prints both sections even when both are empty', () => {
    const doc = buildExpenseDoc(sectioned([]));

    expect(printedSections(doc)).toEqual([
      ['Vehicle expenses', ['No vehicle expenses']],
      ['General/Admin expenses', ['No general/admin expenses']],
    ]);
    expect(totalsRows(doc).at(-1)).toEqual(['TOTAL', '$0.00']);
  });
});
