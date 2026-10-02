import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import logger from "../config/logger.js";
import TallyParty from "../models/TallyParty.js";
import TallyOutstanding from "../models/TallyOutstanding.js";
import TallyVoucher from "../models/TallyVoucher.js";
import { bridgeTallyRecords } from "../services/tallyToArthaBridge.service.js";
import TallySyncRun from "../models/TallySyncRun.js";
import TallyConnectorCredential from "../models/TallyConnectorCredential.js";
import Company from "../models/Company.js";
import User from "../models/User.js";
import { runWithScope } from "../utils/companyScope.js";

/**
 * tallyIngest — receives MDU records from the connector agent over TLS.
 * Security: API key + HMAC-SHA256 signature verification.
 * Only upserts into MongoDB — no write-back to Tally.
 */

function sha256(data) {
  return createHash("sha256")
    .update(typeof data === "string" ? data : JSON.stringify(data))
    .digest("hex");
}

function hmac(secret, message) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Timing-safe string comparison to prevent timing attacks. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Express middleware: verify API key + HMAC signature. */
export async function verifyIngestAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  const signature = req.headers["x-signature"];
  const contentHash = req.headers["x-content-hash"];

  if (!apiKey || !signature || !contentHash) {
    return res
      .status(401)
      .json({
        error:
          "Missing authentication headers (X-API-Key, X-Signature, X-Content-Hash).",
      });
  }

  try {
    // 1) Per-account connector credential — binds the push to its workspace.
    let secret = null;
    const cred = await TallyConnectorCredential.findOne({
      apiKey,
      active: true,
    }).lean();
    if (cred) {
      secret = cred.hmacSecret;
      req.connectorWorkspace = cred.workspaceId;
    } else {
      // 2) Legacy shared server key (owner's original connector .env).
      const expectedKey = process.env.TALLY_CONNECTOR_API_KEY;
      const hmacSecret = process.env.TALLY_CONNECTOR_HMAC_SECRET;
      if (!expectedKey || !hmacSecret) {
        return res.status(500).json({ error: "Server ingestion not configured." });
      }
      if (!safeEqual(apiKey, expectedKey)) {
        return res.status(401).json({ error: "Invalid API key." });
      }
      secret = hmacSecret;
    }

    // Verify HMAC signature: compute HMAC over the content hash
    const expectedSignature = hmac(secret, contentHash);
    if (!safeEqual(signature, expectedSignature)) {
      return res
        .status(403)
        .json({
          error: "HMAC signature mismatch — payload may have been tampered with.",
        });
    }

    // Verify content hash matches actual body
    const actualHash = sha256(JSON.stringify(req.body));
    if (!safeEqual(contentHash, actualHash)) {
      return res
        .status(403)
        .json({
          error: "Content hash mismatch — body does not match signature.",
        });
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** Map MDU canonical_data party record → TallyParty model fields. */
function mapParty(rec, tenantId, company, traceId) {
  const cd = rec.canonical_data;
  return {
    tenantId,
    company,
    ledgerName: cd.party_name || cd.party_id || "",
    group: cd.group || "",
    partyType: cd.group?.includes("Debtor")
      ? "SUNDRY_DEBTOR"
      : cd.group?.includes("Creditor")
        ? "SUNDRY_CREDITOR"
        : "OTHER",
    openingBalance: cd.opening_balance || 0,
    closingBalance: cd.closing_balance || 0,
    creditLimit: cd.credit_limit || 0,
    gstin: cd.gstin || "",
    pan: cd.pan || "",
    source: "tally-connector",
    traceId,
    syncedAt: new Date(rec.fetched_at || Date.now()),
    meta: {
      idempotency_key: rec.idempotency_key,
      content_hash: rec.content_hash,
      schema_version: rec.schema_version,
    },
  };
}

/** Allowed billType values — derived from the model so they can't drift. */
const BILL_TYPES = TallyOutstanding.schema.path("billType")?.enumValues || [];

/** Map MDU canonical_data outstanding record → TallyOutstanding model fields. */
function mapOutstanding(rec, tenantId, company, traceId) {
  const cd = rec.canonical_data;
  return {
    tenantId,
    company,
    partyId: cd.party_name || "",
    partyName: cd.party_name || "",
    billNo: cd.bill_name || "",
    billDate: cd.bill_date ? new Date(cd.bill_date) : null,
    dueDate: cd.due_date ? new Date(cd.due_date) : null,
    daysOverdue: cd.days_overdue || 0,
    amount: cd.amount || 0,
    balance: cd.balance || 0,
    billType: BILL_TYPES.includes(cd.bill_type) ? cd.bill_type : "UNKNOWN",
    outstandingType: "DEBTOR",
    source: "tally-connector",
    traceId,
    syncedAt: new Date(rec.fetched_at || Date.now()),
    meta: {
      idempotency_key: rec.idempotency_key,
      content_hash: rec.content_hash,
      schema_version: rec.schema_version,
    },
  };
}

/** Map MDU canonical_data voucher record → TallyVoucher model fields. */
function mapVoucher(rec, tenantId, company, traceId) {
  const cd = rec.canonical_data;
  return {
    tenantId,
    company,
    voucherType: cd.voucher_type || "",
    voucherNumber: cd.voucher_number || "",
    date: cd.date ? new Date(cd.date) : null,
    partyName: cd.party_name || "",
    amount: cd.amount || 0,
    narration: cd.narration || "",
    reference: cd.reference || "",
    entries: cd.entries || [],
    gstDetails: cd.gst_details || {},
    source: "tally-connector",
    traceId,
    syncedAt: new Date(rec.fetched_at || Date.now()),
    meta: {
      idempotency_key: rec.idempotency_key,
      content_hash: rec.content_hash,
      schema_version: rec.schema_version,
    },
  };
}

/**
 * Resolve the ARTHA workspace that connector data belongs to.
 *
 * The ingest endpoint is public (HMAC auth, no user session), so the usual
 * protect-middleware workspace scope does not exist here. The bridged models
 * (Invoice, Expense, JournalEntry, LedgerEntry, AccountBalance, …) are
 * workspace-scoped — records without a companyId are invisible to every
 * logged-in user. Resolution order:
 *   1. TALLY_WORKSPACE_ID env pin (explicit per-deployment mapping)
 *   2. Company whose name exactly matches the connector's company string
 *   3. First active admin's personal workspace (single-company deployments)
 */
let workspaceCache = { at: 0, value: null };

export async function resolveWorkspace(companyName) {
  if (process.env.TALLY_WORKSPACE_ID) return process.env.TALLY_WORKSPACE_ID;
  try {
    if (companyName) {
      const escaped = String(companyName).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const co = await Company.findOne({
        name: { $regex: `^${escaped}$`, $options: "i" },
      }).select("_id");
      if (co) return co._id;
    }
    if (Date.now() - workspaceCache.at < 60000 && workspaceCache.value) {
      return workspaceCache.value;
    }
    const admin = await User.findOne({ role: "admin", isActive: true })
      .sort({ createdAt: 1 })
      .select("_id");
    if (admin) {
      workspaceCache = { at: Date.now(), value: admin._id };
      return admin._id;
    }
  } catch (err) {
    logger.warn(`[TALLY-INGEST] workspace resolve failed: ${err.message}`);
  }
  return null;
}

/**
 * POST /api/v1/tally-connect/ingest
 *
 * Body: { traceId, tenantId, company, records: [...], syncRun: {...}, totalRecords }
 * Headers: X-API-Key, X-Signature, X-Content-Hash
 */
export async function ingest(req, res) {
  const {
    traceId,
    tenantId,
    company,
    records,
    syncRun: syncRunData,
    totalRecords,
  } = req.body;

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: "Missing or invalid records array." });
  }

  const trace = traceId || `ingest-${Date.now()}`;
  const tid = tenantId || "tenant_bright_connection_001";
  const start = Date.now();

  // Credential-bound workspace wins; legacy shared key falls back to
  // company-name/admin resolution (owner's connector).
  const workspace = req.connectorWorkspace || (await resolveWorkspace(company));
  if (!workspace) {
    logger.warn(
      "[TALLY-INGEST] No workspace resolved - bridged records will lack companyId and be invisible to users.",
    );
  }

  const counts = { parties: 0, outstanding: 0, vouchers: 0 };
  const errors = [];
  let bridgeResults = null;

  await runWithScope(
    { workspace, userId: null, role: "system", crossCompany: false },
    async () => {
      // Upsert each record by entity_type
      for (const rec of records) {
        try {
          switch (rec.entity_type) {
            case "party": {
              const doc = mapParty(rec, tid, company, trace);
              await TallyParty.findOneAndUpdate(
                { tenantId: tid, company, ledgerName: doc.ledgerName },
                { $set: doc },
                { upsert: true, new: true, runValidators: true },
              );
              counts.parties++;
              break;
            }
            case "outstanding": {
              const doc = mapOutstanding(rec, tid, company, trace);
              await TallyOutstanding.findOneAndUpdate(
                { tenantId: tid, partyId: doc.partyId, billNo: doc.billNo },
                { $set: doc },
                { upsert: true, new: true, runValidators: true },
              );
              counts.outstanding++;
              break;
            }
            case "voucher": {
              const doc = mapVoucher(rec, tid, company, trace);
              await TallyVoucher.findOneAndUpdate(
                {
                  tenantId: tid,
                  voucherNumber: doc.voucherNumber,
                  date: doc.date,
                },
                { $set: doc },
                { upsert: true, new: true, runValidators: true },
              );
              counts.vouchers++;
              break;
            }
            default:
              errors.push({
                idempotency_key: rec.idempotency_key,
                error: `Unknown entity_type: ${rec.entity_type}`,
              });
          }
        } catch (err) {
          errors.push({
            idempotency_key: rec.idempotency_key,
            error: err.message,
          });
        }
      }

      // Record sync run for provenance
      try {
        await TallySyncRun.findOneAndUpdate(
          { tenantId: tid, "evidence.traceId": trace },
          {
            $set: {
              tenantId: tid,
              company,
              connector: "tally-connector",
              readOnly: true,
              status: errors.length === 0 ? "completed" : "partial",
              startedAt: syncRunData?.started_at
                ? new Date(syncRunData.started_at)
                : new Date(start),
              completedAt: new Date(),
              entityStats: counts,
              errors,
              mduCount: records.length,
              evidence: {
                traceId: trace,
                source: "connector-agent",
                totalRecords: totalRecords || records.length,
              },
            },
          },
          { upsert: true, new: true, runValidators: true },
        );
      } catch (err) {
        // Sync run record is audit trail — don't fail the whole ingest for this
        errors.push({ syncRun: "write_failed", error: err.message });
      }

      // Bridge: convert Tally vouchers → JournalEntry, Invoice, Expense
      // (inside the workspace scope so bridged records get companyId stamped)
      try {
        bridgeResults = await bridgeTallyRecords(records, tid, company);
      } catch (err) {
        logger.error(`[TALLY-INGEST] Bridge error: ${err.message}`);
        errors.push({ bridge: "failed", error: err.message });
      }
    },
  );

  const duration = Date.now() - start;
  logger.info(
    `[TALLY-INGEST] trace=${trace} parties=${counts.parties} outstanding=${counts.outstanding} vouchers=${counts.vouchers} errors=${errors.length} ${duration}ms`,
  );

  res.json({
    success: true,
    traceId: trace,
    counts,
    bridge: bridgeResults,
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: duration,
  });
}

/**
 * GET /api/v1/tally-connect/ingest/status
 * Returns the last sync runs received by the cloud from the connector.
 */
export async function ingestStatus(req, res) {
  const { tenant_id } = req.query;
  const tid = tenant_id || "tenant_bright_connection_001";

  const runs = await TallySyncRun.find({ tenantId: tid })
    .sort({ startedAt: -1 })
    .limit(10)
    .lean();

  res.json({ tenantId: tid, runs });
}
