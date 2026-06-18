import type { Db } from './db';
import type { Settings } from '../types';

interface SettingsRow {
  inspector_name: string;
  inspector_address: string;
  inspector_number: string;
  gst_hst_registration_number: string;
  bill_to_name: string;
  bill_to_address: string;
  registered: number;
  tax_rate_bp: number;
  default_completed_fee_cents: number;
  default_noshow_fee_cents: number;
  payment_email: string;
  footer_notes: string;
  logo_data_url: string;
}

export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db.select<SettingsRow>('SELECT * FROM settings WHERE id = 1');
  return {
    inspectorName: row.inspector_name,
    inspectorAddress: row.inspector_address,
    inspectorNumber: row.inspector_number,
    gstHstRegistrationNumber: row.gst_hst_registration_number,
    billToName: row.bill_to_name,
    billToAddress: row.bill_to_address,
    registered: row.registered === 1,
    taxRateBp: row.tax_rate_bp,
    defaultCompletedFeeCents: row.default_completed_fee_cents,
    defaultNoshowFeeCents: row.default_noshow_fee_cents,
    paymentEmail: row.payment_email,
    footerNotes: row.footer_notes,
    logoDataUrl: row.logo_data_url ?? '',
  };
}

export async function saveSettings(db: Db, s: Settings): Promise<void> {
  await db.execute(
    `UPDATE settings SET
       inspector_name = ?, inspector_address = ?, inspector_number = ?,
       gst_hst_registration_number = ?, bill_to_name = ?, bill_to_address = ?,
       registered = ?, tax_rate_bp = ?, default_completed_fee_cents = ?,
       default_noshow_fee_cents = ?, payment_email = ?, footer_notes = ?,
       logo_data_url = ?
     WHERE id = 1`,
    [
      s.inspectorName, s.inspectorAddress, s.inspectorNumber,
      s.gstHstRegistrationNumber, s.billToName, s.billToAddress,
      s.registered ? 1 : 0, s.taxRateBp, s.defaultCompletedFeeCents,
      s.defaultNoshowFeeCents, s.paymentEmail, s.footerNotes,
      s.logoDataUrl ?? '',
    ],
  );
}
