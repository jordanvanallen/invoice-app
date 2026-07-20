/** Integer count of cents. Never a fractional/float dollar amount. */
export type Cents = number;

/** Integer basis points. 1300 === 13.00%. */
export type BasisPoints = number;

export type LineType = 'completed' | 'noshow';

export interface LineItem {
  type: LineType;
  position: number;
  inspectionNumber: string;
  /** Optional link to a clients row; null for free-typed entries. */
  clientId: number | null;
  /** Display source of truth on finalized invoices. */
  clientName: string;
  locationId: number | null;
  location: string;
  /** ISO date string, e.g. "2026-05-21". */
  date: string;
  /** Last 8 of VIN, normalized (uppercase, no spaces). */
  vin8: string;
  /** Taxable billable add-on; 0 when none. Not used on no-show lines. */
  mileageCents: Cents;
  mileageApproverId: number | null;
  mileageApproverName: string;
  mileageApprovalDate: string;
  /** Fee bound when the row is created; never a live lookup. */
  feeCents: Cents;
}

export interface InvoiceTotals {
  completedSubtotalCents: Cents;
  noshowSubtotalCents: Cents;
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface Settings {
  inspectorName: string;
  inspectorAddress: string;
  inspectorNumber: string;
  /** GST/HST registration number (the "Tax ID"). */
  gstHstRegistrationNumber: string;
  billToName: string;
  billToAddress: string;
  registered: boolean;
  taxRateBp: BasisPoints;
  defaultCompletedFeeCents: Cents;
  defaultNoshowFeeCents: Cents;
  paymentEmail: string;
  footerNotes: string;
  /** Optional business logo as a data URL (downscaled PNG); '' = none. */
  logoDataUrl: string;
}

export interface DraftInvoice {
  seq: number | null;
  year: number;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  lines: LineItem[];
}

/** Everything frozen onto an invoice at finalize. Reprints read only this. */
export interface FinalizedSnapshot {
  invoiceNumber: string;
  seq: number;
  year: number;
  issueDate: string;
  periodStart: string;
  periodEnd: string;
  inspectorName: string;
  inspectorAddress: string;
  inspectorNumber: string;
  gstHstRegistrationNumber: string;
  billToName: string;
  billToAddress: string;
  registered: boolean;
  taxRateBp: BasisPoints;
  paymentEmail: string;
  footerNotes: string;
  /** Business logo (data URL) frozen at finalize; '' = none. */
  logoDataUrl: string;
  lines: LineItem[];
  totals: InvoiceTotals;
}
