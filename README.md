# Invoice Maker

A small, offline desktop app for creating vehicle-inspection invoices, expense reports, and car mileage reports. It runs on Windows for the end user and is developed on Linux. Built with **Tauri 2 + SvelteKit + TypeScript**, with a local **SQLite** database and **PDF** generation.

- **Product name:** Invoice Maker
- **Bundle identifier:** `com.app.invoice`
- **Release version:** injected from each `v*` Git tag by the release workflow
- **Repo:** `git@github.com:jordanvanallen/invoice-app.git`

> Looking for how to *use* the finished app? See **[USER_GUIDE.md](./USER_GUIDE.md)**. This README is for building and releasing it.

---

## What it does

- Two‑section invoice editor — **Completed inspections** ($38 each) and **No‑shows** ($25 each), both configurable.
- Fuzzy client/location pickers with “add new” inline.
- Automatic fee + HST + total math (money stored as integer cents, tax as basis points).
- Generates a clean PDF and keeps an immutable snapshot of every finalized invoice for faithful reprints.
- Creates separately numbered expense reports with **Vehicle expenses** and **General/Admin expenses** sections (rows can move between them), per-section subtotals, reporting-period validation, immutable PDFs, and a separate history. Reports finalized before sections existed keep their original single list on reprint.
- Creates standalone, separately numbered **car mileage reports**: a vehicle plus dated trips (from, to, purpose, start/end odometer in whole kilometres) with calculated distances and totals, draft autosave/resume, preview, lock, PDFs filed under `YYYY-mileage/`, and a history with view, reprint, cancel, and restore. Distances only — no reimbursement, per-km, tax, or legal rates.
- History with per‑year and custom date‑range tax summaries.
- Cancel (void) / restore invoices without losing history.
- Auto-backup of the database on finalization; configurable save folder (point it at Dropbox/OneDrive for off-machine copies).
- Dark/light themes, three text sizes, and in‑app auto‑updates from GitHub Releases.

## Tech stack

| Area | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | SvelteKit (`adapter-static`, SPA, `ssr=false`), Svelte 5 runes, TypeScript |
| Data | SQLite via `tauri-plugin-sql` (tests use `sql.js`) |
| PDF | `pdfmake` 0.3 |
| Plugins | `fs`, `dialog`, `opener`, `process`, `updater` |
| Tests | Vitest (pure logic and repositories on in-memory `sql.js`); `cargo test` (native SQLite transactions and shipped migrations) |

## Repository layout

```
<repo root>/                       # the app lives at the root
├─ .github/workflows/release.yml   # CI: builds + signs the Windows installer on v* tags
├─ src/                            # SvelteKit frontend
│  ├─ routes/                      # invoice/expense/mileage editors, histories, detail pages, catalogs, backups, settings
│  ├─ lib/components/              # DatePicker, FuzzyCombobox, InvoiceSection, AppShell, …
│  ├─ lib/db/                      # repositories, DB adapter, append-only migrations (schema.ts), restore checks
│  ├─ lib/pdf/                     # pdfmake document builders
│  └─ app.css                      # design tokens (colors, spacing, type scale)
├─ src-tauri/                      # Rust shell, tauri.conf.json, capabilities
└─ package.json
```

---

## Stage 1 — Prerequisites

You need **Rust**, **Node 20+**, and (on Linux) the Tauri system libraries.

1. **Rust** — install via [rustup](https://rustup.rs/):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node 20+** — from [nodejs.org](https://nodejs.org/) or `nvm`.
3. **Linux system deps** (Debian/Ubuntu example — adjust for your distro). Tauri 2 needs WebKitGTK 4.1 and friends:
   ```bash
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```
   On Windows the end user needs nothing extra — WebView2 ships with the OS.

## Stage 2 — Clone & install

```bash
git clone git@github.com:jordanvanallen/invoice-app.git
cd invoice-app
npm install
```

## Stage 3 — Run in development

From the repo root:

```bash
# Linux (Wayland): the flag is REQUIRED or the webview crashes
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

> **`Error 71 (Protocol error) dispatching to Wayland display`** means you forgot the `WEBKIT_DISABLE_DMABUF_RENDERER=1` flag. It is a **Linux‑dev‑only** workaround; the shipped Windows build needs nothing.

Frontend‑only preview (no Rust shell, no SQLite/PDF): `npm run dev`.

## Stage 4 — Verify before committing

```bash
npm run check     # svelte-check — aim for 0 errors / 0 warnings
npm test          # Vitest unit tests
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check   # Rust formatting
cargo test --manifest-path src-tauri/Cargo.toml --locked          # native SQLite + migration tests
```

These are the same checks the release workflow runs before building. The version‑7 native migration tests replay the migrations straight from `src/lib/db/schema.ts`, so they exercise exactly the statements that ship.

The GUI itself can’t be verified headlessly; rely on `check` + `test` here and a visual pass via `tauri dev`.

## Stage 5 — Build

```bash
npm run tauri build
```

This produces installers for the **current OS** under `src-tauri/target/release/bundle/`. Building a **Windows** installer from Linux is not done locally — Windows artifacts are produced by CI on `windows-latest` (see Stage 6). A local Linux build yields `.deb`/AppImage instead.

---

## Stage 6 — Release & auto‑update

The installed app checks `https://github.com/jordanvanallen/invoice-app/releases/latest/download/latest.json` on launch (and via **Settings → Check for updates**). Publishing a signed release is what feeds that endpoint.

**One‑time setup (per repo):**

1. The updater **signing keypair** already exists:
   - Private key: `~/.tauri/invoice-app-updater.key` (generated with *no* password).
   - Public key: embedded in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
2. Add the private key as a **GitHub Actions secret** named `TAURI_SIGNING_PRIVATE_KEY`:
   - Value = the full contents of `~/.tauri/invoice-app-updater.key`.
   - Set it at **repo → Settings → Secrets and variables → Actions** (use the web UI if your `gh` login lacks admin on the personal repo).

**Cutting a release:**

1. Merge the reviewed release commit to `main` and make sure the worktree is clean.
2. Tag that commit with the next version and push it. The workflow injects the tag version into `package.json` and `src-tauri/tauri.conf.json` before building:
   ```bash
   git tag v0.1.5
   git push origin v0.1.5
   ```
3. `.github/workflows/release.yml` runs on `windows-latest`, checks the app, builds and signs the installer with `TAURI_SIGNING_PRIVATE_KEY`, and publishes a GitHub Release containing the installer and `latest.json`.
4. Verify the workflow, installer, and `latest.json`. Installed apps then detect the release and offer the update.

> ⚠️ **Don’t lose or rotate away the private key without re‑issuing signed builds.** If the key is lost, already‑installed apps can no longer verify updates and would need a manual reinstall.

---

## Data, storage & permissions

- **Database:** SQLite in the OS app‑data dir (`$APPDATA` on Windows). Created on first launch and upgraded automatically at startup whenever a new version needs it — no manual setup.
- **Schema migrations:** `src/lib/db/schema.ts` is append‑only; never edit a shipped version, add the next one. At startup each pending version runs as one transaction together with its `PRAGMA user_version` stamp, so an upgrade either completes or leaves the previous version untouched. Version 7 adds the expense `category` column (existing rows become `general`) and the mileage tables, preserving all existing data. Downgrades are not supported — an older build will not restore a newer backup — so recovering from a bad release means shipping a fixed version or restoring a pre‑upgrade backup.
- **Output folder:** PDFs save to the user’s **Downloads** by default, or the folder chosen in **Settings → General**. Invoices and reports are filed by year (`2026-invoices/`, `2026-expenses/`, `2026-mileage/`); summaries go in `tax-summaries/` and `expense-summaries/`.
- **Backups:** a dated full DB copy (`invoice-backup-YYYY-MM-DD.db`, last 14 kept) is written on finalize and via **Settings → Backups → Back up now** (uses SQLite `VACUUM INTO`), in the backup folder chosen there.
- **Restore:** **Settings → Backups → Restore from a backup** validates the file in its own connection — integrity, a supported schema version, the objects that version requires, and that the pending upgrades can apply — then swaps it in on relaunch after saving the current data to `invoice-before-restore.db`.
- **Filesystem scope:** `capabilities/default.json` restricts `fs` write/remove to `$HOME`, `$DOWNLOAD`, and `$APPDATA`.

## Troubleshooting (dev)

| Symptom | Cause / fix |
|---|---|
| `Error 71 … Wayland display` | Add `WEBKIT_DISABLE_DMABUF_RENDERER=1` (Linux dev only). |
| `better-sqlite3` / node‑gyp build fails | Expected — tests use `sql.js`. Don’t add better‑sqlite3. |
| PDF “Open” does nothing on Linux | No default PDF app in the dev environment; not an issue on Windows (Edge opens PDFs). |
| Updater never offers an update | Confirm the `TAURI_SIGNING_PRIVATE_KEY` secret is set and the Release contains `latest.json`. |

## License

MIT.
