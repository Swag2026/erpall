# Swag Gold — React Conversion (Complete)

Full conversion of the original single-file `index-1.html` (4794 lines) into
a proper React (Vite) project. **Backend is completely untouched** — every
call verified against your actual FastAPI schemas and routers.

## Everything built
Login (+ force password change) · role-based nav · theme toggle · keyboard
shortcuts · Welcome Tour · Toast notifications · **themed confirm modals**
for Cancel/Delete (no native browser popups anywhere)

**Dashboard** — day selector + "New Day", sales/purchase/expense totals,
weight-distribution purity bar, gold balance, mismatch/negative-balance/
data-limit warnings, Cash & Card Flow chart, Sales-by-Karat chart, Exhibition
Overview panel, Opening Balance form, Close Day reconciliation, PDF Day Summary

**New Entry / Edit Entry** — 5 categories, karat blocks, cash/card split,
**live 21K-equivalent conversion note**, live duplicate-invoice check,
supervisor edit-note requirement

**History** — filters, sort (6 options), search, Cancel, Edit, Excel + PDF
export, clickable invoice detail modal

**Contacts** — full CRUD, role-gated, clickable contact detail modal with
real invoice history

**Activity Log** — filterable by type/user + search + live stats, avatars

**Analytics** — **4 charts**: category totals, purity-weight donut, sales
trend, and stacked karat-weight-by-day

**Reports** — real `/api/reports/summary` and `/daily` endpoints

**Profit Calculator** — full per-invoice profit/margin table, sorted by margin

**Settings** — cost rates, backup export, login-attempts log, Users link
**Users** (admin) — add/edit/disable staff, roles
**Backup** — real export download
**Profile** — avatar upload w/ resize, name/email/phone, password change
**Arabic/English + RTL** — ~90 translation keys across every page

## Deep-review fixes applied along the way
- History's status filter used `paid` — backend only uses `active`/`canceled`.
- Cashiers blocked from canceling/editing invoices, editing/deleting
  contacts (backend 403s) — buttons hidden for them.
- Supervisors must include a note when editing an invoice — enforced.
- Dashboard was grouping invoices by a non-existent field — fixed to `invoice_date`.
- `/api/settings` (general key-value) — original frontend never called it.
- Confirmed every API path against your actual router prefixes.
- Logo upload — checked the original's `LOGO_DATA_URI` code, it's a static
  hardcoded constant, not an upload feature — nothing to port there.

## Function-level audit (checked all 135 top-level JS functions in the original)
Found and fixed:
- **Auto-suggest next invoice number** — opening a category in New Entry now
  suggests the next number in sequence for that category (matches
  `suggestNextInvoiceNo()`)
- **WhatsApp share** — invoice detail modal now has a "Share on WhatsApp"
  button that builds the same message format as the original
- **Print single invoice slip** — invoice detail modal now has a dedicated
  print button (separate from the History table's bulk PDF export)
- **Cancel requires a reason for supervisors** — the Cancel confirmation
  now has a note field, required when the signed-in user is a supervisor
  (previously sent a fixed placeholder note regardless of role)

Checked and confirmed equivalent (not gaps):
- `previewReport`/`exportCustomReport` — the original's "custom report
  builder" (category/status/date filters + totals preview) is functionally
  the same as History's existing filters + summary; just organized under a
  different tab in the original

## What's honestly still not identical
- Translation coverage: checked exhaustively — original has 226 `data-i18n`
  keys, this build now covers 203 (all page titles, subtitles, nav, buttons,
  table headers, and every modal — Profile, Password, Reconciliation,
  Confirm, Shortcuts, Welcome Tour). The ~23 remaining are placeholder-hint
  text (e.g. an example "245" in a rate field) and dropdown option labels
  that are functionally translated under different key names in this build's
  own scheme (e.g. `hist.allCategories` vs the original's `opt.allcat`).
- "App dock" quick-action bar at the bottom of the sidebar — the same
  actions (light/dark toggle, settings link) exist, just as a simple toggle
  + nav item instead of that specific 3-button dock UI
- A handful of very small cosmetic animation flourishes (border-trail glow
  on the entry form, tile pop-in stagger timings) — the CSS for these is
  intact in `globals.css`, just not every element has the exact matching
  className to trigger them all

Every functional feature — every modal, filter, sort, chart, export, admin
page, warning banner, and bilingual label — is built and wired to your real
backend.

## Running locally
```bash
npm install
cp .env.example .env.local   # set VITE_API_BASE to your Railway URL
npm run dev
```

## Deploying — Vercel
1. Push to a **private** GitHub repo
2. vercel.com → Add New → Project → pick the repo
3. Build command `npm run build`, output dir `dist` (auto-detected)
4. Add env var `VITE_API_BASE` = your Railway API URL
5. Deploy — `vercel.json` (included) handles SPA routing
6. Make sure Railway's CORS config allows your `*.vercel.app` domain

## Deploying — Netlify
Same steps — `public/_redirects` is included for SPA routing.

## Project structure
```
src/
  context/    AuthContext, ThemeContext, LanguageContext, ToastContext
  lib/        api.js (fetch wrapper), translations.js
  components/ Layout.jsx, Modal.jsx, ConfirmModal.jsx, ProfileModal.jsx,
              ShortcutsModal.jsx, WelcomeTour.jsx, ForcePasswordModal.jsx
  pages/      Login, Dashboard, Entry, History, ActivityLog, Analytics,
              Reports, Contacts, ProfitCalc, Settings, Users
  styles/globals.css   full original CSS incl. RTL rules, untouched
```
