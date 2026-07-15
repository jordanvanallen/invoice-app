import pdfMake from 'pdfmake/build/pdfmake';
import * as vfsModule from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { FinalizedSnapshot } from '../types';
import type { ExpenseSnapshot } from '../expense/types';
import { buildInvoiceDoc } from './invoiceDoc';
import { buildExpenseDoc } from './expenseDoc';
import { buildSummaryDoc, type SummaryInput } from './yearSummaryDoc';
import { getInvoiceFolder } from '../stores/prefs';

/* eslint-disable @typescript-eslint/no-explicit-any */
// pdfmake 0.3's vfs_fonts module IS the font map (keys are 'Roboto-Regular.ttf' …),
// exposed under `.default` via ESM interop. Assign it as pdfmake's virtual FS.
(pdfMake as any).vfs = (vfsModule as any).default ?? vfsModule;

/** Generate PDF bytes from a pdfmake doc. pdfmake 0.3 returns a Promise (no callback). */
async function docBytes(doc: unknown): Promise<Uint8Array> {
  const buf = await (pdfMake.createPdf(doc as TDocumentDefinitions) as any).getBuffer();
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

export interface SaveResult {
  fileName: string;
  /** Absolute path when saved natively; null when we fell back to a browser download. */
  path: string | null;
  fellBack: boolean;
}

/**
 * Save a pdfmake doc into the invoice folder (Downloads by default), optionally
 * inside a subfolder (created if needed) so files stay organized — e.g. invoices
 * filed under `2026-invoices/`. Falls back to the webview downloader on failure.
 */
async function savePdfDoc(doc: unknown, fileName: string, subFolder?: string): Promise<SaveResult> {
  const bytes = await docBytes(doc);
  try {
    const [{ downloadDir, join }, { writeFile, mkdir }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const base = getInvoiceFolder() || (await downloadDir());
    const dir = subFolder ? await join(base, subFolder) : base;
    if (subFolder) {
      try { await mkdir(dir, { recursive: true }); } catch { /* already exists */ }
    }
    const path = await join(dir, fileName);
    await writeFile(path, bytes);
    return { fileName, path, fellBack: false };
  } catch {
    try {
      await (pdfMake.createPdf(doc as TDocumentDefinitions) as any).download(fileName);
    } catch { /* ignore */ }
    return { fileName, path: null, fellBack: true };
  }
}

/** Invoice PDF bytes (exposed for tests). */
export function invoicePdfBytes(snap: FinalizedSnapshot): Promise<Uint8Array> {
  return docBytes(buildInvoiceDoc(snap));
}

/** Expense report PDF bytes (exposed for tests and visual verification). */
export function expensePdfBytes(snapshot: ExpenseSnapshot): Promise<Uint8Array> {
  return docBytes(buildExpenseDoc(snapshot));
}

/** Tax-summary PDF bytes (exposed for tests). */
export function summaryPdfBytes(input: SummaryInput): Promise<Uint8Array> {
  return docBytes(buildSummaryDoc(input));
}

export function saveInvoicePdf(snap: FinalizedSnapshot): Promise<SaveResult> {
  return savePdfDoc(buildInvoiceDoc(snap), `Invoice-${snap.invoiceNumber}.pdf`, `${snap.year}-invoices`);
}

export function saveExpensePdf(snapshot: ExpenseSnapshot): Promise<SaveResult> {
  return savePdfDoc(
    buildExpenseDoc(snapshot),
    `Expense-Report-${snapshot.reportNumber}.pdf`,
    `${snapshot.year}-expenses`,
  );
}

export function saveSummaryPdf(input: SummaryInput, fileName: string): Promise<SaveResult> {
  return savePdfDoc(buildSummaryDoc(input), fileName, 'tax-summaries');
}

/** Open a saved PDF in the system's default viewer; fall back to a file:// URL
 *  (e.g. the browser) if no default app is registered for the path. */
export async function openPdfPath(path: string): Promise<void> {
  const { openPath, openUrl } = await import('@tauri-apps/plugin-opener');
  try {
    await openPath(path);
  } catch {
    await openUrl(`file://${path}`);
  }
}

/** Reveal a saved PDF in the OS file manager. */
export async function revealPdfPath(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
