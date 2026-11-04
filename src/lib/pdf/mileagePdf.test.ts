import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MileageSnapshot } from '../mileage/types';

const fsCalls = vi.hoisted(() => ({
  mkdir: [] as Array<[string, unknown]>,
  writes: [] as Array<{ path: string; bytes: Uint8Array }>,
  invoiceFolder: '',
}));

vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: async () => '/home/me/Downloads',
  join: async (...parts: string[]) => parts.join('/'),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: async (path: string, options: unknown) => { fsCalls.mkdir.push([path, options]); },
  writeFile: async (path: string, bytes: Uint8Array) => { fsCalls.writes.push({ path, bytes }); },
}));
vi.mock('../stores/prefs', () => ({ getInvoiceFolder: () => fsCalls.invoiceFolder }));

const { saveMileagePdf } = await import('./generate');

const snapshot = (over: Partial<MileageSnapshot> = {}): MileageSnapshot => ({
  reportNumber: '3-2026', seq: 3, year: 2026, reportDate: '2026-07-15',
  periodStart: '2026-07-01', periodEnd: '2026-07-15', vehicle: 'Ford F-150',
  inspectorName: 'North Star', inspectorAddress: '1 Main', inspectorNumber: 'ON-7', logoDataUrl: '',
  trips: [{
    position: 0, date: '2026-07-02', from: 'Home', to: 'Lot', purpose: 'Inspections',
    startOdometerKm: 0, endOdometerKm: 25, distanceKm: 25,
  }],
  totalKm: 25,
  ...over,
});

describe('saveMileagePdf', () => {
  beforeEach(() => {
    fsCalls.mkdir.length = 0;
    fsCalls.writes.length = 0;
    fsCalls.invoiceFolder = '';
  });

  test('writes real PDF bytes as Mileage-Report-<number>.pdf inside the <year>-mileage folder', async () => {
    const result = await saveMileagePdf(snapshot());

    expect(result).toEqual({
      fileName: 'Mileage-Report-3-2026.pdf',
      path: '/home/me/Downloads/2026-mileage/Mileage-Report-3-2026.pdf',
      fellBack: false,
    });
    expect(fsCalls.mkdir).toEqual([['/home/me/Downloads/2026-mileage', { recursive: true }]]);
    expect(fsCalls.writes).toHaveLength(1);
    const { bytes } = fsCalls.writes[0];
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });

  test('files reports by their frozen numbering year under the chosen PDF folder', async () => {
    fsCalls.invoiceFolder = '/data/pdfs';

    const result = await saveMileagePdf(snapshot({ reportNumber: '1-2027', seq: 1, year: 2027 }));

    expect(result.path).toBe('/data/pdfs/2027-mileage/Mileage-Report-1-2027.pdf');
    expect(fsCalls.writes.map((write) => write.path)).toEqual([result.path]);
  });
});
