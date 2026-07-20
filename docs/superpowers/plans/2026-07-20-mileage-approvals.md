# Mileage Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a catalog-linked approver and valid date for every non-zero mileage charge, persist immutable approval evidence, and display it beneath the owning invoice line in previews, finalized views, and PDFs.

**Architecture:** Add append-only SQLite migration 5, extend the existing line-item snapshot model, and introduce a shared pure finalization validator plus legacy-safe approval formatter. Extend the fixed-statement transaction bridge so production Tauri operations can enforce affected-row expectations inside one SQLx transaction; use that boundary for finalization, approver deletion, and duplication. Keep disclosure state editor-only while persisted approval fields flow through the existing draft/autosave/snapshot pipeline.

**Tech Stack:** Svelte 5 runes, SvelteKit 2, TypeScript 5.6, Vitest 4, SQLite/sql.js, Tauri 2, Rust/SQLx 0.8, pdfmake 0.3.

## Global Constraints

- Work only on `codex/mileage-approvals`, based from `dev` commit `57d2dc4`.
- Migration 5 is append-only; never edit statements in migrations 1–4.
- One mileage charge has exactly one approver and one approval date; no status workflow, notes, roles, signatures, attachments, or approval-events table.
- The rule applies to completed and no-show lines only when `mileageCents > 0`.
- Approved by must be linked to the Approvers catalog; free text alone never satisfies finalization.
- Approval date starts blank and must be a real canonical `YYYY-MM-DD` date, with no before/after constraint.
- Changing or temporarily clearing mileage retains approval fields in the same draft; duplicating any invoice clears them.
- Legacy snapshots without approval properties must render without errors or `undefined` text.
- No new runtime dependencies.
- Svelte components stay in runes mode and use `$bindable()` for two-way props.
- Tauri frontend commands use `invoke` and Rust results/errors remain serde-serializable.
- pdfmake `colSpan` rows include empty placeholder cells for every covered column after the leading span cell.
- Every task follows red-green-refactor TDD and ends in a focused commit.

## File Structure

**Create**

- `src/lib/mileageApproval.ts` — legacy-safe completeness and printable-text helpers.
- `src/lib/mileageApproval.test.ts` — helper coverage, including absent legacy fields.
- `src/routes/approvers/+page.svelte` — Approvers catalog screen.
- `src/lib/components/invoiceApprovalContract.test.ts` — source contracts for disclosure, ARIA, focus IDs, responsive layout, and preview wiring.

**Modify**

- `src/lib/db/db.ts`, `src/lib/db/tauri-adapter.ts`, `src-tauri/src/database.rs` — affected-row-aware atomic statement batches.
- `src/lib/db/schema.ts`, `src/lib/db/migrate.test.ts`, `src/lib/db/restore.ts`, `src/lib/db/restore.test.ts` — migration 5 and version-aware schema fingerprinting.
- `src/lib/types.ts`, `src/lib/ui/editorRow.ts` and LineItem test fixtures — approval fields and editor-only disclosure state.
- `src/lib/db/catalog-repo.ts`, `src/lib/db/catalog-repo.test.ts`, `src/lib/stores/catalog.ts`, `src/lib/components/CatalogManager.svelte`, `src/lib/components/AppShell.svelte` — approver lifecycle and navigation.
- `src/lib/validation.ts`, `src/lib/validation.test.ts` — shared invoice-level blockers.
- `src/lib/db/invoice-repo.ts`, `src/lib/db/invoice-repo.test.ts` — approval round-trip, atomic finalization, and clean duplication.
- `src/lib/components/FuzzyCombobox.svelte`, `src/lib/components/DatePicker.svelte` — reusable accessible invalid/error/focus contracts.
- `src/lib/components/InvoiceSection.svelte`, `src/routes/+page.svelte` — automatic approval strip and shared blocker consumption.
- `src/lib/components/InvoiceView.svelte`, `src/lib/pdf/invoiceDoc.ts`, `src/lib/pdf/invoiceDoc.test.ts` — preview/final/PDF evidence rows.
- `USER_GUIDE.md` — user-facing Approvers and mileage approval instructions.

---

### Task 1: Affected-row-aware atomic statement batches

**Files:**
- Modify: `src/lib/db/db.ts`
- Modify: `src/lib/db/tauri-adapter.ts`
- Modify: `src/lib/db/transaction.test.ts`
- Modify: `src-tauri/src/database.rs`

**Interfaces:**
- Produces: `DbStatement.expectedRowsAffected?: number`
- Produces: `Db.executeTransaction(statements): Promise<DbResult[]>`
- Produces: `executeStatementsAtomically(db, statements): Promise<DbResult[]>`
- Consumed by: Tasks 3 and 5 for deletion, duplication, and finalization rollback guarantees.

- [ ] **Step 1: Add a failing sql.js transaction expectation test**

Add to `src/lib/db/transaction.test.ts`:

```ts
test('rolls back when a statement affects an unexpected number of rows', async () => {
  const db = await createSqlJsDb();
  await db.execute('CREATE TABLE values_test (id INTEGER PRIMARY KEY, value INTEGER)');
  await db.execute('INSERT INTO values_test (id, value) VALUES (1, 10)');

  await expect(executeStatementsAtomically(db, [
    { sql: 'UPDATE values_test SET value = 20 WHERE id = 1', expectedRowsAffected: 1 },
    { sql: 'UPDATE values_test SET value = 30 WHERE id = 99', expectedRowsAffected: 1 },
  ])).rejects.toThrow(/expected 1 row.*affected 0/i);

  expect(await db.select('SELECT id, value FROM values_test')).toEqual([{ id: 1, value: 10 }]);
});
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `npx vitest run src/lib/db/transaction.test.ts`

Expected: FAIL because `expectedRowsAffected` is not defined/enforced.

- [ ] **Step 3: Extend the TypeScript transaction contract**

Implement in `src/lib/db/db.ts`:

```ts
export interface DbStatement {
  sql: string;
  params?: unknown[];
  expectedRowsAffected?: number;
}

export interface Db {
  execute(sql: string, params?: unknown[]): Promise<DbResult>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  executeTransaction?(statements: DbStatement[]): Promise<DbResult[]>;
  supportsSqlTransactions?: boolean;
}

function assertRowsAffected(statement: DbStatement, result: DbResult): void {
  if (
    statement.expectedRowsAffected !== undefined &&
    result.rowsAffected !== statement.expectedRowsAffected
  ) {
    throw new Error(
      `Expected ${statement.expectedRowsAffected} row(s) affected; affected ${result.rowsAffected}.`,
    );
  }
}

export async function executeStatementsAtomically(
  db: Db,
  statements: readonly DbStatement[],
): Promise<DbResult[]> {
  if (db.executeTransaction) {
    return db.executeTransaction(statements.map((statement) => ({
      sql: statement.sql,
      params: [...(statement.params ?? [])],
      expectedRowsAffected: statement.expectedRowsAffected,
    })));
  }
  if (!db.supportsSqlTransactions) {
    throw new Error('This database adapter does not support atomic transactions.');
  }
  const results: DbResult[] = [];
  await runInTransaction(db, async () => {
    for (const statement of statements) {
      const result = await db.execute(statement.sql, statement.params ?? []);
      assertRowsAffected(statement, result);
      results.push(result);
    }
  });
  return results;
}
```

Update transaction-capable test doubles in `src/lib/db/migrate.test.ts` to return `DbResult[]` and enforce `expectedRowsAffected` before committing.

- [ ] **Step 4: Add failing Rust rollback and structured-result tests**

In `src-tauri/src/database.rs`, extend the existing test module with one batch whose second statement expects one affected row but updates none. Assert the command returns an error, the first update rolls back, and a successful batch returns `rows_affected == 1` for each update.

- [ ] **Step 5: Implement the Rust command result contract**

Use these structures and enforce expectations before commit:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
    expected_rows_affected: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatementResult {
    rows_affected: u64,
    last_insert_id: i64,
}
```

After each `query.execute(...)`, compare `result.rows_affected()` with `expected_rows_affected`; return `Err(...)` immediately on mismatch so SQLx drops/rolls back the transaction. Return a `Vec<SqlStatementResult>` only after `transaction.commit()` succeeds. Change `execute_sqlite_transaction` to `Result<Vec<SqlStatementResult>, String>`.

Add `expected_rows_affected: None` to every existing Rust `SqlStatement` test literal and `expected_rows_affected: Some(1)` to the affected-row mismatch test's updates.

In `src/lib/db/tauri-adapter.ts`:

```ts
async executeTransaction(statements: DbStatement[]): Promise<DbResult[]> {
  return invoke<DbResult[]>('execute_sqlite_transaction', {
    db: dbFile,
    statements: statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params ?? [],
      expectedRowsAffected: statement.expectedRowsAffected,
    })),
  });
},
```

- [ ] **Step 6: Verify both transaction backends**

Run: `npx vitest run src/lib/db/transaction.test.ts src/lib/db/migrate.test.ts`

Expected: PASS.

Run: `cargo test database --manifest-path src-tauri/Cargo.toml`

Expected: PASS, including rollback on affected-row mismatch.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/db.ts src/lib/db/tauri-adapter.ts src/lib/db/transaction.test.ts src/lib/db/migrate.test.ts src-tauri/src/database.rs
git commit -m "Harden atomic database batches"
```

### Task 2: Migration 5, line-item types, and backup fingerprint

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/migrate.test.ts`
- Modify: `src/lib/db/restore.ts`
- Modify: `src/lib/db/restore.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ui/editorRow.ts`
- Modify fixtures in: `src/lib/lineOrder.test.ts`, `src/lib/pdf/generate.test.ts`, `src/lib/pdf/invoiceDoc.test.ts`, `src/lib/snapshot.test.ts`, `src/lib/totals.test.ts`, `src/lib/validation.test.ts`, `src/lib/db/invoice-repo.test.ts`
- Modify: `src-tauri/src/database.rs`

**Interfaces:**
- Produces: schema version 5 and `approvers` table.
- Produces on `LineItem`: `mileageApproverId`, `mileageApproverName`, `mileageApprovalDate`.
- Produces on `EditorRow`: `approvalCollapsed` editor-only state.

- [ ] **Step 1: Write failing migration and backup tests**

Add assertions that migration 5 creates the table, columns, unique index, and foreign key:

```ts
expect(await runMigrations(db)).toBe(5);
expect(await tableNames(db)).toContain('approvers');
expect((await db.select<{ name: string }>("SELECT name FROM pragma_table_info('line_items')"))
  .map((row) => row.name)).toEqual(expect.arrayContaining([
    'mileage_approver_id', 'mileage_approver_name', 'mileage_approval_date',
  ]));
const fks = await db.select<{ table: string; from: string; to: string }>('PRAGMA foreign_key_list(line_items)');
expect(fks).toEqual(expect.arrayContaining([
  expect.objectContaining({ table: 'approvers', from: 'mileage_approver_id', to: 'id' }),
]));
```

In `restore.test.ts`, import `MIGRATIONS`, create a genuine pre-v5 database, and add:

```ts
async function version4Db() {
  const db = await createSqlJsDb();
  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 4)) {
    for (const statement of migration.statements) await db.execute(statement);
    await db.execute(`PRAGMA user_version = ${migration.version}`);
  }
  return db;
}

test('accepts v4 without approvers but rejects a partial v5 schema', async () => {
  const old = await version4Db();
  expect((await validateBackup(old)).ok).toBe(true);

  const malformed = await goodDb();
  await malformed.execute('DROP INDEX idx_approvers_name_key');
  const check = await validateBackup(malformed);
  expect(check.ok).toBe(false);
  expect(check.reason).toMatch(/missing expected data/i);
});

test('rejects a v5 backup with a dangling approver reference', async () => {
  const db = await goodDb();
  await db.execute('PRAGMA foreign_keys = OFF');
  await db.execute("INSERT INTO invoices (id, year, status) VALUES (1, 2026, 'draft')");
  await db.execute(
    "INSERT INTO line_items (invoice_id, type, mileage_approver_id) VALUES (1, 'completed', 999)",
  );
  await db.execute('PRAGMA foreign_keys = ON');
  const check = await validateBackup(db);
  expect(check.ok).toBe(false);
  expect(check.reason).toMatch(/missing expected data/i);
});
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `npx vitest run src/lib/db/migrate.test.ts src/lib/db/restore.test.ts`

Expected: FAIL because schema version 5 and its fingerprint do not exist.

- [ ] **Step 3: Add migration 5 exactly once**

Append to `MIGRATIONS` in `src/lib/db/schema.ts`:

```ts
{
  version: 5,
  statements: [
    `CREATE TABLE approvers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE UNIQUE INDEX idx_approvers_name_key ON approvers(name_key)`,
    `ALTER TABLE line_items ADD COLUMN mileage_approver_id INTEGER REFERENCES approvers(id)`,
    `ALTER TABLE line_items ADD COLUMN mileage_approver_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE line_items ADD COLUMN mileage_approval_date TEXT NOT NULL DEFAULT ''`,
  ],
},
```

- [ ] **Step 4: Extend domain/editor types and all fixtures**

Add to `LineItem`:

```ts
mileageApproverId: number | null;
mileageApproverName: string;
mileageApprovalDate: string;
```

Add to `EditorRow`:

```ts
approvalCollapsed: boolean;
```

Initialize new rows with `null`, `''`, `''`, and `false`. For now, initialize loaded rows with `approvalCollapsed: false`; Task 4 will replace that with the shared completeness helper. Add the three persisted defaults to every LineItem fixture listed above.

- [ ] **Step 5: Implement the v5 restore fingerprint**

In `src/lib/db/restore.ts`, when `schemaVersion >= 5`, verify:

```ts
const approverColumns = new Set((await db.select<{ name: string }>(
  "SELECT name FROM pragma_table_info('approvers')",
)).map((row) => row.name));
const lineColumns = new Set((await db.select<{ name: string }>(
  "SELECT name FROM pragma_table_info('line_items')",
)).map((row) => row.name));
const indexes = await db.select<{ name: string; unique: number }>('PRAGMA index_list(approvers)');
const indexColumns = await db.select<{ name: string }>('PRAGMA index_info(idx_approvers_name_key)');
const foreignKeys = await db.select<{ table: string; from: string; to: string }>(
  'PRAGMA foreign_key_list(line_items)',
);
const foreignKeyErrors = await db.select('PRAGMA foreign_key_check');
```

Reject unless all required columns exist, the index is unique on only `name_key`, the expected FK exists, and `foreignKeyErrors.length === 0`. Keep v1–v4 acceptance unchanged.

- [ ] **Step 6: Add the native migration-path test**

In `src-tauri/src/database.rs`, create a v4-shaped SQLite database, call `execute_statements` with the exact five migration statements plus `PRAGMA user_version = 5`, and assert `table_info`, `foreign_key_list`, uniqueness, and user version. A second test appends a failing statement and asserts the table/columns/user version all roll back.

- [ ] **Step 7: Verify migration, restore, types, and native SQL**

Run: `npx vitest run src/lib/db/migrate.test.ts src/lib/db/restore.test.ts`

Expected: PASS with schema version 5.

Run: `npm run check`

Expected: PASS after every LineItem fixture is updated.

Run: `cargo test database --manifest-path src-tauri/Cargo.toml`

Expected: PASS on the native v4-to-v5 path and rollback case.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.test.ts src/lib/db/restore.ts src/lib/db/restore.test.ts src/lib/types.ts src/lib/ui/editorRow.ts src/lib/lineOrder.test.ts src/lib/pdf/generate.test.ts src/lib/pdf/invoiceDoc.test.ts src/lib/snapshot.test.ts src/lib/totals.test.ts src/lib/validation.test.ts src/lib/db/invoice-repo.test.ts src-tauri/src/database.rs
git commit -m "Add mileage approval schema"
```

### Task 3: First-class Approvers catalog

**Files:**
- Modify: `src/lib/db/catalog-repo.ts`
- Modify: `src/lib/db/catalog-repo.test.ts`
- Modify: `src/lib/stores/catalog.ts`
- Modify: `src/lib/components/CatalogManager.svelte`
- Create: `src/routes/approvers/+page.svelte`
- Modify: `src/lib/components/AppShell.svelte`

**Interfaces:**
- Produces: `CatalogTable = 'clients' | 'locations' | 'approvers'`.
- Produces: `loadApprovers()` and `addApprover(name)`.
- Consumed by: Task 7 invoice editor.

- [ ] **Step 1: Write failing approver repository tests**

Cover normalized reuse/reactivation and atomic deletion:

```ts
test('approver quick-add reuses and reactivates a normalized match', async () => {
  const db = await freshDb();
  const id = await addEntry(db, 'approvers', 'Jordan Lee');
  await setActive(db, 'approvers', id, false);
  expect(await addEntry(db, 'approvers', '  jordan lee ')).toBe(id);
  expect(await listEntries(db, 'approvers')).toEqual([
    { id, name: 'Jordan Lee', active: true },
  ]);
});

test('approver deletion detaches drafts but never finalized references', async () => {
  const db = await freshDb();
  const id = await addEntry(db, 'approvers', 'Jordan Lee');
  await db.execute("INSERT INTO invoices (id, year, status) VALUES (1, 2026, 'draft')");
  await db.execute(
    "INSERT INTO line_items (invoice_id, type, mileage_approver_id, mileage_approver_name) VALUES (1, 'completed', ?, 'Jordan Lee')",
    [id],
  );
  expect(await deleteEntryIfUnused(db, 'approvers', id)).toBe(true);
  expect(await db.select('SELECT mileage_approver_id, mileage_approver_name FROM line_items')).toEqual([
    { mileage_approver_id: null, mileage_approver_name: 'Jordan Lee' },
  ]);
});
```

Add finalized and void cases returning `false`, plus an injected delete failure proving draft detachment rolls back.

- [ ] **Step 2: Run the repository tests and confirm red**

Run: `npx vitest run src/lib/db/catalog-repo.test.ts`

Expected: FAIL because `approvers` is not a catalog type and no relation metadata exists.

- [ ] **Step 3: Add explicit catalog metadata and atomic delete**

In `catalog-repo.ts` use:

```ts
export type CatalogTable = 'clients' | 'locations' | 'approvers';

const CATALOGS = {
  clients: { referenceColumn: 'client_id', normalized: true, noun: 'client' },
  locations: { referenceColumn: 'location_id', normalized: false, noun: 'location' },
  approvers: { referenceColumn: 'mileage_approver_id', normalized: true, noun: 'approver' },
} as const satisfies Record<CatalogTable, {
  referenceColumn: string;
  normalized: boolean;
  noun: string;
}>;
```

Use `name_key` duplicate/reuse logic for clients and approvers. Implement deletion as one `executeStatementsAtomically` batch after the non-draft reference check:

```ts
await executeStatementsAtomically(db, [
  {
    sql: `UPDATE line_items SET ${column} = NULL
           WHERE ${column} = ? AND invoice_id IN
             (SELECT id FROM invoices WHERE status = 'draft')`,
    params: [id],
  },
  {
    sql: `DELETE FROM ${table} WHERE id = ? AND NOT EXISTS (
            SELECT 1 FROM line_items li JOIN invoices i ON i.id = li.invoice_id
            WHERE li.${column} = ? AND i.status != 'draft'
          )`,
    params: [id, id],
    expectedRowsAffected: 1,
  },
]);
```

If the batch fails, recheck non-draft references: return `false` only when such a reference now exists; otherwise rethrow.

- [ ] **Step 4: Add store functions, page, navigation, and accessible status copy**

Add:

```ts
export async function loadApprovers(): Promise<CatalogEntry[]> {
  return listEntries(await getDb(), 'approvers', { activeOnly: true });
}
export async function addApprover(name: string): Promise<number> {
  return addEntry(await getDb(), 'approvers', name);
}
```

Create `src/routes/approvers/+page.svelte`:

```svelte
<script lang="ts">
  import CatalogManager from '$lib/components/CatalogManager.svelte';
</script>

<CatalogManager
  table="approvers"
  title="Approvers"
  noun="approver"
  helper="People who can approve mileage charges on invoices."
  addLabel="Add an approver (e.g. Jordan Lee)"
  examples="Jordan Lee, Casey Morgan"
/>
```

Add `{ href: '/approvers', label: 'Approvers' }` after Locations in `AppShell.svelte`. Extend `CatalogManager` with a required `noun` prop, accessible input labels, `role="status" aria-live="polite"`, and noun-specific delete/deactivate messages.

- [ ] **Step 5: Verify catalog behavior and Svelte types**

Run: `npx vitest run src/lib/db/catalog-repo.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS with the new route and `noun` passed by Clients, Locations, and Approvers pages.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/catalog-repo.ts src/lib/db/catalog-repo.test.ts src/lib/stores/catalog.ts src/lib/components/CatalogManager.svelte src/lib/components/AppShell.svelte src/routes/clients/+page.svelte src/routes/locations/+page.svelte src/routes/approvers/+page.svelte
git commit -m "Add approver catalog"
```

### Task 4: Shared approval formatting and invoice finalization blockers

**Files:**
- Create: `src/lib/mileageApproval.ts`
- Create: `src/lib/mileageApproval.test.ts`
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/validation.test.ts`
- Modify: `src/lib/ui/editorRow.ts`

**Interfaces:**
- Produces: `mileageApprovalText(line: Partial<LineItem>): string | null`.
- Produces: `hasCompleteMileageApproval(line: Partial<LineItem>): boolean`.
- Produces: `invoiceFinalizeBlockers(draft: DraftInvoice): InvoiceFinalizeBlocker[]`.
- Consumed by: Tasks 5, 7, and 8.

- [ ] **Step 1: Write failing helper and blocker tests**

Create `mileageApproval.test.ts`:

```ts
test('formats only complete non-zero mileage approvals', () => {
  expect(mileageApprovalText({
    mileageCents: 1800,
    mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-07-18',
  })).toBe('Mileage approved by Jordan Lee on Jul 18, 2026');
  expect(mileageApprovalText({ mileageCents: 0 })).toBeNull();
  expect(mileageApprovalText({ mileageCents: 1800 })).toBeNull();
  expect(mileageApprovalText({
    mileageCents: 1800,
    mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-02-30',
  })).toBeNull();
});
```

Add this helper and the exact validation cases to `validation.test.ts`:

```ts
function draft(lines: LineItem[]): DraftInvoice {
  return {
    seq: null, year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19', lines,
  };
}

test('requires linked approver and valid date only for non-zero mileage', () => {
  const blockers = invoiceFinalizeBlockers(draft([line({
    mileageCents: 1800,
    mileageApproverId: null,
    mileageApproverName: '',
    mileageApprovalDate: '2026-02-30',
  })]));
  expect(blockers.map((blocker) => blocker.field)).toEqual([
    'mileageApprover', 'mileageApprovalDate',
  ]);
  expect(invoiceFinalizeBlockers(draft([line({ mileageCents: 0 })]))).toEqual([]);
});

test('requires at least one invoice row', () => {
  expect(invoiceFinalizeBlockers(draft([]))).toEqual([
    { lineIndex: null, field: 'invoice', message: 'Add at least one invoice row.' },
  ]);
});
```

- [ ] **Step 2: Run focused tests and confirm red**

Run: `npx vitest run src/lib/mileageApproval.test.ts src/lib/validation.test.ts`

Expected: FAIL because the helpers and invoice-level validator do not exist.

- [ ] **Step 3: Implement the legacy-safe formatter**

```ts
import type { LineItem } from './types';
import { formatIsoDate, isValidIsoDate } from './validation';

export function hasCompleteMileageApproval(line: Partial<LineItem>): boolean {
  return (line.mileageCents ?? 0) > 0
    && line.mileageApproverId != null
    && !!line.mileageApproverName?.trim()
    && isValidIsoDate(line.mileageApprovalDate ?? '');
}

export function mileageApprovalText(line: Partial<LineItem>): string | null {
  if ((line.mileageCents ?? 0) <= 0) return null;
  const name = line.mileageApproverName?.trim() ?? '';
  const date = line.mileageApprovalDate ?? '';
  if (!name || !isValidIsoDate(date)) return null;
  return `Mileage approved by ${name} on ${formatIsoDate(date)}`;
}
```

The printable helper intentionally tolerates an absent ID so immutable legacy/finalized JSON is render-safe; finalization validation separately requires the ID.

- [ ] **Step 4: Implement shared structured blockers**

In `validation.ts`:

```ts
export type InvoiceFinalizeField =
  | 'invoice' | 'inspectionNumber' | 'client' | 'location' | 'date' | 'vin8'
  | 'mileageApprover' | 'mileageApprovalDate';

export interface InvoiceFinalizeBlocker {
  lineIndex: number | null;
  field: InvoiceFinalizeField;
  message: string;
}

export function invoiceFinalizeBlockers(draft: DraftInvoice): InvoiceFinalizeBlocker[] {
  if (draft.lines.length === 0) {
    return [{ lineIndex: null, field: 'invoice', message: 'Add at least one invoice row.' }];
  }
  return draft.lines.flatMap((line, lineIndex) => {
    const blockers: InvoiceFinalizeBlocker[] = [];
    if (!line.inspectionNumber.trim()) blockers.push({ lineIndex, field: 'inspectionNumber', message: 'Enter an inspection number.' });
    if (!line.clientName.trim()) blockers.push({ lineIndex, field: 'client', message: 'Choose a client.' });
    if (!line.location.trim()) blockers.push({ lineIndex, field: 'location', message: 'Choose a location.' });
    if (!line.date.trim()) blockers.push({ lineIndex, field: 'date', message: 'Choose a date.' });
    if (!line.vin8.trim()) blockers.push({ lineIndex, field: 'vin8', message: 'Enter the last 8 of the VIN.' });
    if (line.mileageCents > 0) {
      if (line.mileageApproverId === null || !line.mileageApproverName.trim()) {
        blockers.push({ lineIndex, field: 'mileageApprover', message: 'Select a saved approver or choose Add new approver.' });
      }
      if (!isValidIsoDate(line.mileageApprovalDate)) {
        blockers.push({ lineIndex, field: 'mileageApprovalDate', message: 'Choose a valid approval date.' });
      }
    }
    return blockers;
  });
}
```

Keep `missingFinalizeFields(line)` as a compatibility wrapper whose stable labels now include `mileage approver` and `mileage approval date`.

Set `approvalCollapsed: hasCompleteMileageApproval(l)` in `toEditorRow`; new rows remain expanded (`false`).

- [ ] **Step 5: Verify helpers and blockers**

Run: `npx vitest run src/lib/mileageApproval.test.ts src/lib/validation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mileageApproval.ts src/lib/mileageApproval.test.ts src/lib/validation.ts src/lib/validation.test.ts src/lib/ui/editorRow.ts
git commit -m "Validate mileage approvals"
```

### Task 5: Invoice persistence, atomic finalization, and clean duplication

**Files:**
- Modify: `src/lib/db/invoice-repo.ts`
- Modify: `src/lib/db/invoice-repo.test.ts`
- Modify: `src/lib/snapshot.test.ts`

**Interfaces:**
- Consumes: Task 1 atomic batches, Task 2 fields, Task 4 blockers.
- Produces: approval-aware `saveDraft`, `loadDraft`, `finalizeInvoice`, and `duplicateInvoice`.

- [ ] **Step 1: Write failing persistence/finalization tests**

Add the following concrete cases around the existing `line()`/`freshDb()` helpers:

1. save/load round-trips ID, name, and date and resolves a renamed approver live;
2. invalid approval rejects before automatic allocation and before manual reservation;
3. an injected conditional-update failure rolls back `year_counters`, status, timestamp, totals, and snapshot;
4. finalized snapshot/reprint retains the old displayed approver after catalog rename/deactivation; and
5. duplicate clears all three fields for completed/no-show, positive/zero-mileage rows from draft/finalized/void sources.

```ts
test('round-trips a linked approval and resolves an approver rename in a draft', async () => {
  const db = await freshDb();
  const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
  const id = await createDraft(db, {
    year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19',
  });
  await saveDraft(db, id, {
    year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19',
    lines: [line({
      mileageCents: 1800, mileageApproverId: approverId,
      mileageApproverName: 'Jordan Lee', mileageApprovalDate: '2026-07-18',
    })],
  });
  await renameEntry(db, 'approvers', approverId, 'Jordan A. Lee');
  expect((await loadDraft(db, id)).lines[0]).toMatchObject({
    mileageApproverId: approverId,
    mileageApproverName: 'Jordan A. Lee',
    mileageApprovalDate: '2026-07-18',
  });
});

test('duplicate clears every approval field after copying each source row', async () => {
  const db = await freshDb();
  const approverId = await addEntry(db, 'approvers', 'Jordan Lee');
  const sourceId = await createDraft(db, {
    year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19',
  });
  const approved = {
    mileageApproverId: approverId,
    mileageApproverName: 'Jordan Lee',
    mileageApprovalDate: '2026-07-18',
  };
  await saveDraft(db, sourceId, {
    year: 2026, issueDate: '2026-07-20',
    periodStart: '2026-07-13', periodEnd: '2026-07-19',
    lines: [
      line({ type: 'completed', mileageCents: 1800, ...approved }),
      line({ type: 'noshow', mileageCents: 0, ...approved }),
    ],
  });
  const duplicateId = await duplicateInvoice(db, sourceId, {
    year: 2026, issueDate: '2026-07-27',
    periodStart: '2026-07-20', periodEnd: '2026-07-26',
  });
  expect((await loadDraft(db, duplicateId)).lines.map((row) => ({
    id: row.mileageApproverId,
    name: row.mileageApproverName,
    date: row.mileageApprovalDate,
  }))).toEqual([
    { id: null, name: '', date: '' },
    { id: null, name: '', date: '' },
  ]);
});
```

Use this assertion for invalid finalization:

```ts
await expect(finalizeInvoice(db, id)).rejects.toThrow(/saved approver/i);
expect(await db.select('SELECT * FROM year_counters')).toEqual([]);
expect(await db.select(
  'SELECT status, finalized_at, subtotal_cents, tax_cents, total_cents, snapshot_json FROM invoices WHERE id = ?',
  [id],
)).toEqual([{
  status: 'draft', finalized_at: null, subtotal_cents: 0,
  tax_cents: 0, total_cents: 0, snapshot_json: null,
}]);
```

Because repository validation is now authoritative, update older repository tests that finalize an empty draft (including `latestDraftId`) to save one complete zero-mileage line first. Update every existing non-zero-mileage finalization fixture to insert/select a real approver and supply a valid approval date; do not weaken the validator to preserve invalid fixtures.

- [ ] **Step 2: Run focused repository tests and confirm red**

Run: `npx vitest run src/lib/db/invoice-repo.test.ts src/lib/snapshot.test.ts`

Expected: FAIL because approval columns are not persisted and repository finalization does not validate.

- [ ] **Step 3: Round-trip the three fields**

Extend `LineRow`, the load SELECT/join, row mapping, and save INSERT. The insert column/value tail must be:

```ts
`..., mileage_cents, fee_cents,
       mileage_approver_id, mileage_approver_name, mileage_approval_date)
 VALUES (..., ?, ?, ?, ?, ?)`
```

with values:

```ts
l.mileageCents, l.feeCents,
l.mileageApproverId, l.mileageApproverName, l.mileageApprovalDate,
```

Load with `LEFT JOIN approvers a ON a.id = li.mileage_approver_id` and resolve linked draft names as `live_approver_name ?? stored_approver_name`.

- [ ] **Step 4: Replace sequential finalization with validated fixed statements**

Implement the full boundary:

```ts
export async function finalizeInvoice(db: Db, invoiceId: number): Promise<FinalizedSnapshot> {
  const draft = await loadDraft(db, invoiceId);
  const normalizedDraft = { ...draft, year: deriveInvoiceYear(draft.issueDate, draft.year) };
  const blockers = invoiceFinalizeBlockers(normalizedDraft);
  if (blockers.length) throw new Error(blockers[0].message);

  const settings = await getSettings(db);
  const seq = normalizedDraft.seq === null
    ? await peekNextSeq(db, normalizedDraft.year, invoiceId)
    : normalizedDraft.seq;
  if (normalizedDraft.seq !== null) {
    validateSeqResult(seq, await takenSeqs(db, normalizedDraft.year, invoiceId));
  }
  const snapshot = buildFinalizedSnapshot(normalizedDraft, settings, seq);

  await executeStatementsAtomically(db, [
    {
      sql: `INSERT INTO year_counters (year, last_seq) VALUES (?, ?)
            ON CONFLICT(year) DO UPDATE SET last_seq =
              CASE WHEN last_seq < excluded.last_seq THEN excluded.last_seq ELSE last_seq END`,
      params: [normalizedDraft.year, seq],
    },
    {
      sql: `UPDATE invoices SET
              seq = ?, year = ?, status = 'finalized', finalized_at = ?,
              subtotal_cents = ?, tax_cents = ?, total_cents = ?, snapshot_json = ?
            WHERE id = ? AND status = 'draft'
              AND NOT EXISTS (
                SELECT 1 FROM invoices other
                WHERE other.year = ? AND other.seq = ? AND other.id != ?
              )`,
      params: [
        seq, normalizedDraft.year, snapshot.issueDate,
        snapshot.totals.subtotalCents, snapshot.totals.taxCents, snapshot.totals.totalCents,
        JSON.stringify(snapshot), invoiceId,
        normalizedDraft.year, seq, invoiceId,
      ],
      expectedRowsAffected: 1,
    },
  ]);
  return snapshot;
}
```

- [ ] **Step 5: Make duplication atomic and clear approvals after the spread**

Load the source, select `COALESCE(MAX(id), 0) + 1 AS id`, then submit one atomic batch containing an explicit-ID invoice insert and one line insert per mapped source line. Map with:

```ts
const copied = src.lines.map((line, position) => ({
  ...line,
  position,
  mileageApproverId: null,
  mileageApproverName: '',
  mileageApprovalDate: '',
}));
```

Every invoice and line INSERT carries `expectedRowsAffected: 1`. Return the explicit destination ID only after the batch succeeds.

- [ ] **Step 6: Verify repository invariants**

Run: `npx vitest run src/lib/db/invoice-repo.test.ts src/lib/snapshot.test.ts`

Expected: PASS, including rollback and immutable reprint cases.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/invoice-repo.ts src/lib/db/invoice-repo.test.ts src/lib/snapshot.test.ts
git commit -m "Persist and finalize mileage approvals"
```

### Task 6: Accessible reusable selector and date controls

**Files:**
- Modify: `src/lib/components/FuzzyCombobox.svelte`
- Modify: `src/lib/components/DatePicker.svelte`
- Create: `src/lib/components/invoiceApprovalContract.test.ts`

**Interfaces:**
- Produces on `FuzzyCombobox`: `inputId`, `required`, `invalid`, `error`, `onEdited` props.
- Produces on `DatePicker`: `fieldId`, `required`, `invalid`, `errorId`, `onChange` props.
- Consumed by: Task 7.

- [ ] **Step 1: Write failing source-contract tests**

Create a CRLF-safe source reader and exact contracts:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readSource = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('invoice approval component contracts', () => {
  test('combobox exposes selection and validation semantics', () => {
    const source = readSource('src/lib/components/FuzzyCombobox.svelte');
    for (const contract of [
      'role="combobox"', 'aria-autocomplete="list"', 'aria-expanded={open}',
      'aria-controls=', 'aria-activedescendant=', 'aria-invalid={invalid}',
      'aria-describedby=', 'aria-required={required}', 'id={inputId}',
      'role="listbox"', 'role="option"',
    ]) expect(source).toContain(contract);
    expect(source).toContain('{#if error}');
  });

  test('date picker exposes stable focus and validation hooks', () => {
    const source = readSource('src/lib/components/DatePicker.svelte');
    expect(source).toContain('id={fieldId}');
    expect(source).toContain("${ariaLabel}${required ? ' (required)' : ''}");
    expect(source).toContain('aria-invalid={invalid}');
    expect(source).toContain('aria-describedby={errorId || undefined}');
  });
});
```

- [ ] **Step 2: Run the contract test and confirm red**

Run: `npx vitest run src/lib/components/invoiceApprovalContract.test.ts`

Expected: FAIL on the missing ARIA and prop contracts.

- [ ] **Step 3: Implement the combobox contract**

Extend props:

```ts
inputId = `cb-${Math.random().toString(36).slice(2)}`,
required = false,
invalid = false,
error = '',
onEdited = () => {},
```

Give the listbox and each option stable IDs derived from `inputId`. Add to the input:

```svelte
id={inputId}
role="combobox"
aria-autocomplete="list"
aria-expanded={open}
aria-controls={`${inputId}-listbox`}
aria-activedescendant={open && options[highlight] ? `${inputId}-option-${highlight}` : undefined}
aria-invalid={invalid}
aria-describedby={error ? `${inputId}-error` : undefined}
aria-required={required}
```

Call `onEdited()` from raw input and commit paths. Render `error` with its stable ID instead of the generic unlinked copy when provided. Keep existing Arrow/Enter/Escape/Tab semantics and exact-match-on-blur behavior.

- [ ] **Step 4: Implement the date trigger contract**

Add the documented props, call `onChange()` from `pick`, bind `id={fieldId}`, and expose:

```svelte
aria-label={`${ariaLabel}${required ? ' (required)' : ''}`}
aria-invalid={invalid}
aria-describedby={errorId || undefined}
```

- [ ] **Step 5: Verify component contracts and Svelte checks**

Run: `npx vitest run src/lib/components/invoiceApprovalContract.test.ts src/lib/ui/combobox.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/FuzzyCombobox.svelte src/lib/components/DatePicker.svelte src/lib/components/invoiceApprovalContract.test.ts
git commit -m "Make invoice approval controls accessible"
```

### Task 7: Automatic mileage approval strip in the invoice editor

**Files:**
- Modify: `src/lib/components/InvoiceSection.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/invoiceApprovalContract.test.ts`

**Interfaces:**
- Consumes: approver catalog/store, shared blockers, editor fields, and Task 6 control props.
- Produces: deterministic automatic disclosure UI and preview wiring.

- [ ] **Step 1: Extend the failing source contract**

Extend the contract with these exact source assertions for `InvoiceSection`:

- receives `approvers` and `addApprover`;
- renders `mileage-approval-{row.uid}` as `grid-column: 1 / -1`;
- uses an actual button with `aria-expanded`/`aria-controls` for the collapsed summary;
- passes stable `mileage-approver-{uid}` and `mileage-approval-date-{uid}` IDs;
- has a container query or equivalent one-column fallback; and
- removes clipping from the card/menu path.

```ts
const section = readSource('src/lib/components/InvoiceSection.svelte');
expect(section).toContain('approvers: CatalogEntry[]');
expect(section).toContain('addApprover: (name: string) => Promise<number>');
expect(section).toContain('id="mileage-approval-{row.uid}"');
expect(section).toContain('aria-expanded={!row.approvalCollapsed}');
expect(section).toContain('aria-controls="mileage-approval-{row.uid}"');
expect(section).toContain('inputId={`mileage-approver-${row.uid}`}');
expect(section).toContain('fieldId={`mileage-approval-date-${row.uid}`}');
expect(section).toContain('grid-column: 1 / -1');
expect(section).toContain('container-type: inline-size');
expect(section).toContain('overflow: visible');
```

Add route assertions:

```ts
const route = readSource('src/routes/+page.svelte');
expect(route.match(/<InvoiceSection/g)).toHaveLength(2);
expect(route).toContain('{approvers} {addApprover}');
expect(route).toContain('invoiceFinalizeBlockers(buildDraft())');
expect(route).toContain('mileage-approver-${row.uid}');
expect(route).toContain('mileage-approval-date-${row.uid}');
expect(route).toContain('<InvoiceView snap={previewSnap} preview />');
```

- [ ] **Step 2: Run the contract and confirm red**

Run: `npx vitest run src/lib/components/invoiceApprovalContract.test.ts`

Expected: FAIL because the strip and route wiring do not exist.

- [ ] **Step 3: Load and persist approvers in the route**

Load `approvers = await loadApprovers()` on mount, refresh after `addApprover`, pass both to each `InvoiceSection`, and include all three fields in `buildDraft()`.

Derive:

```ts
const finalizeBlockers = $derived(invoiceFinalizeBlockers(buildDraft()));
const blockedLineIndices = $derived(new Set(
  finalizeBlockers.flatMap((blocker) => blocker.lineIndex === null ? [] : [blocker.lineIndex]),
));
const blockerCount = $derived(blockedLineIndices.size);
const canFinalize = $derived(finalizeBlockers.length === 0 && seqState.status === 'ready');
```

For `jumpToBlocker`, expand the row, `await tick()`, then focus `mileage-approver-${uid}` or `mileage-approval-date-${uid}` for approval fields; retain the existing first-input fallback for other fields.

- [ ] **Step 4: Render deterministic row-local disclosure**

In `InvoiceSection`, on mileage input capture the prior cents value. If it transitions from zero to positive, set `row.approvalCollapsed = false`; positive-to-positive preserves state. Compute approval blockers per row. Render incomplete strips expanded with no collapse button. Complete strips remain expanded until the user presses the summary/disclosure button; loaded complete rows arrive collapsed from `toEditorRow`.

Use the control props from Task 6:

```svelte
<FuzzyCombobox
  label="Approved by"
  noun="approver"
  entries={approvers}
  onAddNew={addApprover}
  inputId={`mileage-approver-${row.uid}`}
  required
  invalid={approverInvalid}
  error={approverInvalid ? 'Select a saved approver or choose Add new approver.' : ''}
  onEdited={() => (row.approvalCollapsed = false)}
  bind:selectedId={row.mileageApproverId}
  bind:text={row.mileageApproverName}
/>
```

Use the date control with `fieldId`, `required`, `invalid`, `errorId`, and an `onChange` that keeps the strip expanded.

Set `.card { overflow: visible; container-type: inline-size; }`, `.approval-strip { grid-column: 1 / -1; }`, and stack fields under a container query that preserves usable widths. Retain card borders/radii without clipping menus.

- [ ] **Step 5: Verify unit/source contracts**

Run: `npx vitest run src/lib/components/invoiceApprovalContract.test.ts src/lib/validation.test.ts src/lib/ui/combobox.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Visually verify the editor**

Run the web app, open it in the in-app browser, and verify at 900×720 plus standard/large/extra-large text:

- first, middle, and final rows in Completed and No-Shows;
- zero-to-positive expansion without focus theft;
- incomplete strip cannot collapse;
- completion stays expanded until explicit collapse;
- positive-to-positive changes preserve state;
- zero-to-positive restores retained values expanded;
- fuzzy menu and date popover are not clipped; and
- keyboard Arrow/Enter/Escape/Tab behavior plus blocker focus.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/InvoiceSection.svelte src/routes/+page.svelte src/lib/components/invoiceApprovalContract.test.ts
git commit -m "Add mileage approval editor"
```

### Task 8: Preview, finalized invoice, and PDF evidence rows

**Files:**
- Modify: `src/lib/components/InvoiceView.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/pdf/invoiceDoc.ts`
- Modify: `src/lib/pdf/invoiceDoc.test.ts`
- Modify: `src/lib/components/invoiceApprovalContract.test.ts`

**Interfaces:**
- Consumes: `mileageApprovalText` from Task 4.
- Produces: `InvoiceView` prop `preview?: boolean` and structurally correct secondary rows.

- [ ] **Step 1: Write failing renderer tests**

In `invoiceDoc.test.ts`, inspect the table body rather than only collected text. For a complete mileage row assert:

```ts
expect(approvalRow[0]).toMatchObject({
  text: 'Mileage approved by Jordan Lee on Jul 18, 2026',
  colSpan: 8,
});
expect(approvalRow).toHaveLength(8);
expect(approvalRow.slice(1)).toEqual(Array(7).fill(''));
```

Assert the row immediately follows its owning charge, is unnumbered, works in completed/no-show tables, is absent from seven-column zero-mileage tables, and is absent for a legacy mileage snapshot with all approval properties missing.

Extend the component contract to require `preview`, `colspan={columnCount}`, the exact preview-only `Mileage approval required` copy, and the shared helper.

- [ ] **Step 2: Run renderer tests and confirm red**

Run: `npx vitest run src/lib/pdf/invoiceDoc.test.ts src/lib/components/invoiceApprovalContract.test.ts`

Expected: FAIL because no secondary rows or preview flag exist.

- [ ] **Step 3: Implement `InvoiceView` rows**

Accept `preview = false`. For every charge row, render the owning `<tr>` followed immediately by:

```svelte
{@const approvalText = mileageApprovalText(l)}
{#if approvalText || (preview && l.mileageCents > 0)}
  <tr class="mileage-approval">
    <td colspan={mileage ? 8 : 7}>
      {approvalText ?? 'Mileage approval required'}
    </td>
  </tr>
{/if}
```

Style it as secondary evidence without a row number. Pass `preview` only from the draft preview overlay: `<InvoiceView snap={previewSnap} preview />`. Finalized routes keep the default `false`.

- [ ] **Step 4: Implement pdfmake span rows**

After each mileage-bearing charge row:

```ts
const approvalText = mileageApprovalText(line);
if (approvalText) {
  body.push([
    { text: approvalText, colSpan: widths.length, style: 'approval' },
    ...Array(widths.length - 1).fill(''),
  ]);
}
```

Define `widths` before building body rows so the same array determines `colSpan`. Add a muted `approval` style.

- [ ] **Step 5: Verify rendering**

Run: `npx vitest run src/lib/pdf/invoiceDoc.test.ts src/lib/components/invoiceApprovalContract.test.ts src/lib/pdf/generate.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/InvoiceView.svelte src/routes/+page.svelte src/lib/pdf/invoiceDoc.ts src/lib/pdf/invoiceDoc.test.ts src/lib/components/invoiceApprovalContract.test.ts
git commit -m "Print mileage approval evidence"
```

### Task 9: User guide, full verification, and final review

**Files:**
- Modify: `USER_GUIDE.md`
- Verify: all files changed by Tasks 1–8

**Interfaces:**
- Consumes: the complete feature.
- Produces: documented, release-ready branch.

- [ ] **Step 1: Document the user workflow**

Add this user-facing section, matching final UI copy exactly:

```markdown
## Mileage approvals

When a row has a mileage charge above $0.00, Invoice Maker opens a Mileage approval section beneath that row. Choose **Approved by** from your saved Approvers—or use **Add new approver** in the search list—then choose the actual approval date. Both values are required before the invoice can be locked and saved.

Completed approvals can be collapsed to a one-line summary. Changing the mileage amount keeps the approval. A finalized invoice and its PDF print “Mileage approved by [name] on [date]” beneath the charge.

Use **Approvers** in the sidebar to rename, hide, or remove names. Names used on finalized or cancelled invoices are kept for history and can only be made inactive. Duplicating an invoice clears mileage approvals so the new invoice must record fresh approval.
```

- [ ] **Step 2: Run formatting and static checks**

Run: `git diff --check`

Expected: no output.

Run: `npm run check`

Expected: `0 errors and 0 warnings`.

- [ ] **Step 3: Run the complete frontend test suite**

Run: `npm test`

Expected: all Vitest files and tests pass.

- [ ] **Step 4: Run the production frontend build**

Run: `npm run build`

Expected: Vite/SvelteKit build succeeds.

- [ ] **Step 5: Run native verification**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: success.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust/SQLx tests pass.

- [ ] **Step 6: Run a clean finalization smoke test**

In the app, create one completed and one no-show mileage line, quick-add/select approvers, choose dates, preview, finalize, reopen from History, and generate the PDF. Confirm each approval sentence is beneath the owning charge, totals are unchanged, and duplicating the invoice clears both approvals.

- [ ] **Step 7: Run independent review**

Review the branch diff against `docs/superpowers/specs/2026-07-20-mileage-approval-design.md`. Resolve every P0/P1 finding, rerun the affected focused test, then rerun Steps 2–5 after the last code change.

- [ ] **Step 8: Commit documentation and final fixes**

```bash
git add USER_GUIDE.md
git commit -m "Document mileage approvals"
```

If review fixes changed code, stage only those reviewed files and create a separate `Fix mileage approval review findings` commit before the final verification rerun.
