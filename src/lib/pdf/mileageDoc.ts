import { formatKm, formatOdometerInput } from '../mileage/odometer';
import type { MileageSnapshot } from '../mileage/types';

const TEAL = '#0E7C7B';
const MUTED = '#5A6663';

/** A pure pdfmake definition built only from a frozen mileage snapshot. */
export type MileageDoc = Record<string, unknown>;

export function buildMileageDoc(snapshot: MileageSnapshot): MileageDoc {
  const titleStack: unknown[] = [];
  if (snapshot.logoDataUrl) {
    titleStack.push({ image: snapshot.logoDataUrl, fit: [180, 64], margin: [0, 0, 0, 6] });
  }
  titleStack.push({ text: 'CAR MILEAGE REPORT', color: TEAL, fontSize: 22, bold: true });

  const body: unknown[][] = [[
    { text: 'Date', style: 'th' },
    { text: 'From', style: 'th' },
    { text: 'To', style: 'th' },
    { text: 'Purpose', style: 'th' },
    { text: 'Start (km)', style: 'th', alignment: 'right' },
    { text: 'End (km)', style: 'th', alignment: 'right' },
    { text: 'Distance', style: 'th', alignment: 'right' },
  ]];
  for (const trip of snapshot.trips) {
    body.push([
      { text: trip.date, noWrap: true },
      { text: trip.from },
      { text: trip.to },
      { text: trip.purpose },
      { text: formatOdometerInput(trip.startOdometerKm), alignment: 'right' },
      { text: formatOdometerInput(trip.endOdometerKm), alignment: 'right' },
      { text: formatKm(trip.distanceKm), alignment: 'right' },
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
        columns: [
          {
            stack: [
              { text: 'PREPARED BY', style: 'label' },
              { text: snapshot.inspectorName, bold: true },
              { text: snapshot.inspectorAddress },
              { text: `Inspector # ${snapshot.inspectorNumber}` },
            ],
          },
          {
            stack: [
              { text: 'VEHICLE', style: 'label' },
              { text: snapshot.vehicle, bold: true },
              { text: `${snapshot.trips.length} ${snapshot.trips.length === 1 ? 'trip' : 'trips'}`, color: MUTED },
            ],
          },
        ],
        columnGap: 24,
        margin: [0, 16, 0, 16],
      },
      {
        table: {
          headerRows: 1,
          widths: [56, '*', '*', '*', 54, 54, 58],
          body,
        },
        layout: 'lightHorizontalLines',
        fontSize: 9,
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
                  text: 'TOTAL DISTANCE', bold: true, color: '#fff', fillColor: TEAL,
                  fontSize: 12, margin: [5, 4, 5, 4],
                },
                {
                  text: formatKm(snapshot.totalKm), bold: true, color: '#fff',
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
      th: { bold: true, color: TEAL, fontSize: 8 },
      label: { bold: true, color: MUTED, fontSize: 8, margin: [0, 0, 0, 2] },
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Mileage report #${snapshot.reportNumber} · ${snapshot.vehicle}`, color: MUTED, fontSize: 8 },
        { text: `Page ${currentPage} of ${pageCount}`, color: MUTED, fontSize: 8, alignment: 'right' },
      ],
      margin: [40, 16, 40, 0],
    }),
  };
}
