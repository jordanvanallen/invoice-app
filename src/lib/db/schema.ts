export interface Migration {
  version: number;
  statements: string[];
}

/**
 * Append-only, additive migrations. NEVER edit a shipped migration's statements;
 * add a new version instead. Each statement is run individually (portable across
 * the sql.js test adapter and tauri-plugin-sql).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        inspector_name TEXT NOT NULL DEFAULT '',
        inspector_address TEXT NOT NULL DEFAULT '',
        inspector_number TEXT NOT NULL DEFAULT '',
        gst_hst_registration_number TEXT NOT NULL DEFAULT '',
        bill_to_name TEXT NOT NULL DEFAULT '',
        bill_to_address TEXT NOT NULL DEFAULT '',
        registered INTEGER NOT NULL DEFAULT 1,
        tax_rate_bp INTEGER NOT NULL DEFAULT 1300,
        default_completed_fee_cents INTEGER NOT NULL DEFAULT 3800,
        default_noshow_fee_cents INTEGER NOT NULL DEFAULT 2500,
        payment_email TEXT NOT NULL DEFAULT '',
        footer_notes TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE year_counters (
        year INTEGER PRIMARY KEY,
        last_seq INTEGER NOT NULL
      )`,
      `CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        seq INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','void')),
        issue_date TEXT NOT NULL DEFAULT '',
        period_start TEXT NOT NULL DEFAULT '',
        period_end TEXT NOT NULL DEFAULT '',
        finalized_at TEXT,
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL DEFAULT 0,
        snapshot_json TEXT,
        UNIQUE (year, seq)
      )`,
      `CREATE TABLE line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('completed','noshow')),
        position INTEGER NOT NULL DEFAULT 0,
        inspection_number TEXT NOT NULL DEFAULT '',
        client_id INTEGER REFERENCES clients(id),
        client_name TEXT NOT NULL DEFAULT '',
        location_id INTEGER REFERENCES locations(id),
        location TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        vin8 TEXT NOT NULL DEFAULT '',
        mileage_cents INTEGER NOT NULL DEFAULT 0,
        fee_cents INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_line_items_invoice ON line_items(invoice_id)`,
      `CREATE INDEX idx_invoices_year ON invoices(year)`,
      `INSERT INTO settings (id) VALUES (1)`,
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE settings ADD COLUMN logo_data_url TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE clients ADD COLUMN name_key TEXT NOT NULL DEFAULT ''`,
      `UPDATE clients
          SET name_key = lower(trim(name)) ||
            CASE
              WHEN (
                SELECT COUNT(*)
                  FROM clients AS older
                 WHERE lower(trim(older.name)) = lower(trim(clients.name))
                   AND older.id < clients.id
              ) = 0
              THEN ''
              ELSE '#' || id
            END`,
      `CREATE UNIQUE INDEX idx_clients_name_key ON clients(name_key)`,
    ],
  },
];
