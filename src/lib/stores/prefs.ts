const INVOICE_KEY = 'invoice.invoiceFolder';
const BACKUP_KEY = 'invoice.backupFolder';
const LEGACY_KEY = 'invoice.outputFolder'; // single folder used for both before they were split

/** Read a folder pref, falling back to the legacy single-folder value, else '' (= Downloads). */
function read(key: string): string {
  return localStorage.getItem(key) || localStorage.getItem(LEGACY_KEY) || '';
}
function write(key: string, path: string): void {
  if (path) localStorage.setItem(key, path);
  else localStorage.removeItem(key);
}

/** Folder for saved invoice/summary PDFs. Empty = the Downloads folder. */
export function getInvoiceFolder(): string {
  return read(INVOICE_KEY);
}
export function setInvoiceFolder(path: string): void {
  write(INVOICE_KEY, path);
}

/** Folder for the database backup copy. Empty = the Downloads folder. */
export function getBackupFolder(): string {
  return read(BACKUP_KEY);
}
export function setBackupFolder(path: string): void {
  write(BACKUP_KEY, path);
}
