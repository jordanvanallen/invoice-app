# Invoice Maker

A small, offline desktop app for creating vehicle-inspection invoices and expense reports. Releases are available for **Windows** and **macOS (Apple silicon and Intel)**; development also supports Linux. Built with **Tauri 2 + SvelteKit + TypeScript**, with a local **SQLite** database and **PDF** generation.

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
- Creates separately numbered expense reports with dated rows, reporting-period validation, immutable PDFs, and a separate history.
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
| Tests | Vitest (pure logic: money, totals, numbering, validation, snapshot) |

## Repository layout

```
<repo root>/                       # the app lives at the root
├─ .github/workflows/release.yml   # CI: Windows + universal macOS releases on v* tags
├─ src/                            # SvelteKit frontend
│  ├─ routes/                      # invoice/expense editors, histories, detail pages, catalogs, backups, settings
│  ├─ lib/components/              # DatePicker, FuzzyCombobox, InvoiceSection, AppShell, …
│  ├─ lib/db/                      # repositories + DB adapter
│  ├─ lib/pdf/                     # pdfmake document builders
│  └─ app.css                      # design tokens (colors, spacing, type scale)
├─ src-tauri/                      # Rust shell, tauri.conf.json, capabilities
└─ package.json
```

---

## Stage 1 — Prerequisites

You need **Rust**, **Node 20+**, and the build tools for your OS.

1. **Rust** — install via [rustup](https://rustup.rs/):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node 20+** — from [nodejs.org](https://nodejs.org/) or `nvm`.
3. **macOS:** install Xcode Command Line Tools with `xcode-select --install`. To build the universal Mac release, install both Rust targets:
   ```bash
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   ```
4. **Linux system deps** (Debian/Ubuntu example — adjust for your distro). Tauri 2 needs WebKitGTK 4.1 and friends:
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
# macOS / Windows
npm run tauri dev

# Linux (Wayland): the flag is REQUIRED or the webview crashes
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

> **`Error 71 (Protocol error) dispatching to Wayland display`** means you forgot the `WEBKIT_DISABLE_DMABUF_RENDERER=1` flag. It is a **Linux‑dev‑only** workaround.

Frontend‑only preview (no Rust shell, no SQLite/PDF): `npm run dev`.

## Stage 4 — Verify before committing

```bash
npm run check     # svelte-check — aim for 0 errors / 0 warnings
npm test          # Vitest unit tests
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

The GUI itself can’t be verified headlessly; rely on `check` + `test` here and a visual pass via `tauri dev`.

## Stage 5 — Build

```bash
npm run tauri build
```

This produces installers for the **current OS** under `src-tauri/target/release/bundle/`. CI builds Windows installers on Windows and Mac installers on macOS (see Stage 6). A local Linux build yields `.deb`/AppImage instead.

On a Mac, build a universal app and DMG for both Apple silicon and Intel:

```bash
npm run tauri build -- --target universal-apple-darwin
codesign --verify --deep --strict --verbose=2 "src-tauri/target/universal-apple-darwin/release/bundle/macos/Invoice Maker.app"
```

The bundle uses **ad-hoc signing** (`bundle.macOS.signingIdentity: "-"`). This seals the complete app bundle so macOS can validate its integrity. It does **not** identify the developer to Apple or notarize the app, so a downloaded copy still needs the app-specific first-open approval described in [USER_GUIDE.md](./USER_GUIDE.md#macos). Gatekeeper assessment is expected to reject an unapproved, unnotarized copy even when `codesign --verify` passes.

The published v0.3.2 Mac app had an incomplete signature and failed verification with `code has no resources but signature indicates they must be present`. Release v0.3.3 signs the complete bundle and adds release checks for the packaged Mac app. Do not modify the app after signing it.

---

## Stage 6 — Release & auto‑update

The installed app checks `https://github.com/jordanvanallen/invoice-app/releases/latest/download/latest.json` on launch (and via **Settings → Check for updates**). Publishing a release with updater-signed artifacts feeds that endpoint. **Updater signatures are separate from OS code signing:** they authenticate app updates, but do not provide Windows publisher verification or Apple notarization.

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
   git tag v0.3.3
   git push origin v0.3.3
   ```
3. `.github/workflows/release.yml` checks and builds Windows installers and a **universal Mac DMG**. It signs updater artifacts with `TAURI_SIGNING_PRIVATE_KEY`, verifies the Mac bundle signature and architectures, and holds the release as a draft until both platform builds and release checks succeed.
4. The workflow publishes the complete release with installers, updater artifacts, signatures, and `latest.json`. Confirm the release contains updater entries for Windows and both Mac architectures. Installed apps then detect the release and offer the update.
5. Test the downloaded DMG on a Mac: copy **Invoice Maker** into **Applications**, open it there, and complete the one-time **System Settings → Privacy & Security → Open Anyway** approval. Follow the [Mac installation guide](./USER_GUIDE.md#macos). A build launched directly from the local build folder does not exercise the downloaded-app approval flow.

> ⚠️ **Don’t lose or rotate away the private key without re‑issuing signed builds.** If the key is lost, already‑installed apps can no longer verify updates and would need a manual reinstall.

---

## Data, storage & permissions

- **Database:** SQLite in the OS app‑data dir (`$APPDATA` on Windows). Created and migrated on first launch.
- **Output folder:** PDFs and the `invoice-backup.db` copy save to the user’s **Downloads** by default, or a folder they choose in Settings (e.g. a Dropbox/OneDrive folder for off‑machine backups).
- **Backups:** a full DB copy is written on finalize and via **Settings → Back up now** (uses SQLite `VACUUM INTO`).
- **Filesystem scope:** `capabilities/default.json` restricts `fs` write/remove to `$HOME`, `$DOWNLOAD`, and `$APPDATA`.

## Troubleshooting (dev)

| Symptom | Cause / fix |
|---|---|
| `Error 71 … Wayland display` | Add `WEBKIT_DISABLE_DMABUF_RENDERER=1` (Linux dev only). |
| `better-sqlite3` / node‑gyp build fails | Expected — tests use `sql.js`. Don’t add better‑sqlite3. |
| PDF “Open” does nothing on Linux | No default PDF app in the dev environment; not an issue on Windows (Edge opens PDFs). |
| Updater never offers an update | Confirm the `TAURI_SIGNING_PRIVATE_KEY` secret is set and the Release contains `latest.json`. |
| macOS says the developer cannot be verified | The Mac release is ad-hoc signed and unnotarized. Install it in Applications and use the app-specific **Open Anyway** flow in the [user guide](./USER_GUIDE.md#macos). |
| macOS says v0.3.2 is damaged | Replace the app with the v0.3.3 or newer DMG from this repository's Releases page. Verify the new app bundle with `codesign --verify --deep --strict --verbose=2` if investigating a continuing failure. |

## License

MIT.
