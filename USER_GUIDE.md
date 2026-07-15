# Invoice Maker — User Guide

A simple guide to installing and using **Invoice Maker** on your Windows PC. No technical knowledge needed — just follow the stages in order.

Invoice Maker lets you:
- Build invoices for completed inspections and no‑shows.
- Save them as tidy PDFs you can email or print.
- Keep a history of every invoice and pull tax summaries.
- Automatically back up all your data.

Everything stays **on your computer** — nothing is uploaded anywhere.

---

## Stage 1 — Install the app

1. Open the downloads/releases page you were given (the **Releases** page on GitHub).
2. Download the latest **Invoice Maker** installer (the `.exe` or `.msi` file).
3. Double‑click the downloaded file to run it.
4. If Windows shows a blue **“Windows protected your PC”** box, click **More info → Run anyway**. (This appears for new apps; it’s safe to proceed.)
5. Follow the installer. When it finishes, open **Invoice Maker** from the Start menu or desktop.

You only do this once. Future updates install themselves (see **Stage 9**).

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

On the **left** is the menu:

| Menu item | What it’s for |
|---|---|
| **New Invoice** | Create the invoice you’re working on now |
| **History** | See, reprint, or duplicate past invoices; tax summaries |
| **Clients** | Manage your list of clients (add, rename, hide) |
| **Locations** | Manage your list of inspection locations |
| **Settings** | Your details, prices, theme, text size, save folder, updates |

The menu stays in place while you scroll. Your name and the last backup time show at the bottom of the menu.

---

## Stage 4 — Create an invoice

Open **New Invoice**. It starts as a **draft** (a yellow “DRAFT — not sent yet” tag) and **autosaves as you type**, so you won’t lose work.

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

**4c. Add no‑shows**
The **No‑Shows** section works the same way (default $25 each), without mileage.

**Put rows in date order**

Rows stay exactly where they are while you type. When you are ready, click **Sort rows by date** to arrange Completed Inspections and No-Shows separately from oldest to newest. Opening Preview also sorts the visible rows first, so closing Preview returns to the same order you reviewed. Lock & Save uses this date order automatically. Rows from the same day stay in their current order.

**4d. Watch the totals**
The bar at the bottom always shows **Subtotal**, **HST**, and **Total** as you go. A note like “Date is outside the billing period” is just a friendly heads‑up — it does **not** stop you from saving.

---

## Stage 5 — Finish and create the PDF

1. When the invoice is complete, click **Lock & Save** (bottom right).
2. The app finalizes the invoice, assigns its number (e.g. `#3‑2026`), and **saves a PDF** to your save folder.
3. A message shows **where it saved**, with options to **open** it or **show the folder**.

Once locked, the invoice becomes a permanent record. You can always reprint it from History.

> Where do PDFs go? By default your **Downloads** folder. You can change this in **Settings → Where files are saved**.

---

## Stage 6 — History, reprints & tax summaries

Open **History** to see every finalized invoice, grouped by year.

- **View an invoice:** click its **number** (e.g. `#3‑2026`) or the **View** button.
- **Download PDF again:** click **Download PDF** on any row.
- **Duplicate:** click **Duplicate** to start a new invoice pre‑filled from an old one.
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

---

## Stage 8 — Backups (automatic)

Invoice Maker protects your data automatically:

- A full backup (`invoice-backup.db`) is saved **every time you finalize an invoice**.
- You can back up any time from **Settings → Where files are saved → Back up now**. The last backup time shows at the bottom of the left menu.

**Strongly recommended:** in **Settings**, set your save folder to a **Dropbox**, **OneDrive**, or **Google Drive** folder. Then every PDF and backup is copied off your computer automatically — so you’re safe even if the PC fails.

---

## Stage 9 — Updates

You don’t need to download new versions manually.

- When you open the app, it checks for a newer version and **offers to update** with one click (it installs and restarts itself).
- You can also check on demand: **Settings → About & updates → Check for updates**.

---

## Settings reference

Everything you can adjust, in **Settings**:

- **Display** — Dark/Light theme and text size (Normal / Large / Extra‑large).
- **Where files are saved** — choose your PDF + backup folder, open it, or back up now.
- **You / your business** — your name, address, inspector number.
- **Tax** — HST registration number and tax rate (default 13%).
- **Default prices** — completed and no‑show fees.
- **Who you bill** — the company name and address invoices are billed to.
- **Invoice footer** — payment email and a footer note.
- **About & updates** — your version number and the update checker.

---

## Quick troubleshooting

| Question | Answer |
|---|---|
| **“Windows protected your PC” when installing** | Click **More info → Run anyway**. Normal for new apps. |
| **My PDF didn’t appear** | Check the folder shown in the save message, or **Settings → Where files are saved → Open this folder**. |
| **“Date is outside the billing period” warning** | Just informational — it won’t stop you saving or finalizing. |
| **I cancelled an invoice by accident** | History → red **Cancelled invoices** button → **Restore**. |
| **Text is too small to read** | **Settings → Display → Large** or **Extra‑large**. |
| **Is my data safe / backed up?** | Yes — it backs up on every save. Point the save folder at Dropbox/OneDrive for an off‑machine copy. |
| **How do I get the newest version?** | It updates itself on launch, or use **Settings → Check for updates**. |

---

Need a change or run into something not covered here? Note the exact steps and what you expected, and pass it along — it can be fixed in an update.
