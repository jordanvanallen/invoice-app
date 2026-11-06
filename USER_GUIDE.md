# Invoice Maker — User Guide

A simple guide to installing and using **Invoice Maker** on Windows or Mac. No technical knowledge needed — just follow the stages in order.

Invoice Maker lets you:
- Build invoices for completed inspections and no‑shows.
- Create expense reports with separate **Vehicle expenses** and **General/Admin expenses** sections.
- Keep car mileage reports: dated trips with start and end odometer readings for one vehicle.
- Save them as tidy PDFs you can email or print.
- Keep separate histories for invoices, expense reports, and mileage reports, and pull invoice tax summaries.
- Automatically back up all your data.

Everything stays **on your computer** — nothing is uploaded anywhere.

---

## Stage 1 — Install the app

### Windows

1. Open the downloads/releases page you were given (the **Releases** page on GitHub).
2. Download the latest **Invoice Maker** installer (the `.exe` or `.msi` file).
3. Double‑click the downloaded file to run it.
4. If Windows shows a blue **“Windows protected your PC”** box, click **More info → Run anyway**. (This appears for new apps; it’s safe to proceed.)
5. Follow the installer. When it finishes, open **Invoice Maker** from the Start menu or desktop.

### macOS

The **universal `.dmg`** works on both Apple silicon and Intel Macs. For the Mac installation fix, use **v0.3.3 or newer**.

1. Open the [official Invoice Maker Releases page](https://github.com/jordanvanallen/invoice-app/releases/latest) and download the Mac file ending in **`_universal.dmg`**.
2. Double-click the DMG. Drag **Invoice Maker** into the **Applications** folder shown in the window. If replacing v0.3.2, quit the old app first and choose **Replace** when Finder asks.
3. Open **Applications** in Finder and double-click **Invoice Maker** there. Once copied, you can eject the disk image.
4. If macOS says the developer cannot be verified or Apple cannot check the app for malicious software, dismiss the warning. Open **Apple menu → System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway** for Invoice Maker.
5. Confirm **Open** and enter your Mac login password if asked. After this app-specific approval, you can open the app normally. If **Open Anyway** is missing, try opening the app from Applications again, then return to Privacy & Security.

The app has a signature that checks its files for changes, but it has **not been notarized by Apple**. This is why the first-open approval is required. Approve only the copy downloaded from the official release above. See [Apple's instructions for opening an app from an unknown developer](https://support.apple.com/en-ca/guide/mac-help/mh40616/mac).

**Upgrading from the damaged v0.3.2 Mac build:** replace the app using these steps. Your invoices and settings are stored separately from the app. If a fresh v0.3.3 or newer copy still reports that it is **damaged**, report the exact warning and your macOS version so it can be investigated.

Future updates are offered inside the app (see **Stage 9**).

---

## Stage 2 — First‑time setup

The very first time you open the app, it walks you through a short **“Let’s set up your invoices”** screen.

Fill in:
- **Your name / business** — appears on every invoice.
- **HST registration number** — required to charge HST; printed on each invoice.

Click to continue when done. You can change any of this later in **Settings**.

> Tip: prefer a bigger, easier‑to‑read interface? Go to **Settings → Display** and choose **Large** or **Extra‑large** text. The whole app resizes to match.

---

## Stage 3 — Get comfortable with the screen

On the **left** is the menu, grouped into sections:

| Section | Menu items | What they’re for |
|---|---|---|
| **Invoices** | **New Invoice**, **History** | Create the invoice you’re working on now; see, reprint, or duplicate past invoices and get tax summaries |
| **Expenses** | **New Expense Report**, **History** | Create the expense report you’re working on now; see, reprint, duplicate, cancel, or restore expense reports |
| **Car Mileage** | **New Mileage Report**, **History** | Record trips and odometer readings; see, reprint, cancel, or restore mileage reports |
| **Lists** | **Clients**, **Locations**, **Approvers** | Manage the names you pick from on invoices (add, rename, hide) |
| **Settings** | **General**, **Backups** | Your details, prices, theme, text size, PDF folder, and updates; backup folder, **Back up now**, and restoring a backup |

In this guide, **Expenses → History** means the **History** item in the **Expenses** section. The menu stays in place while you scroll (if it is taller than your window, the menu scrolls by itself). Your name and the last backup time show at the bottom of the menu.

---

## Stage 4 — Create an invoice

Open **New Invoice**. It starts as a **draft** (a yellow “DRAFT — not sent yet” tag) and **autosaves as you type**, so you won’t lose work.

If more than one unfinished invoice is saved (for example after duplicating one), a yellow bar above the invoice lets you choose which draft to continue, or discard the one you’re editing after confirming. The open invoice is saved first; if that save fails, nothing is switched or discarded until it saves.

**4a. Set the dates (top of the page)**
- **Billing period** — the *From* and *To* dates the invoice covers. Click a date field, pick a day on the calendar, and it closes. From and To are independent — set each one.
- **Invoice date** — the date on the invoice itself (defaults to today).

**4b. Add completed inspections**
In the **Completed Inspections** section, click **+ Add inspection** to add a row, then fill it in:
- **Inspection #** — type it in.
- **Client** — start typing; matching clients appear. Pick one, or choose **“Add … as new client.”**
- **Location** — same as client.
- **Date** — pick the inspection date (it may be a future date — that’s allowed).
- **Last 8 of VIN** — the last 8 characters.
- **Mileage** — optional, billable add‑on.
- **Fee** — pre‑filled with your default ($38); change it if needed.

Press **Enter** on the Fee box to quickly start the next row. To remove a row, click the **✕**. Removed a row by accident? An **Undo** appears.

Each VIN and each inspection # can be billed as a **completed** inspection only once — once on this invoice and once across all your locked invoices, in any year. If one repeats, the row shows a note saying where, and **Lock & Save** stays off until you fix it. Your draft still saves while you sort it out.

**4c. Add no‑shows**
The **No‑Shows** section works the same way (default $25 each), including optional mileage. Any mileage charge requires the same **Approved by** and **Approval date** details described below.

A no‑show gets rescheduled, so it never uses up a VIN or inspection #: the same vehicle can be a no‑show as many times as needed, on the same invoice as its completed inspection, or even after it was completed.

**Put rows in date order**

Rows stay exactly where they are while you type. When you are ready, click **Sort rows by date, then inspection #** to arrange Completed Inspections and No-Shows separately from oldest to newest; rows from the same day are ordered by inspection number. Opening Preview also sorts the visible rows first, so closing Preview returns to the same order you reviewed. Lock & Save uses this order automatically.

**4d. Watch the totals**
The bar at the bottom always shows **Subtotal**, **HST**, and **Total** as you go. A note like “Date is outside the billing period” is just a friendly heads‑up — it does **not** stop you from saving. (A repeated VIN or inspection # on a completed row is different: see 4b.)

---

## Mileage approvals

When a row has a mileage charge above $0.00, Invoice Maker opens a Mileage approval section beneath that row. Choose **Approved by** from your saved Approvers—or use **Add new approver** in the search list—then choose the actual approval date. Both values are required before the invoice can be locked and saved.

Completed approvals can be collapsed to a one-line summary. Changing the mileage amount keeps the approval. A finalized invoice and its PDF print “Mileage approved by [name] on [date]” beneath the charge.

Use **Approvers** in the sidebar to rename, hide, or remove names. Names used on finalized or cancelled invoices are kept for history and can only be made inactive. Duplicating an invoice clears mileage approvals so the new invoice must record fresh approval.

---

## Stage 5 — Finish and create the PDF

1. When the invoice is complete, click **Lock & Save** (bottom right).
2. The app finalizes the invoice, assigns its number (e.g. `#3‑2026`), and **saves a PDF** to your save folder.
3. A message shows **where it saved**, with options to **open** it or **show the folder**.

Once locked, the invoice becomes a permanent record. You can always reprint it from History.

> Where do PDFs go? By default your **Downloads** folder, filed in a folder for each year (for example `2026-invoices`). You can change this in **Settings → General → Where PDFs are saved**; the same folder holds your expense and mileage report PDFs.

### Create an expense report

1. Open **Expenses → New Expense Report**. The latest unfinished report opens automatically and autosaves as you work.
2. Check the **report number**, **report date**, and **reporting period** at the top.
3. The report has two sections, like an invoice: **Vehicle expenses** and **General/Admin expenses**. Click **+ Add a vehicle expense** or **+ Add a general/admin expense** to add a row to that section, then fill in its **Date**, **Description**, and **Amount**. Use the **✕** to remove a row. If you remove one by accident, choose **Undo**.
4. Put a row in the wrong section? Click its arrow button (**↓** in Vehicle expenses, **↑** in General/Admin expenses) to move it to the other section. Everything you typed moves with it.
5. Each section shows its own **subtotal**, and the report **total** is the two subtotals added together. A report needs at least one expense, but either section may be left empty.
6. Rows stay still while you type. Click **Sort rows by date, then description** to arrange each section from oldest to newest; rows from the same day are ordered by description. Opening **Preview** also sorts the editor first, so closing Preview returns to the same order you reviewed.
7. Click **Lock & Save** when every row is complete. The app sorts each section by date, then description, creates a PDF showing both sections with their subtotals and the total, files it in that year’s folder (for example `2026-expenses`), and backs up your data.

Locked expense reports cannot be edited. Open **Expenses → History** to view or save the PDF again, duplicate one into a new editable draft, or cancel and restore a report. Cancelled expense reports are kept in a separate **Cancelled expense reports** section and do not count in yearly expense totals.

Expense reports locked before sections were added keep their original single list of rows, so viewing or saving their PDF again shows them exactly as they were saved. Rows in a report that was still unfinished at that time start in **General/Admin expenses**; move any vehicle costs with the arrow button. Duplicating an older report also places its rows in **General/Admin expenses**, where you can move vehicle costs before locking the new report.

The app keeps one unfinished expense report at a time so work cannot get hidden. Finish it before duplicating a saved report.

### Create a car mileage report

Car mileage reports are a separate log of the kilometres you drive, with their own numbers and history. They are not the optional **Mileage** charge on invoice rows described above.

1. Open **Car Mileage → New Mileage Report**. Your unfinished mileage report opens automatically and autosaves as you work, so you can close the app and finish it later.
2. Check the **reporting period** and **report date**, and enter the **Vehicle** (for example the make, model, or plate).
3. Click **+ Add a trip** for each trip and fill in its **Date**, **From**, **To**, **Purpose**, **Start odometer (km)**, and **End odometer (km)**. Readings are whole kilometres. The trip’s distance and the report’s total are calculated for you.
4. You can leave an odometer reading blank until you have it — blank is not the same as **0**, which counts as a real reading. Your draft keeps saving even if a reading is missing or the end reading is still lower than the start; that trip shows a note, and its distance shows **—** until both readings are complete.
5. Remove a trip with the **✕** (choose **Undo** if that was a mistake). Click **Sort trips by date** to arrange them from oldest to newest.
6. When the report is complete, click **Preview** to check it, then **Lock & Save**. Locking needs the vehicle and, for every trip, a date inside the reporting period, a From, To, and Purpose, and both readings with the end reading greater than the start. Until then, click the warning link beside **Lock & Save** to jump to the first thing that needs attention.
7. Locking gives the report its own number (for example `1-2026`), counted separately from invoices and expense reports and starting again each year. The app creates its PDF in that year’s mileage folder (for example `2026-mileage`) and backs up your data.

Mileage reports record distances only. They do not calculate a reimbursement amount or apply any per‑kilometre, tax, or legal rate.

Locked mileage reports cannot be edited. Open **Car Mileage → History** to view a report or save its PDF again, or to cancel and restore one. Cancelled mileage reports are kept, not deleted, and can be restored later.

---

## Stage 6 — History, reprints & tax summaries

Open **Invoices → History** to see every finalized invoice, grouped by year.

- **View an invoice:** click its **number** (e.g. `#3‑2026`) or the **View** button.
- **Download PDF again:** click **Download PDF** on any row.
- **Duplicate:** click **Duplicate** to start a new invoice pre‑filled from an old one. Change the VIN and inspection # on its completed rows before locking it, since each can be billed only once.
- **Tax summary for a year:** each year has **Export tax summary**.
- **Tax summary for a date range:** use the **From / To** date boxes at the top and click **Export** — handy for quarterly or custom periods.

---

## Stage 7 — Cancel and restore invoices

Made an invoice by mistake, or need to void one?

1. Open the invoice (from History) and click **Cancel invoice**, then confirm.
2. It’s marked **cancelled**, removed from your totals and the main list — but **not deleted**.

To bring one back:

1. On the **History** page, click the red **“⟲ Cancelled invoices (N)”** button at the top right (it appears whenever you have cancelled invoices).
2. The cancelled list opens — click **Restore** on the one you want. It returns to your History and totals.

Cancelled invoices stay in your records and don’t count toward income or HST until restored.

Cancelling an invoice frees its completed VINs and inspection #s so you can bill them on another invoice. **Restore** checks them again: if one is now on another locked invoice (or appears twice on the cancelled one), Restore explains which and leaves the invoice cancelled. Cancel the other invoice first if this is the one to keep.

---

## Stage 8 — Backups (automatic)

Invoice Maker protects your data automatically:

- A full backup is saved **every time you lock an invoice, expense report, or mileage report**, as a dated file (`invoice-backup-YYYY-MM-DD.db`). The 14 most recent are kept.
- You can back up any time from **Settings → Backups → Back up now**. The last backup time shows at the bottom of the left menu.
- To bring back your data from a backup — for example on a new computer — use **Settings → Backups → Restore from a backup**. The app checks the file first, shows what it contains (including how many invoices, expense reports, and mileage reports were locked), and saves a copy of your current data before replacing it.

**Strongly recommended:** set **Settings → Backups → Where backups are saved** (and, if you like, **Settings → General → Where PDFs are saved** for PDFs) to a **Dropbox**, **OneDrive**, or **Google Drive** folder. Then your backups and PDFs are copied off your computer automatically — so you’re safe even if the PC fails.

---

## Stage 9 — Updates

After installation, the app can download updates for you. If the old v0.3.2 Mac app cannot open, first install the replacement DMG using **Stage 1**.

- When you open the app, it checks for a newer version and **offers to update** with one click (it installs and restarts itself).
- You can also check on demand: **Settings → About & updates → Check for updates**.
- When an update adds new features, the app upgrades your saved data automatically the first time it opens. There is nothing to set up, and your existing invoices, expense reports, and settings are kept exactly as they were.
- Updates only move forward. An older version of the app cannot restore a backup made by a newer one, so don’t reinstall an older version to undo an update. If something looks wrong after updating, install the next update when it is offered, or restore a backup you made before updating.

---

## Settings reference

Everything you can adjust, in **Settings → General**:

- **Display** — Dark/Light theme and text size (Normal / Large / Extra‑large).
- **Where PDFs are saved** — choose the folder for all your PDFs (invoices, expense reports, and mileage reports), or open it.
- **You / your business** — your name, address, inspector number.
- **Tax** — HST registration number and tax rate (default 13%).
- **Default prices** — completed and no‑show fees.
- **Who you bill** — the company name and address invoices are billed to.
- **Invoice footer** — payment email and a footer note.
- **About & updates** — your version number and the update checker.

And in **Settings → Backups**: where backups are saved, **Back up now**, and **Restore from a backup**.

---

## Quick troubleshooting

| Question | Answer |
|---|---|
| **“Windows protected your PC” when installing** | Click **More info → Run anyway**. Normal for new apps. |
| **Mac says the developer cannot be verified or Apple cannot check the app** | After copying the official release to **Applications** and trying to open it, use **System Settings → Privacy & Security → Open Anyway**. See **Stage 1 → macOS**. |
| **Mac says v0.3.2 is damaged** | Download the v0.3.3 or newer universal DMG from the official Releases page and replace the old app using **Stage 1 → macOS**. |
| **My PDF didn’t appear** | Check the folder shown in the save message, or **Settings → General → Where PDFs are saved → Open this folder**. |
| **“Date is outside the billing period” warning** | Just informational — it won’t stop you saving or finalizing. |
| **Lock & Save says a VIN or inspection # was already billed** | Each completed inspection can be billed once. The note names the invoice that has it; fix the row, or cancel that invoice first if it was the mistake. No‑shows never cause this. |
| **I cancelled an invoice by accident** | **Invoices → History** → red **Cancelled invoices** button → **Restore**. |
| **I cancelled an expense report by accident** | **Expenses → History** → **Cancelled expense reports** → **Restore**. |
| **I cancelled a mileage report by accident** | **Car Mileage → History** → find it among the cancelled mileage reports → **Restore**. |
| **I can’t lock my mileage report** | Every trip needs both odometer readings in whole kilometres, the end reading greater than the start, and a date inside the reporting period. |
| **An expense is in the wrong section** | Click the row’s arrow button to move it between **Vehicle expenses** and **General/Admin expenses**. |
| **It says “Couldn’t save — retrying” and won’t let me leave the page** | Your latest changes are still on screen and it keeps trying to save them; the app won’t switch pages until they’re saved, so nothing is lost. Try again once it shows **Saved**. (An invalid invoice number doesn’t cause this: the rest of the invoice still saves, and the last valid number is kept until you fix it.) |
| **Text is too small to read** | **Settings → Display → Large** or **Extra‑large**. |
| **Is my data safe / backed up?** | Yes — it backs up every time you lock an invoice or report, and whenever you choose **Back up now**. Point **Settings → Backups → Where backups are saved** at Dropbox/OneDrive for an off‑machine copy. |
| **How do I get the newest version?** | It updates itself on launch, or use **Settings → Check for updates**. |

---

Need a change or run into something not covered here? Note the exact steps and what you expected, and pass it along — it can be fixed in an update.
