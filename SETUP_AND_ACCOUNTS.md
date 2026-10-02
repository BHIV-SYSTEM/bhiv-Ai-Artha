# ARTHA — Complete Setup, Accounts & Integrity Guide

Step-by-step: start the whole system, create the full account set (1 Super Admin,
1 company Admin, 1 account per remaining role), connect the Tally connector per
account, and verify data privacy + integrity end-to-end.

---

## 1. The account & privacy model (read this first)

Display names shown in the UI (the role keys in the database never change):

- `admin` → shown as **Super Admin** (you, the product owner — exactly ONE)
- `sub_admin` → shown as **Admin** (your client company's admin)

| # | Role key | UI label | Who | Workspace (= data boundary) | Can do |
|---|------|-----|------|------------------------------|--------|
| 1 | `admin` | **Super Admin** | **Owner of ARTHA (you)** — exactly ONE | own User `_id` (unless assigned a company) | Everything: manage companies, create Admins/employees, own connector keys, see own workspace data |
| 2 | `sub_admin` | **Admin** | Client-company admin | their **Company** `_id` | Manage their company's accountant/viewer users, their company data, their own connector keys |
| 3 | `accountant` | Accountant | Employee | own User `_id` | Create/edit invoices, expenses, journals in own workspace. **No** user management, **no** connector keys |
| 4 | `viewer` | Viewer | Read-only employee | own User `_id` | Read-only reports/data. **No** user management, **no** connector keys |

Rules enforced by the backend:

- **Only ONE Super Admin can ever exist.** Creating a second `admin` returns
  `403 — "Only the Super Admin exists. Create an Admin instead."` Promoting
  anyone to `admin` is equally blocked. (The UI never offers the Super Admin
  role — its user dropdown only offers **Admin** = `sub_admin`.)
- **Every user request runs inside the user's workspace** (`companyScope`
  plugin): invoices, expenses, ledger entries, Tally parties/vouchers/
  outstanding/sync-runs are all filtered by `companyId` automatically.
  No account can read another account's data — not through the UI, not through
  the API.
- **The Tally connector is per-account.** The deployed URL is shared, but each
  Admin/Super Admin account gets its own `CLOUD_API_KEY` / `CLOUD_HMAC_SECRET`.
  Data pushed with account A's keys lands **only** in account A's workspace.

---

## 2. Prerequisites

- **Node.js** 20+ (this machine: v24)
- **MongoDB** — connection string comes from `backend/.env` → `MONGODB_URI`
  (this machine: the Atlas cluster `mongodb+srv://…/artha`), so no local
  MongoDB install is required. To use a local instance instead, override
  `MONGODB_URI` in your shell before starting **and** seeding — never point
  only one of them at a different database.
- Ports free: **5000** (backend), **5173** (frontend/Vite), **9000** (Tally
  gateway, only if you run a real Tally)

---

## 3. Start the system (first run)

### Step 1 — Backend

```powershell
cd C:\Users\Ashmit Pandey\Downloads\AI-Artha-main\backend
npm install                # first time only

# Database: MONGODB_URI is read from backend/.env (Atlas) — leave it unset
# unless you intentionally want a different database:
# $env:MONGODB_URI  = 'mongodb://127.0.0.1:27117/artha'
$env:PORT         = '5000'
$env:TALLY_ENABLED = 'false'        # set 'true' only if a local Tally gateway is running
$env:TALLY_SYNC_ENABLED = 'false'   # background auto-sync; enable when Tally is up
# Legacy shared connector key (Super Admin's original connector .env) — optional:
$env:TALLY_CONNECTOR_API_KEY    = '404bc199ce6e26faf308aaa51bb48981315cd8b33e62900491f3e9ec72275ace'
$env:TALLY_CONNECTOR_HMAC_SECRET = 'f139954315d71e02226d1d26d629a68902a38ddc0666161ceac1c55423dccf3b'

npm run dev                 # nodemon; or: npm start
```

Health check (must return `200`):

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

### Step 2 — Seed the database (first run only)

```powershell
npm run seed:comprehensive
```

This creates the **Super Admin** and baseline demo data (COA, ledgers, etc.).
(`npm run seed` also works — a smaller baseline with 3 login accounts. Both
should end with a `... seeded successfully!` line and no `error:` lines.)

> Fresh empty DB alternative: `node scripts/initialize-database.js` — creates
> the Super Admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars (defaults below)
> **only if no admin exists yet**.

### Step 3 — Frontend

```powershell
cd ..\frontend
npm install                 # first time only
npm run dev                 # → http://localhost:5173
```

### Step 4 — Log in as the Super Admin

Open **http://localhost:5173** → Login:

| Field | Value |
|-------|-------|
| **Email** | `admin@artha.local` |
| **Password** | `Admin@123456` |

---

## 4. All default / created credentials

| Account | Email | Password | Role | Created by |
|---------|-------|----------|------|-----------|
| **Super Admin** | `admin@artha.local` | `Admin@123456` | `admin` (shown as Super Admin) | seed / initialize-database |
| Seed accountant (optional) | `accountant@artha.local` | `Accountant@123456` | `accountant` | seed:comprehensive |
| **Acme Admin** | `subadmin@acme.local` | `SubAdmin@123456` | `sub_admin` (shown as Admin; company: *Acme Traders (Verify)*) | you (Step 5) |
| Verify accountant | `accountant@verify.local` | `Accountant@123456` | `accountant` | you (Step 5) |
| Verify viewer | `viewer@verify.local` | `Viewer@123456` | `viewer` | you (Step 5) |

(The last three are also created automatically by the verification script in
Step 8.)

---

## 5. Create the full account set

You need: **1 company → 1 Admin (bound to it) → 1 accountant → 1 viewer.**

### Option A — via the UI

1. Log in as `admin@artha.local`.
2. Go to **Settings → User Management**.
3. **Create a company** (super-admin panel on that page) → e.g. `Acme Traders`.
4. **Add User** with these exact values:

| User | Name | Email | Role | Password | Company |
|------|------|-------|------|----------|---------|
| Company Admin | Acme Sub Admin | `subadmin@acme.local` | **Admin** | `SubAdmin@123456` | Acme Traders |
| Accountant | Book Keeper | `accountant@verify.local` | **Accountant** | `Accountant@123456` | — |
| Viewer | Read Only | `viewer@verify.local` | **Viewer** | `Viewer@123456` | — |

> Notes:
> - An Admin **must** be assigned a company (backend rejects otherwise).
> - The role dropdown offers **Admin** (`sub_admin`), **Accountant** and
>   **Viewer**. The **Super Admin** role (`admin`) is never offered — by design.
> - Passwords must be ≥ 8 chars with uppercase, lowercase and a number.
> - `409 Email already in use` = the account already exists — just log in with it.

### Option B — via the API (copy-paste)

```powershell
# 1) Login as Super Admin (cookie session)
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Uri http://localhost:5000/api/v1/auth/login -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"admin@artha.local","password":"Admin@123456"}' -SessionVariable s | Out-Null

# 2) Create the company
$co = Invoke-RestMethod -Uri http://localhost:5000/api/v1/multi-company/companies -Method Post `
  -ContentType 'application/json' -Body '{"name":"Acme Traders"}' -WebSession $s
$companyId = $co.data._id
"companyId = $companyId"

# 3) Company Admin (bound to that company, role key stays sub_admin)
Invoke-RestMethod -Uri http://localhost:5000/api/v1/users -Method Post `
  -ContentType 'application/json' `
  -Body "{`"name`":`"Acme Sub Admin`",`"email`":`"subadmin@acme.local`",`"role`":`"sub_admin`",`"password`":`"SubAdmin@123456`",`"companyId`":`"$companyId`"}" `
  -WebSession $s

# 4) Accountant (no company → personal workspace)
Invoke-RestMethod -Uri http://localhost:5000/api/v1/users -Method Post `
  -ContentType 'application/json' `
  -Body '{"name":"Book Keeper","email":"accountant@verify.local","role":"accountant","password":"Accountant@123456"}' `
  -WebSession $s

# 5) Viewer (no company → personal workspace)
Invoke-RestMethod -Uri http://localhost:5000/api/v1/users -Method Post `
  -ContentType 'application/json' `
  -Body '{"name":"Read Only","email":"viewer@verify.local","role":"viewer","password":"Viewer@123456"}' `
  -WebSession $s
```

### What each account sees (verify the privacy)

Log in as each user at http://localhost:5173 and check:

| Page | Super Admin `admin@artha.local` | Admin `subadmin@acme.local` | Accountant / Viewer |
|------|---------------------------|----------------------------------|---------------------|
| Dashboard / Invoices / Expenses / Ledger | own workspace data only | own company data only | own workspace data only |
| **Tally Connect** (data + credentials panel) | own data + own keys | own data + own keys | no credentials panel (403) |
| **Settings → User Management** | all users, can add Admins/employees | only their company's accountant/viewer | 403 |
| Another account's Tally data / invoices | never visible | never visible | never visible |

---

## 6. "How do I create a new admin account?"

Depends which one you mean:

- **A second Super Admin** — **you can't, that's the design.** Exactly one
  `admin` exists; creating another via API returns **403** and the UI never
  offers the role.
- **More Admins for client companies** — yes: create one **Admin**
  (`sub_admin`) per client company from Settings → User Management (API:
  Option B above). They manage their own company and its employees.

### Changing / recovering the Super Admin password

| Situation | Command |
|-----------|---------|
| Reset to known dev password `admin123` | `cd backend` → `node scripts/reset-admin-pw.js` |
| Fresh DB with custom credentials | set `ADMIN_EMAIL` / `ADMIN_PASSWORD` env **before** `node scripts/initialize-database.js` (only applies when no admin exists) |
| Change password while logged in | Settings → User Management → edit **your own** account → new password (≥8, upper+lower+digit) — or `PUT /api/v1/users/{yourId}` with `{"password":"..."}` |

---

## 7. Connect the Tally connector (per-account, privacy-safe)

The connector posts to the **shared deployed URL** — e.g.
`https://artha.blackholeinfiverse.com` (or `http://localhost:5000` locally).
The **URL is the same for everyone; the KEYS decide which account receives the
data.**

### 7a. Get this account's keys (each Admin does this for THEMSELVES)

1. Log in to **your** ARTHA account → **Tally Connect** page.
2. Top card: **"Connect this account to the connector"** shows:

   | env var | value |
   |---------|-------|
   | `CLOUD_URL` | your deployed ARTHA URL (shared) |
   | `CLOUD_API_KEY` | your account's key |
   | `CLOUD_HMAC_SECRET` | your account's secret |

3. Use **Copy** buttons. **Regenerate keys** rotates them (old connector .env
   stops working until updated).

> Only Super Admin and Admin accounts (`admin`, `sub_admin`) see this panel —
> accountants/viewers get 403.

### 7b. Configure the connector

```powershell
cd C:\Users\Ashmit Pandey\Downloads\AI-Artha-main\connector
npm install                  # first time only
Copy-Item .env.example .env  # then edit .env
```

`.env` for **this account**:

```ini
TALLY_HOST=127.0.0.1
TALLY_PORT=9000
TALLY_COMPANY=Your Tally Company Name

CLOUD_URL=https://artha.blackholeinfiverse.com   # shared deployed URL
CLOUD_API_KEY=<CLOUD_API_KEY from your Tally Connect page>
CLOUD_HMAC_SECRET=<CLOUD_HMAC_SECRET from your Tally Connect page>
```

Run it:

```powershell
npm run once     # one sync cycle (good for testing)
npm start        # continuous: Tally → ARTHA push every SYNC_INTERVAL_MINUTES
```

### 7c. What happens server-side

- `x-api-key` is looked up in **per-account credentials** → HMAC verified with
  that account's secret → every raw Tally record **and** every bridged ARTHA
  record (Invoice / Expense / JournalEntry) is stamped with **that account's
  workspace**.
- The legacy shared key (env `TALLY_CONNECTOR_API_KEY`) still works and always
  lands in the **Super Admin's** workspace (backwards compatible with the
  original connector .env).
- Unknown key → `401`. Wrong signature → `403`.

### 7d. "Sync Now" button (server-side Tally gateway sync)

Tally Connect → **Sync Now** runs the read-only gateway sync **inside the
signing-in user's workspace**, so anything it persists/bridges is stamped to
their account and visible to them immediately. Works only when
`TALLY_ENABLED=true` and the gateway is reachable from the server; on cloud
deployments data arrives via the connector agent (7b) instead. Status is shown
on the same page (Auto-Sync / Last Sync cards).

---

## 8. Integrity & privacy verification (run these)

### One-command full check — 24 assertions

```powershell
cd C:\Users\Ashmit Pandey\Downloads\AI-Artha-main\backend
node scripts\verify-accounts.mjs
```

Expected: `ALL 24 CHECKS PASSED`. Re-runnable (creates anything missing,
tolerates existing accounts, uses fresh voucher numbers each run).

What it proves:

| # | Check |
|---|-------|
| 1–2 | Super Admin login + per-account connector credentials issued (with cloudUrl) |
| 3–5 | Company, Admin, accountant, viewer creation |
| 6 | **2nd Super Admin creation blocked (403)** |
| 7–8 | Admin gets own keys; accountant gets **403** on keys |
| 9 | Ingest with SUPER ADMIN key AND with ADMIN key — **same voucher number in both**, no unique-index clash, both bridged to invoices |
| 10 | **Isolation**: each account sees only its own voucher/invoice (distinct docs, same number, correct owners) |
| 11 | Legacy shared key still works → lands **only** in Super Admin workspace |
| 12 | Unknown API key rejected (401) |
| 13 | **Ledger hash chain valid** (tamper-proof, N entries) |
| 14 | Accountant cannot list users (admin-only route, 403) |

### Ledger integrity (always verifiable)

- API: `GET /api/v1/ledger/verify` (as any logged-in user) →
  `{"isValid": true, "chainLength": N, "errors": []}` — the audit hash chain
  covers every posted journal line.
- Test suite: `cd backend && npm run test:ledger`

### Existing / deployed database — one-time migration

If the database was created **before** this update, run once after deploying:

```powershell
cd backend
node scripts\stamp-tally-workspace.js
```

It stamps all pre-existing Tally* documents with the Super Admin's workspace
(otherwise they'd be invisible) and rebuilds unique indexes to be
companyId-scoped (`tallyparties`, `tallyvouchers`, `tallyoutstandings`,
`invoices`, `expenses`). Safe to re-run (idempotent).

---

## 9. Command cheat-sheet

```text
START EVERYTHING
  Mongo      : MONGODB_URI from backend/.env (Atlas) — no override needed
  Backend    : cd backend  → npm run dev                                    (:5000)
  Frontend   : cd frontend → npm run dev                                    (:5173)
  Connector  : cd connector → edit .env → npm run once | npm start

LOGIN
  Super Admin   : admin@artha.local    / Admin@123456
  Admin (client): subadmin@acme.local  / SubAdmin@123456
  Accountant    : accountant@verify.local / Accountant@123456
  Viewer        : viewer@verify.local  / Viewer@123456
  Seed accountant: accountant@artha.local / Accountant@123456

VERIFY
  node scripts\verify-accounts.mjs        (24 checks)
  GET  /api/v1/ledger/verify              (hash chain)
  npm run test:ledger                     (jest)

MIGRATE (existing DBs only, once)
  node scripts\stamp-tally-workspace.js

PASSWORD RECOVERY
  node scripts\reset-admin-pw.js          (Super Admin → admin123)
```

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `401 Invalid API key` on ingest | Key not in per-account credentials **and** doesn't match env `TALLY_CONNECTOR_API_KEY`. Copy keys again from Tally Connect → **Regenerate** if needed, update connector `.env` |
| `403 HMAC signature mismatch` | `CLOUD_HMAC_SECRET` in connector `.env` doesn't match the account's key. Re-copy both values together |
| Ingest `200` but nobody sees the data | Missing workspace stamp — run `node scripts\stamp-tally-workspace.js`, check backend log for `No workspace resolved` |
| `403 Only the Super Admin exists` | Expected — the single-admin rule. Create a company **Admin** instead |
| `409 Email already in use` | Account exists — log in instead of creating |
| Admin (`sub_admin`): "An Admin must be assigned to a company" | Create the company first, pass `companyId` |
| No credentials panel on Tally Connect | You're logged in as accountant/viewer (403 by design) — use the Super Admin or an Admin account |
| Duplicate-key error on Tally ingest (existing DB) | Old global unique index still present → run `node scripts\stamp-tally-workspace.js` (rebuilds indexes) |
| Sync Now: `Tally gateway unreachable` | No local Tally / `TALLY_ENABLED=false` — expected on cloud boxes; use the connector agent (Step 7) |
| Frontend `eslint-plugin-react` not found | Pre-existing dev-env issue; `npm run dev` and `npm run build` are unaffected |
