# 🍺 AdvancePOS — Beer Shop POS & Inventory Management System

A production-ready, multi-user POS for a beer shop: fast billing, live stock,
verified cash/UPI payments, thermal-print bills, Excel reporting, role-based
access and full audit trails. **Firebase is the single source of truth** — every
device syncs in real time; no business data lives in browser storage.

**Stack:** React 18 + TypeScript + Vite · Firebase (Auth, Firestore, Storage, optional Cloud Functions) · GitHub Pages hosting.

---

## 1. What's inside

| Module | Where | Highlights |
|---|---|---|
| POS billing | `src/pages/POS.tsx` | search/category filters, live stock on tiles, qty & per-line/bill discounts, tax, 1-click cash, UPI pending→verify flow, low-stock warnings, duplicate-sale protection |
| Inventory | `src/pages/Inventory.tsx` | CRUD, soft-delete, ± adjustments, per-product low-stock threshold, full movement ledger, Excel/CSV import + bulk price update |
| Purchases | `src/pages/Purchases.tsx` | stock-in recording that updates cost price, period export |
| Transactions | `src/pages/Transactions.tsx` | verify/fail pending UPI, refunds (stock-unsafe delete impossible), reprint |
| Reports | `src/pages/Reports.tsx` | today/month, cash-vs-UPI pie, daily bar chart, best sellers, low stock, inventory value, profit — all exportable |
| Users & permissions | `src/pages/Users.tsx` | developer/admin/manager/cashier presets + per-user overrides, deactivate, reset emails |
| Settings | `src/pages/Settings.tsx` | shop identity, logo (Storage), UPI, tax, invoice prefix, paper size, categories, thresholds, password change, backup/restore, audit viewer |
| Services | `src/services/` | every money/stock mutation is an atomic Firestore transaction with an audit entry |

## 2. Two ways to run

**Local mode (zero setup):** with no `.env` present, the app boots in local
mode — all features work (billing, inventory, payments flow, users, reports,
Excel, printing, backup JSON), data persists in this browser's localStorage.
Seeded logins: `dev@local` / `devpass123` (developer) and `staff@local` /
`staff1234` (cashier), plus sample products. Ideal for trying everything out.

**Cloud mode (multi-device, recommended for real use):** the moment
`VITE_FIREBASE_*` keys exist in `.env`, the app runs against Firebase
(Firestore live sync, Auth, Storage, security rules). Local-mode data does not
migrate automatically — export it via Settings → Download backup (JSON) before
switching, then restore it after signing in to Firebase mode (user accounts are
re-created via the Users panel; products/settings/movements restore as-is).

## 2a. Environment setup (required for cloud mode — 10 minutes)

No credentials are committed. Create `.env` from `.env.example` with your
Firebase web-app config:

1. [console.firebase.google.com](https://console.firebase.google.com) → **Create project** (name e.g. `advancepos`; Google Analytics optional).
2. **Build → Authentication → Sign-in method → Email/Password** → Enable.
3. **Build → Firestore Database → Create** (production mode; region `asia-south1` recommended).
4. **Build → Storage → Get started** (production mode).
5. **Project settings → General → Your apps → `</>`** → register a web app → copy the config keys into `.env`.
6. Set `VITE_DEVELOPER_EMAILS` to your own email (comma-separated if more than one).

## 3. First developer bootstrap (one-time, ~2 minutes)

The developer role can never be granted by client code alone — that's what
keeps it secure. After first run:

1. Sign up once in the app? No — instead: **Authentication → Add user** in the
   Firebase console with your developer email + a strong password.
2. **Firestore → collection `users` → Add document** — Document ID = the UID shown
   on that Auth user (click the UID to copy it), fields:
   ```
   name: "Your Name"        (string)
   email: "you@example.com" (string, same as Auth)
   role:  "developer"       (string)
   permOverrides: {}        (map)
   active: true             (boolean)
   createdAt: <millis>      (number, e.g. 1730000000000)
   createdBy: "bootstrap"   (string)
   lastActiveAt: <millis>   (number)
   ```
3. Sign in at the app. The discreet developer entry is the **`·`** dot on the
   login card (or `/login?dev=1`) — it only admits accounts listed in
   `VITE_DEVELOPER_EMAILS` *that also hold* `role: "developer"` in Firestore.
4. From there, create staff accounts in **Users**. Everyone else signs in normally.

## 4. Security rules (required)

Publish these before real use:

```bash
npm i -g firebase-tools   # if not installed
firebase login
firebase init firestore storage   # select existing project; files already exist here
firebase deploy --only firestore:rules,storage:rules
```

Or paste `firestore.rules` / `storage.rules` in the console. Composite indexes
(`firestore.indexes.json`) deploy with `firebase deploy --only firestore:indexes`
— or just click the index link Firestore prints in the toast/console on first use.

## 5. Payment verification model (important)

Showing/scanning a QR **never** confirms payment. Two supported workflows:

- **Built-in staff confirmation (default, zero dependencies):** a UPI bill is
  created as `pending` — customer scans the QR → cashier checks *their own
  UPI/bank app* → taps "✔ Payment received". Stock deducts atomically at that
  instant. If stock ran out meanwhile, the sale is auto-marked failed.
- **Gateway-grade automation (optional):** `functions/razorpayWebhook` verifies
  Razorpay webhook signatures server-side and settles the sale. Requires a
  Razorpay merchant account + Blaze plan. See `functions/index.js`.

## 6. Thermal printing

Bill layout renders at **58 mm or 80 mm** (Settings → paper size) and prints via
the browser dialog — works with Bluetooth/USB thermal printers on Windows,
macOS, Linux and Android (Chrome): choose the thermal printer, paper "Roll /
Receipt". "Save as PDF" in the same dialog is the invoice-download option.
Reprint any bill from **Transactions → View / Print**.

## 7. Excel / CSV

- **Reports & Transactions/Purchases/Inventory pages:** one-click `.xlsx`
  exports (summary + detail sheets) for the selected date range.
- **Inventory:** download an empty import template, import `.xlsx`/`.csv`
  (create-or-update by name+size+brand; stock deltas are logged as movements),
  and bulk-update prices from a prefilled template.

## 8. Backups & audit

- **Manual:** Settings → Backup & restore (JSON export/import, admin+).
- **Automatic:** enable managed Firestore backups in the console (Firestore →
  Backups, no code) or deploy `functions/scheduledBackup` (Blaze plan).
- **Audit:** who/what/when for products, sales, payments, users, settings,
  stock — Settings → Audit log; collection is append-only (rules-enforced).
- Sales documents are **never deletable** from the app or by rules — refunds
  preserve the financial record.

## 9. Deploy to GitHub Pages

`.github/workflows/deploy.yml` is ready — one-time repo setup:

1. **Settings → Pages → Source:** GitHub Actions.
2. **Settings → Secrets and variables → Actions:** add the seven secrets listed
   at the top of the workflow (same values as your `.env`).
3. `git push` to `main` → the site builds and publishes. URL:
   `https://<you>.github.io/advancepos/`.

Firebase client keys are **public by design** (they identify the project, like
a domain name); real security lives in the security rules you deployed in §4.

## 10. Daily-operation checklist

- Morning: verify stock of top sellers (Inventory → Low stock).
- During the day: UPI bills — verify only after seeing the credit in your app.
- Close: Transactions → export the day; Reports → export sales + profit.
- Weekly: Settings → Download backup.

## 11. Architecture notes

- **Atomicity:** all money/stock writes are single Firestore transactions
  (`services/sales.ts`, `services/inventory.ts`) — they read fresh product state
  *inside* the transaction and abort on any conflict.
- **Idempotency:** every checkout carries a client-generated key used as the
  sale's document ID; a retry/double-tap meets `DUPLICATE_SALE` instead of
  double-charging stock. Refunds and verifications check state transitions, so
  they can only happen once.
- **Consistency:** `stock_movements` is an append-only ledger; every mutation
  records its `refId` (sale/purchase id) for reconciliation.
- **Scale:** this design comfortably handles shop-scale volumes (thousands of
  bills/day). For heavier multi-branch loads, shard the `meta/counters` bill
  counter per-terminal.

## 12. Folders

```
src/
  pages/           POS, Inventory, Purchases, Transactions, Reports, Users, Settings, Login, Setup
  services/        transactional business logic (sales, inventory, users, settings, backup, importer, audit)
  hooks/           live Firestore subscriptions
  components/      Layout (sidebar), Invoice (thermal print), UI primitives
  lib/             firebase init, permissions, excel, upi/qr, formatting
  store/           auth session, live settings
functions/         OPTIONAL Cloud Functions (payment webhook + backups) — Blaze plan
firestore.rules / storage.rules / firestore.indexes.json
.github/workflows/deploy.yml  → builds + publishes to GitHub Pages
```
