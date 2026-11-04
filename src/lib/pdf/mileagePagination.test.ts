import pdfMake from 'pdfmake/build/pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { expect, test } from 'vitest';
import type { MileageSnapshot } from '../mileage/types';
import { buildMileageDoc } from './mileageDoc';
import './generate'; // Register the same bundled fonts used by PDF export.

interface RenderedPage {
  items: Array<{
    type: string;
    item: { inlines?: Array<{ text: string }> };
  }>;
}

test.each(['from', 'to', 'purpose'] as const)(
  'preserves a trip whose %s text is taller than a PDF page',
  async (field) => {
    const snapshot: MileageSnapshot = {
      reportNumber: '1-2026', seq: 1, year: 2026,
      reportDate: '2026-07-31', periodStart: '2026-07-01', periodEnd: '2026-07-31',
      vehicle: 'Inspection vehicle', inspectorName: 'Jane Tester',
      inspectorAddress: '123 Test Street', inspectorNumber: 'ON-42', logoDataUrl: '',
      trips: [
        {
          position: 0, date: '2026-07-01', from: 'Home', to: 'Office', purpose: 'Short trip',
          startOdometerKm: 0, endOdometerKm: 1, distanceKm: 1,
        },
        {
          position: 1, date: '2026-07-02', from: 'Office', to: 'North lot', purpose: 'Inspections',
          startOdometerKm: 1_000, endOdometerKm: 1_028, distanceKm: 28,
          [field]: 'Inspected lease returns at the north lot and photographed damage for the client file. '.repeat(12).trim(),
        },
      ],
      totalKm: 29,
    };
    const pdf = pdfMake.createPdf(buildMileageDoc(snapshot) as unknown as TDocumentDefinitions);
    const stream = await pdf.getStream();
    await pdf.getBuffer();

    // Use the real layout: a PDF header and total alone cannot prove every trip printed.
    const pages = (stream as unknown as { _pdfMakePages: RenderedPage[] })._pdfMakePages;
    const text = pages.flatMap((page) => page.items.filter((item) => item.type === 'line'))
      .map(({ item }) => item.inlines?.map((inline) => inline.text).join('') ?? '')
      .join('\n');
    expect(pages.length).toBeGreaterThan(1);
    expect(text).toContain('Short trip');
    expect(text).toContain('1,028');
    expect(text).toContain('28 km');
    expect(text).toContain('29 km');
  },
);
