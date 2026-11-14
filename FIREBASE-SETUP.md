# Firebase Setup Guide — AdvancePOS (step by step)

Everything below is done in one browser tab: https://console.firebase.google.com
Sign in with your Google account first. Budget: ~15 minutes total.

---

## Phase A — Create the project (2 min)

1. Open https://console.firebase.google.com → **Add project**.
2. Name: `advancepos` → Continue.
3. Google Analytics: **disable it** (not needed for a POS) → Create project → Continue.
   Done when you see the project dashboard.

## Phase B — Enable Email/Password login (1 min)

4. Left sidebar → **Build → Authentication** → **Get started**.
5. Tab **Sign-in method** → click **Email/Password** → toggle **Enable** (leave
   "Email link" off) → **Save**.

## Phase C — Create the database (2 min)

6. **Build → Firestore Database** → **Create database**.
7. Choose **Production mode** (we ship our own rules) → Next.
8. Location: **`asia-south1 (Mumbai)`** — closest to Maharashtra → **Enable**.

## Phase D — Enable file storage for your shop logo (1 min)

9. **Build → Storage** → **Get started** → **Production mode** → same location → **Done**.

## Phase E — Publish the security rules (3 min, REQUIRED)

10. **Firestore Database → Rules** tab → delete everything in the editor →
    paste the ENTIRE contents of `firestore.rules` from this repo → **Publish**.
11. **Storage → Rules** tab → same: paste the ENTIRE contents of `storage.rules`
    → **Publish**.
12. Indexes: open **Firestore Database → Indexes → Add index** and create these two
    (field / order):
    - collection `sales`: `paymentStatus` Ascending, `createdAt` Descending
    - collection `products`: `active` Ascending, `name` Ascending
    (If you skip this, the app will throw a toast with a one-click index-creation
    link in the browser console the first time — clicking it also works.)

## Phase F — Get your web-app keys (2 min)

13. Click the ⚙ gear (top-left) → **Project settings** → tab **General**.
14. Scroll to **Your apps** → click the **`</>`** (Web) icon.
15. App nickname: `advancepos` → do **NOT** tick "Firebase Hosting" → **Register app**.
16. You now see `const firebaseConfig = { ... }`. Copy each value into `.env`:
    (in this repo, copy `.env.example` → `.env` and fill it in)

    | Firebase config key      | .env variable                       |
    |--------------------------|--------------------------------------|
    | `apiKey`                 | `VITE_FIREBASE_API_KEY`              |
    | `authDomain`             | `VITE_FIREBASE_AUTH_DOMAIN`          |
    | `projectId`              | `VITE_FIREBASE_PROJECT_ID`           |
    | `storageBucket`          | `VITE_FIREBASE_STORAGE_BUCKET`       |
    | `messagingSenderId`      | `VITE_FIREBASE_MESSAGING_SENDER_ID`  |
    | `appId`                  | `VITE_FIREBASE_APP_ID`               |

17. One more line in `.env`:
    ```
    VITE_DEVELOPER_EMAILS=you@your-email.com
    ```
    (the email you will use to sign in as developer)

18. **Authorized domains** (easy to forget!): **Build → Authentication → Settings
    tab → Authorized domains → Add domain** → enter `noamaan.github.io` (your
    GitHub Pages host; no `https://`, no trailing slash) → **Add**.
    `localhost` is already there for local dev.

## Phase G — First developer account (3 min, one-time bootstrap)

19. **Build → Authentication → Users tab → Add user** → your developer email +
    a strong password → **Add user**.
20. On the user row, click the value under **User UID** to copy it (looks like
    `wX8f...a2`).
21. **Build → Firestore Database → Data tab → Start collection**:
    - Collection ID: `users` → Next
    - Document ID: **paste the UID exactly** → then add these fields
      (pay attention to the TYPE column):

      | field           | type    | value                       |
      |-----------------|---------|-----------------------------|
      | `name`          | string  | your name                   |
      | `email`         | string  | same email as step 19       |
      | `role`          | string  | `developer`                 |
      | `permOverrides` | map     | leave empty                 |
      | `active`        | boolean | `true`                      |
      | `createdAt`     | number  | `1731500000000`             |
      | `createdBy`     | string  | `bootstrap`                 |
      | `lastActiveAt`  | number  | `1731500000000`             |

    → **Save**.

22. Test it: open https://noamaan.github.io/advancepos/`#/login?dev=1`
    (once keys are deployed — Phase H) and sign in with the email+password from step 19.
    Staff can reach the same via the discreet **·** button on the login card.

## Phase H — Put the keys into the live site

Pick ONE:

**Option 1 — fastest (I do it):** paste me the 6 config values + your developer
email. I rebuild and redeploy `gh-pages` — same URL, working app.

**Option 2 — full CI (permanent auto-deploy):** regenerate your token at
github.com/settings/tokens adding the **`workflow`** scope and give it to me
→ I push `.github/workflows/deploy.yml`. Then add the 7 secrets:
repo **Settings → Secrets and variables → Actions → New repository secret**:
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_DEVELOPER_EMAILS`.
Every push to `main` then auto-rebuilds the live site.

## Phase I — First-run shop config (in the app, 5 min)

23. **Settings → Business:** address, phone, logo upload.
24. **Settings → Billing & payments:** your UPI ID (e.g. `mybeershop@okhdfcbank`),
    payee name, tax % (0 if none), invoice prefix, thermal paper size, low-stock
    default, categories.
25. **Users → Add user:** create cashier/manager accounts with temporary passwords
    (they change their own via Settings → My password).
26. **Inventory → + Add product** or import the Excel template.

## Smoke test (2 min)

27. Add product "Test Beer 650ml", stock 5 → Billing: add 2 → **Cash** → print bill.
    Inventory must show 3 left (everywhere, live).
28. Billing: add 1 → **UPI** → QR appears, bill is `pending`, stock still 3.
    Press **✔ Payment received** → stock becomes 2. Try again on the same bill —
    it's correctly refused (already success).
29. Transactions → Refund the cash bill → stock returns.

If all three pass, you're live for real daily billing. ✅
