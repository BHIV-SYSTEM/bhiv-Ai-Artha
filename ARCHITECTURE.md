# ARTHA — Deep Architecture & Integrity Reference

> Derived from a full-repo analysis (Oct 2026). This is the working knowledge base for making
> changes safely. Counts are actual file counts on disk, not README claims.

---

## 1. What this repo is

**ARTHA** — an India-compliant, multi-tenant accounting/finance system (double-entry ledger,
GST/TDS compliance, invoicing, expenses, dealer CRM, field-sales agents) that also embeds a
BHIV "governance runtime" (capability contracts, authority enforcement, provenance/decision
chains, replay evidence) and two external integration channels: a **Tally connector** (LAN →
cloud push) and a **SETU** signal/event pipeline.

Monorepo, no root `package.json` — each JS app owns its deps.

| Area | Path | Stack | Notes |
|---|---|---|---|
| Backend API | `backend/` | Node 18+ / Express 4 (ESM) / Mongoose 8 / Redis (optional) | 52 models, 34 controllers, 36 route files, 78 service files, 12 middleware |
| Frontend SPA | `frontend/` | React 18 + Vite 5, Tailwind, zustand, react-router 6, recharts, axios | 40 pages, 88 source files |
| Tally connector | `connector/` | standalone Node agent (own package.json) | runs on the Tally LAN PC; `--demo` mode |
| Governance/eval Python | `api/`, `evaluation_engine/`, `security/`, `task_selector/`, `integrations/`, `tests/` | FastAPI + pytest (T-GOV-002 deliverable) | additive, imports from vendored `Setu-Aman-main/` |
| Contracts | `contracts/capability_contracts/*.json` | JSON contracts + route map | **single source of truth** for authority enforcement |
| Ops | `Dockerfile`, `docker-compose*.yml`, `.github/workflows/cicd.yml`, `scripts/` | multi-stage build, evidence generation, deploy/backup scripts | |
| Docs/packets | `README.md`, `ARTHA_STATUS.md`, `SETUP_AND_ACCOUNTS.md`, `CODE_PACKET.md`, `REVIEW_PACKET.md`, `review_packets/` | | some README claims are stale (see §10) |

~72k lines of JS/JSX in `backend/src` + `frontend/src` + `connector`.

Git: branch `main`, **4 remotes** (`origin`/`bhiv` → BHIV-Engineering-Exchange, `neworigin` →
blackholeinfiverse64, `target` → AI_Content_Platform_T41). Multi-remote push workflow is
documented in README (`git push origin main && git push collaborator main`).

---

## 2. Backend request pipeline (order matters)

`backend/src/server.js` (628 lines) wires, in order:

1. `dotenv` load (path resolved relative to `src/`, *after* static imports) →
   `pushNotificationService.reconfigure()` re-reads VAPID env.
2. `connectDB()` + best-effort `connectRedis()` (server runs without Redis).
3. Async service init: audit/banking/caWorkflow init, capability registry `loadContracts()`,
   provenance/decision/replay/evidence/setuDispatch/tantra init, `financialIntegration`,
   `insightFlow`, `bhivRuntimeBridge`, `runtimeRegistration.register`, **`tallySyncScheduler.start()`**.
4. CORS shim (manual headers, `ALLOWED_ORIGINS` from `config/cors.js` + SPA/API URLs from `config/urls.js`).
5. `helmetConfig`, global `limiter`, `watermark`.
6. Body parsers (10 MB), `cookieParser`, `sanitizeInput`.
7. `tracePropagation` — assigns `traceId`/`X-Trace-Id` that flows through services.
8. **`authorityEnforcement`** (`middleware/authorityBoundary.js`) — loads
   `contracts/capability_contracts/*.json` + `capability_route_map.json` (longest-prefix match),
   sets `req.capability` / `req.capabilityAuthority`, rejects writes to read-only capabilities,
   rejects unmapped routes with `AUTHORITY_VIOLATION`. Runs *before* auth (no `req.user` yet).
9. **`policyEnforcement`** (`middleware/policyEngine.js`) — deterministic policy decisions,
   records to DecisionLedger + ProvenanceChain, blocks with `POLICY_VIOLATION`.
10. Health routes, SPA redirects for `/login|/signup|/dashboard`, `/api/health`.
11. Auth endpoints defined inline in server.js: `POST /api/v1/auth/login` (rate-limited),
    `POST /api/v1/auth/signup` → **hard 403 (closed registration)**, `logout`, `GET /auth/me`,
    push endpoints (`/api/v1/push/subscribe` + `/unsubscribe` are **public by design** —
    service worker registers pre-auth; `/vapid-key` public; `/status` + `/test` authenticated).
12. **~36 routers** mounted under `/api/v1/...`. Note: `/api/v1/tally-connect` is mounted
    twice (`tallyIngestRoutes` first for `/ingest`, then `tallyConnectorRoutes`) — paths don't collide.
13. SETU endpoints defined inline: `POST /api/v1/setu/callback` (HMAC, timing-safe),
    `POST /api/v1/setu/dispatch`, `GET /api/v1/setu/stats`, then
    `app.use('/api/v1/setu/ingest', setuIngestRoutes)` — **the last mount in the file (new)**.
14. 404 handler → `errorTracker` → error handler (hides messages in production).
15. `app.listen` unless `NODE_ENV=test`; logs capability/governance status, records
    deployment evidence + provenance `START`.
16. Graceful shutdown (deregister, close Mongo/Redis), `unhandledRejection`/`uncaughtException`
    are **logged and swallowed** (process deliberately stays alive).

**Per-router auth**: each route file does `router.use(protect)` then
`authorize('admin'|'accountant'|...)` per endpoint (`backend/src/middleware/auth.js`).

- `protect`: JWT from `Authorization: Bearer` **or** legacy HTTP-only `blackhole_token` cookie
  (login sets the cookie; frontend relies on `withCredentials: true`). Secrets tried in order:
  `JWT_SECRET`, `BHIV_JWT_SECRET`, `AUTH_JWT_SECRET`, `BLACKHOLE_JWT_SECRET`.
  Rejects if `APP_ID`/`BHIV_APP_ID` set and not in `user.allowedApps` (`app_not_allowed`).
  Then calls `runWithScope({ workspace, userId, role, crossCompany:false }, next)`.
- `authorize(...roles)`: **`sub_admin` is expanded to `admin + accountant + viewer`** —
  client-company admin gets full in-app rights *inside its workspace*.

---

## 3. Multi-tenancy (the most important integrity rule)

`backend/src/utils/companyScope.js` — Mongoose plugin + AsyncLocalStorage:

- `workspace = user.companyId || user._id` (company users share a workspace; personal users get their own).
- Active scope **forces** `companyId` onto `find/findOne/count/update/delete/...`, prepends
  `$match` to aggregations, stamps `companyId` on `save`/`insertMany`.
- `allowCrossCompany()` (only `multiCompany.controller.js`) is the escape hatch.
- No scope (seeds, schedulers, scripts) ⇒ unscoped queries.

**Implication for changes**: any new model that holds business data must
`schema.plugin(companyScope)` (see `models/Invoice.js`, `models/ChartOfAccounts.js` for the
pattern — CoA also consults `getScope()`). Any new service that queries without going through
Mongoose methods, or that runs outside a request, must explicitly handle scoping
(`runWithScope` is used by `setuIngest.controller.js`, `tallyIngest.controller.js`,
`notificationEvent.service.js`, seeds).

Roles (`models/User.js`): `admin` (exactly ONE super admin, enforced in users controller),
`sub_admin`, `accountant`, `viewer`. Frontend mirrors expansion in
`frontend/src/utils/permissions.js` (`effectiveRoles`, `can`, `useCan`) and in
`App.jsx RoleProtectedRoute` — **keep all three in sync when touching roles**.

---

## 4. Core accounting engine

`backend/src/services/ledger.service.js` (1,834 lines) is the heart.

**Journal lifecycle**: `createJournalEntry` (DRAFT) → `validateJournalEntry` (VALIDATED) →
`postJournalEntry` (POSTED). `importAndPostJournalEntry` does all three in one transaction
(used by Tally import to avoid nested-transaction visibility issues).

- **Hash chain**: on create, reads latest POSTED entry → `prevHash`, `chainPosition`,
  `JournalEntry.computeHash(tempEntry, prevHash)`. On post: verify HMAC, write per-line
  `LedgerEntry`s (own SHA-256 chain), update `AccountBalance`, invalidate Redis cache.
- **Validation**: ≥2 lines, debit/credit balance (`validateJournal`), line integrity
  (no line with both debit & credit), account existence (`validateAccounts`), GST/TDS
  compliance rules (`validateComplianceRules`), requires `trace_id`, `source`, `auditTrail`.
- **Audit**: every transition appends to `entry.auditTrail` + sets `auditTrace` snapshot.
- **Trace**: `recordTraceStage(trace_id, stage)` → `UnifiedTrace` stages
  (`JOURNAL_CREATED → JOURNAL_VALIDATED → JOURNAL_POSTED → ...`).
- **Corrections**: `createReversalEntry`, `createCreditNote`, `createDebitNote`,
  `voidJournalEntry` (reverses balances), `verifyLedgerChain` / `verifyChainFromEntry` /
  `getChainSegment` for integrity UI (`pages/accounting/LedgerIntegrity.jsx`).
- `ensureComplianceAccounts()` auto-creates GST/TDS payable-receivable accounts (6xxx COA set).

**Who posts to the ledger** (all call `ledgerService.create/validate/post`):

| Source | Debit | Credit |
|---|---|---|
| `invoice.service.js` send | AR 1100 | Revenue 4000 + GST Payable 2200 |
| `invoice.service.js` recordPayment | Cash/Bank 1010 | AR 1100 |
| `expense.service.js` record | Expense 6xxx | Cash/Bank 1010 |
| `tds.service.js` deduct | TDS Receivable | Income (net) |
| `bankStatement.service.js` auto journal | per transaction | per transaction |
| `banking.service.js`, `caWorkflow.service.js`, `tallyToArthaBridge` / `tallyCompatibility` (import), `financialCapabilityRegistry` | | |

**Reports** (`financialReports.service.js`, 1,441 lines) compute P&L / Balance Sheet /
Cash Flow / Trial Balance / Aged Receivables / dashboard KPIs **from posted journal entries in
real time** (with `ReportSnapshot` caching + Redis `cacheMiddleware`).

**New (uncommitted) in invoice flow**:
- idempotent `sendInvoice` — reuses an existing non-VOIDED `JournalEntry` matched by
  `reference = invoiceNumber` instead of double-posting on retry.
- customer ownership scope filters (`customerEmail`/`customerGSTIN` exact case-insensitive).
- `recipientVerification.service.js` — a recipient is "verified" only if an active user with
  that email exists **and** that user's workspace has the GSTIN in `CompanySettings`.
  Enables cross-workspace *shared* invoice visibility (`GET /invoices/shared`,
  `GET /invoices/:id/shared`).

---

## 5. Domain workflows (status machines)

- **Invoice**: `draft → sent → partial → paid → cancelled`; payments array with partial
  support; GST per line via `gstEngine.service.js` (IGST vs CGST+SGST by state code);
  PDF via `pdf.service.js`; cancel blocked while payments exist (409).
- **Expense**: `pending → approved → recorded` (+ `rejected`); OCR via `ocr.service.js`
  (tesseract.js optionalDependency); auto-record after approval (failure ⇒ signal
  `SIG_EXPENSE_RECORD_FAILED`); receipt files under `uploads/`.
- **TDS**: sections 194A/C/H/I/J/Q, 192; `pending → deducted → deposited → filed`;
  challans, `Form 26Q/24Q` generation (`compliance/tdsStatutory.service.js`), validation logs.
  **Uncommitted**: `recordTDSFiling()` (deposited → filed with ARN) + route
  `POST /api/v1/tds/entries/:id/file` + `filingStatusUpdated` notification.
- **GST**: GSTR-1 / GSTR-3B packets from `JournalEntry.gstDetails`
  (`compliance/gstStatutory.service.js`, `gstFiling.service.js`), return filing records,
  quarterly due dates; `fileGSTReturn` now also fires `filingStatusUpdated`.
- **Bank statements**: upload → parse (CSV/Excel/PDF, tolerant parser) → `autoReconcile`
  → auto match invoices / auto record payments / draft journal entries →
  `reconciliationException` notification for unmatched (new).
- **CA workflow**: month/quarter/year close checklists (`caWorkflow.service.js`).
- **Signals**: `signalEngine.service.js` evaluates ledger snapshots → `ComplianceSignal`
  records with a fixed `RECOMMENDATIONS` map (SIG_GST_*, SIG_TDS_*, SIG_LEDGER_*,
  SIG_CASHFLOW_NEGATIVE, SIG_INVOICE_OVERDUE, …).

---

## 6. Inbound data paths

### 6.1 Tally connector (LAN → cloud)

`connector/agent.js` (own npm app) on the Tally PC:

1. Builds read-only `Export Data` envelopes (`assertReadOnlyEnvelope` guard — no writes to Tally).
2. `tallyClient.js` → `http://127.0.0.1:9000` XML fetch; `tallyParser.js` parses
   ledgers/outstanding/vouchers (DSP parser rewritten for all XML shapes); `normalizer.js`.
3. `cloudClient.js` pushes with `X-API-Key` + `X-Signature` (HMAC-SHA256) + `X-Content-Hash`,
   retry w/ exponential backoff, per-record idempotency keys, `--demo` data generator.

Cloud side: `POST /api/v1/tally-connect/ingest` → `tallyIngest.controller.js#verifyIngestAuth`
(looks up **per-account** `TallyConnectorCredential` by API key ⇒ `req.connectorWorkspace`,
timing-safe HMAC check) → upsert `TallyParty` / `TallyOutstanding` / `TallyVoucher` +
`TallySyncRun` inside that workspace scope → `tallyToArthaBridge.service.js` maps into
dealers/ledger-facing records.

`routes/tallyConnector.routes.js` = management surface: credentials get/rotate/revoke
(`authorize('admin','sub_admin')`), sync triggers/status, party/outstanding/voucher listings,
dealer summary + SETU push, MDU export. `tallySyncScheduler.start()` runs periodic sync at boot.

### 6.2 SETU — outbound signals

`setu.pipeline.js` pure functions: `normalizeSignal → validateSignal → mapToSetuPayload →
serializeForSetu` (+ `parseSetuAcknowledge`, `shouldRetry`, `computeRetryDelay`,
`buildDeliveryEvidence`). `setuDispatch.service.js`: dispatch → `SetuDispatch` record
`INITIATED → SENT → ACCEPTED/REJECTED`, ≤3 retries w/ backoff, dead-letter, HMAC-verified
`POST /api/v1/setu/callback`. `sampadaAdapter.js` maps to Sampada envelopes.

### 6.3 SETU — inbound events (**new, untracked files**)

`POST /api/v1/setu/ingest` (HMAC via `SETU_HMAC_SECRET`/`HMAC_SECRET`, timing-safe,
idempotency keys, tenant map → workspace scope). Event types in
`services/setuEventContract.service.js`: `order.confirmed` (→ creates Invoice),
`order.cancelled` (→ cancelInvoice, 409 if payments), `payment.received` (→ recordPayment,
dedup by payment reference), `supplier.purchase-approved` (→ Expense).
Persistence/dedup tracked in `models/SetuIngestEvent.js`.
Unit-tested by `backend/tests/setuIngest.test.js` (16 tests, no DB — **passing**).

### 6.4 Universal document ingestion (**new — uncommitted**)

Purpose: *any* invoice/receipt format in → structured data out (items, qty, rate,
amount, HSN, totals), plus generic document extraction.

- **`services/documentExtractor.service.js` (778 lines)** — format-agnostic text
  extraction: PDF via `pdfjs-dist` (optional OCR page-render fallback via
  `@napi-rs/canvas` + tesseract), images via tesseract, DOCX via `mammoth`,
  spreadsheets via `xlsx`, plain text/JSON/XML/HTML. Exports
  `ALLOWED_EXTENSIONS` / `ALLOWED_MIME_TYPES` / `MAX_FILE_SIZE` (used by both
  upload routes for file filters) and `validateUpload()`.
- **`services/invoiceParser.service.js` (392 lines)** — the format-agnostic
  invoice parser. Key insight: PDF extraction flattens table cells into one
  space-joined line, so column headers can't be trusted. Instead it:
  1. walks the printed serial-number sequence (1,2,3,…) to find row boundaries;
  2. per row, finds the arithmetic identity `quantity × rate = amount` among all
     numeric tokens (with an `endOnly` preference so incidental numbers don't match);
  3. decides which factor is qty vs rate using unit words (KG/NOS/PCS/…),
     decimal presence, and whether the amount sits before or after the factors —
     this is exactly what fixes "quantity shown as price / rate as price";
  4. extracts HSN (4–8 digit token outside the triple), description (leading
     tokens), line tax slab (`pIdx === rateIdx + 3` layout);
  5. totals by label regexes (grand total / total ₹ / net payable / taxable value /
     sub total / Basic Amt slabs), derives `tax = total − subtotal − roundOff`,
     falls back to CGST/SGST/IGST components, and cross-checks the printed
     subtotal against the item sum (warns on >0.5% drift).
- **Consumers**: `ocr.service.js#parseText` calls it (vendor/date/invoice no. via
  its own extractors; **taxable base = subtotal** so the ledger never double-counts
  GST); `smartUpload.service.js` gained a `document` doc-type (extract-only, never
  creates an expense) and routes now accept DOCX/TXT/JSON/HTML/etc.
- **`services/ingest.service.js` + `controllers/ingest.controller.js` +
  `routes/ingest.routes.js` + `models/IngestDocument.js`** — REST surface
  `POST/GET/DELETE /api/v1/ingest` (multer, `protect`) to upload/persist/query
  extracted documents. Mounted at `server.js:435`; prefix **was** added to
  `capability_route_map.json` (correct per §12.2).
- **`services/expenseJournal.service.js` (76 lines, pure)** — builds balanced
  DR/CR lines for expense postings where GST split may be unknown/mixed-slab
  (round-off residual absorbed by the expense line). Tested.
- Frontend: `SmartUpload.jsx` accept-list mirrors backend extensions; new
  `ingestService` façade in `services/index.js`.

**Verified against the two real sample invoices** (repo root), parser run via
`documentExtractor.extract → invoiceParser.parse`:

| File | Pages | Items | Subtotal | Tax | Total |
|---|---|---|---|---|---|
| `puranchand and sons-10501=….pdf` | 1 | 11 | 71,153.96 (slabs) | 3,605.96 | 74,760.00 (roundOff +0.08) |
| `inv m2620.pdf` | 7 | 40 | 45,470.60 (printed) | 821.46 (derived) | 46,292.00 (roundOff −0.06) |

Both reconcile exactly (items sum = printed subtotal; subtotal + tax ± roundOff =
printed total), every row's `qty × rate = amount` holds, HSN + unit + line-tax
slab captured where printed. E.g. Purana Chand row: `10 KG × 247.62 = 2,476.20`
(HSN 18062000, GST 5%); VM2620 row: `90 KG × 63 = 5,670` (HSN 10063020).

### 6.5 Field force & CRM

`Dealer`, `SalesAgent`, `LocationPing`, `Visit` models; dealer sync from Tally
(`dealer.service.syncFromTally`) and **new** `syncFromSetu()` (HMAC-signed pull from
`SETU_SYNC_BASE_URL`, env-driven demo geolocation defaults — no hardcoded city).
Notifications: `notificationEvent.service.js` creates in-app `Notification` then
fire-and-forget `pushNotification.service.pushToAllSubscribers` (web-push/VAPID, 410 →
auto-deactivate). Service worker `frontend/public/sw.js` handles push + deep links.

---

## 7. Governance / BHIV layer (cross-cutting)

- **Contracts**: 10 capability contracts + `capability_route_map.json` (v1.2.0) in
  `contracts/capability_contracts/`. Loaded by both `authorityBoundary` and
  `capabilityRegistry.service.js`. Changing a route prefix **requires** updating the route map.
- **Chains**: `provenanceChain` (governance blocks), `decisionLedger` (ALLOW/DENY/WARN/BLOCK),
  `audit.service` (AuditEvent hash chain), `lineage` anchors, `runtimeProof`, `evidenceAutomation`.
- **Verification**: `independentVerifier` (10 checks), `adversarialSuite` (24 attack vectors),
  `deterministicReplay` / `replayEngine` (SHA-256 replay proofs), `circuitBreaker`
  (mongodb, redis, setu_api, tantra_runtime, ocr_service, evidence_pipeline).
- **API**: 30+ endpoints under `/api/v1/governance/*` (`routes/governance.routes.js`).
- **Mitra AI**: `mitra.service.js` proxies to `MITRA_API_URL` with a strict
  `ROLE_CAPABILITIES` map (viewer/accountant/admin) — the AI can never exceed the caller's role.
- **Runtime bridge**: `bhivRuntimeBridge`, `runtimeRegistration`, `insightflow` (RL buffer models).

---

## 8. Frontend architecture

- `main.jsx → App.jsx` (223 lines): `ErrorBoundary → Routes`. Layouts: `AuthLayout` (login),
  `Layout` (sidebar/navbar shell). Guards: `ProtectedRoute`, `RoleProtectedRoute`
  (roles expanded for `sub_admin`), `PublicRoute` (redirect if authed).
- Auth: `store/authStore.js` (zustand) → `checkAuth()` calls `GET /auth/me` on boot; no token
  in localStorage — **cookie-based** (`withCredentials`).
- API layer: `services/api.js` (axios instance, `VITE_API_URL`/`VITE_API_ORIGIN` resolution,
  response interceptor: toast by status code, 401 → redirect `/login`, special-cases
  `app_not_allowed`, `AUTHORITY_VIOLATION`, `POLICY_VIOLATION`) →
  `services/index.js` (255 lines) = typed-ish façade (`invoiceService`, `expenseService`,
  `ledgerService`, `gstService`, …). **Add new endpoints here first**, then consume in pages/hooks.
- Data hooks: `hooks/useInvoices|useExpenses|useDashboard|useSignals|useComplianceSnapshot|useMitra|usePushNotifications`.
- Key pages: `dashboard/FinancialIntelligenceDashboard` (default `/`), `compliance/{GSTDashboard,TDSManagement,SignalDashboard}`,
  `accounting/{ChartOfAccounts,JournalEntries,JournalEntryCreate,LedgerIntegrity}`,
  `dealers/*`, `agents/*`, `statements/*`, `tally/TallyConnect`, `ingestion/DataIngestion`,
  `upload/SmartUpload`, `settings/{CompanySettings,UserManagement}`, `notifications`.
- Guards are duplicated in three places (App.jsx routes, `permissions.js`, `Sidebar.jsx`
  visibility) — update all when changing access rules.

---

## 9. Testing, build, deploy

- **Backend**: Jest (`backend/jest.config.js`, `testMatch: **/tests/**/*.test.js`,
  babel-jest). `cd backend && npm test` (needs Mongo for most; many scripts assume Atlas URI).
  Fast DB-free suites: `npx jest tests/setuIngest.test.js`.
  Governance suites: `npm run verify:external`, `test:negative`, `test:adversarial`,
  `evidence:full`, `proof:*`.
- **Root Python**: `tests/unit/test_api.py`, `tests/integration/test_flow.py` (pytest).
- **Frontend**: `npm run dev` (5173) / `npm run build` / `npm run lint`.
- **Docker**: multi-stage `Dockerfile` (build runs jest `--passWithNoTests`, writes evidence;
  production stage = non-root `artha` user, curl for healthchecks). `docker-compose.yml` =
  backend + evidence collector; `docker-compose.dev.yml` = dev stack; production template
  consumed by `.github/workflows/cicd.yml` (validate → build on push to main).
- **Local demo**: `start-demo.bat` (seed + backend + frontend), `npm run seed:demo` in backend,
  login `admin@brightconnection.in / admin123`.
- Env keys: `backend/.env.example` (MONGODB_URI, JWT_SECRET, HMAC_SECRET, SETU_*, TALLY_*,
  TALLY_CONNECTOR_*, MITRA_*, VAPID_*, DEMO_DEFAULT_*).

---

## 10. Known issues / doc drift (verified during analysis)

> Re-verified in the second analysis pass; counts below updated — see §1 for
> current numbers (52 models / 34 controllers / 36 routes / 78 services).

1. **Working-tree bug**: `backend/src/services/notificationEvent.service.js:237` —
   TDS notification body contains `₹1${...}` (stray `1`): renders "₹11,500" for ₹1,500.
   Introduced in the current uncommitted changes.
2. `README.md` role list is wrong (`admin, accountant, user, viewer`) — real roles are
   `admin, sub_admin, accountant, viewer` (see `SETUP_AND_ACCOUNTS.md`, which is accurate).
3. `README.md` links `DEPLOYMENT.md` and `docs/PRAVAH_DEPLOYMENT.md` — **neither exists**
   (no `docs/` directory).
4. Model/service counts in README (41/53) are stale: actual 52 model files / 78 service files
   (counts keep moving with the uncommitted work — re-count before quoting).
5. `backend/src/routes/index.js` is not imported anywhere in `src` (legacy/dead router) —
   server.js mounts routers directly. Don't add routes there.
6. Push subscribe/unsubscribe endpoints are intentionally public (no auth) — any client can
   register a device token; only diagnostics/test sends are authenticated.
7. `server.js` swallows `uncaughtException`/`unhandledRejection` — crashes will appear as
   log lines in `logs/error.log` rather than process death.
8. Long multi-remote history: git status currently shows **48 modified +
   14 untracked source files** (see §11) — do not `git add -A` blindly; CRLF warnings are normal here
   (repo has `.gitattributes`). Also: two sample invoices sit at the repo root
   (`puranchand and sons-10501=….pdf`, `inv m2620.pdf`) and test uploads under
   `backend/uploads/` — decide deliberately whether they belong in a commit.

---

## 11. Current in-progress work (uncommitted, as of second analysis pass)

**State: 48 modified files (+2,504 / −358) + 14 untracked source files** (18
untracked entries total: those 14, plus this doc, `.freebuff/`, and the two sample
invoice PDFs at the repo root). Two workstreams on top of each other:

**A. Compliance/UX workstream (earlier):** idempotent invoice AR posting +
customer scope filters, dealer `syncFromSetu()`, TDS filing acknowledgement flow,
GST/reconciliation/filing-status notifications, TDS/GST/LedgerIntegrity/
Dashboard page upgrades, `DealerCreate`/`SalesAgentCreate`/`SmartUpload` routes,
CSV export util.

**B. Document ingestion workstream (new since first pass, §6.4):**
- untracked: `documentExtractor.service.js`, `invoiceParser.service.js`,
  `ingest.service.js`, `ingest.controller.js`, `ingest.routes.js`,
  `IngestDocument.js`, `expenseJournal.service.js` (+ `setuIngest` files from A)
- modified: `ocr.service.js` (parser integration), `smartUpload.service.js` /
  `smartUpload.routes.js` (document type + wider file filters),
  `expense.service.js`, `SmartUpload.jsx`, `services/index.js` (ingestService),
  `contracts/.../capability_route_map.json` (`/api/v1/ingest` prefix),
  `backend/package.json` (adds `@napi-rs/canvas`, `mammoth`; installs `pdfjs-dist`)

**Verification status (second pass):**
- `npx jest tests/setuIngest.test.js tests/expenseJournal.test.js` → **23/23 pass** (exit 0).
- End-to-end extraction+parse of **both sample PDFs** → correct (see §6.4 table).
- Full Jest suite (needs MongoDB) and frontend build: **not run**.
- `₹1` typo (§10.1) **still present** — not fixed (analysis-only pass).

Modified (40 files, +1465/−194):
- **Backend**: idempotent invoice AR posting + customer scope filters; dealer `syncFromSetu()`;
  TDS filing acknowledgement flow (`recordTDSFiling` + route + statutory service);
  GST filing-status notification; bank reconciliation exception notification;
  CA workflow / reports / chartOfAccounts / signalEngine / invoice tweaks; server.js mounts
  the new SETU ingest router.
- **Frontend**: routes for `DealerCreate`, `SalesAgentCreate`, `SmartUpload` (previously these
  paths rendered the *list* pages — now real create pages); LedgerIntegrity, TDSManagement,
  GSTDashboard, JournalEntries, FinancialIntelligenceDashboard, AgedReceivables, list pages
  (search/export polish), Sidebar, `utils/csv.js`.

Untracked (new): `setuIngest.controller.js`, `setuIngest.routes.js`, `SetuIngestEvent.js`,
`setuEventContract.service.js`, `frontend/pages/dealers/DealerCreate.jsx`,
`frontend/pages/agents/SalesAgentCreate.jsx`, `frontend/utils/csv.js` (+ `.freebuff/`).

Verification status: `backend/tests/setuIngest.test.js` → 16/16 pass. Full suite and
frontend build were **not** run during analysis.

---

## 12. Conventions to follow when making changes

1. **Backend change recipe**: route file (`protect` + `authorize`) → controller → service
   (business logic, notifications via `notificationEvent.*`) → model (`companyScope` plugin).
   Never query business collections from a controller without the service layer.
2. New/changed URL prefixes must be added to `contracts/capability_contracts/capability_route_map.json`
   or `authorityEnforcement` will 403 them.
3. Ledger writes only through `ledgerService` (create → validate → post) — never mutate
   `JournalEntry.status`/balances directly, and never skip the hash chain.
4. Financial math: `decimal.js` (`new Decimal(...)`), never raw floats.
5. Tenant data: rely on the scope plugin; if you need cross-workspace reads, use
   `allowCrossCompany()` explicitly and gate it to `admin`.
6. Frontend: add the endpoint to `services/index.js`, gate UI with `useCan()`, and mirror
   any role change in `App.jsx` + `Sidebar.jsx` + `permissions.js`.
7. Errors: services `throw new Error(...)`/`BizError`; controllers map to status codes;
   frontend interceptor already toasts by code — prefer `message` + `code` fields.
8. Keep new env vars in `backend/.env.example` and read them via `process.env` with a safe default.
