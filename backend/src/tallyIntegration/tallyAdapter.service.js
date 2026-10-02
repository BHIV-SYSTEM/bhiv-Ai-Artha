import connector from './tallyConnector.service.js';
import TallyParty from '../models/TallyParty.js';
import TallyOutstanding from '../models/TallyOutstanding.js';
import TallyVoucher from '../models/TallyVoucher.js';
import TallySyncRun from '../models/TallySyncRun.js';
import { bridgeTallyRecords } from '../services/tallyToArthaBridge.service.js';
import { runWithScope } from '../utils/companyScope.js';
import { resolveWorkspace } from '../controllers/tallyIngest.controller.js';

/**
 * tallyAdapter.service — ARTHA-side financial normalization.
 *
 * Takes the canonical MDU records produced by the connector boundary and
 * persists them into ARTHA-owned snapshot collections (additive — the existing
 * ARTHA ledger/ledgerEntry models are untouched). Also builds the dealer demo
 * summary: dealer → outstanding → last billing → payments → account info.
 *
 * This is the ARTHA adapter layer. No Tally-specific logic leaks past this
 * point; everything downstream (SETU / MITRA) consumes the canonical records.
 */

function tenantId() {
  return process.env.TALLY_TENANT_ID || 'tenant_bright_connection_001';
}

function companyName(company) {
  return company || process.env.TALLY_COMPANY || '';
}

function brightConnectionId() {
  return process.env.TALLY_BRIGHT_CONNECTION_ID || 'bc_bright_connection_001';
}

function accountId() {
  return process.env.TALLY_ACCOUNT_ID || 'acct_bright_connection';
}

function storeId() {
  return process.env.TALLY_STORE_ID || '';
}

function storeName() {
  return process.env.TALLY_STORE_NAME || '';
}

function buildProvenance(entityType, dataset, syncRunId, rawPayload) {
  return {
    brightConnectionId: brightConnectionId(),
    accountId: accountId(),
    storeId: storeId(),
    storeName: storeName(),
    sourceEntity: entityType,
    dataset,
    rawTallyPayload: rawPayload || null,
    syncedAt: new Date(),
    lastSyncedAt: new Date(),
    syncRunId,
    migratedToArtha: false,
    arthaModelType: '',
    arthaRecordId: '',
    mitraAction: '',
    mitraInsight: '',
  };
}

async function upsertParties(records, { company, traceId, syncRunId }) {
  let created = 0;
  let updated = 0;
  for (const r of records) {
    const d = r.canonical_data;
    const filter = { tenantId: r.tenant_id, company, ledgerName: d.party_name };
    const prov = buildProvenance('party', 'parties', syncRunId, r);
    prov.rawTallyPayload = d;
    const update = {
      $set: {
        company,
        ledgerName: d.party_name,
        group: d.group,
        partyType: d.party_type,
        openingBalance: d.opening_balance,
        closingBalance: d.closing_balance,
        creditLimit: d.credit_limit,
        gstin: d.gstin,
        pan: d.pan,
        address: d.address,
        contact: d.contact,
        currency: d.currency,
        source: 'tally',
        traceId: r.trace_id || traceId,
        rawRef: r.raw_ref,
        syncedAt: new Date(),
        provenance: prov,
      },
    };
    const res = await TallyParty.updateOne(filter, update, { upsert: true });
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  return { created, updated, total: records.length };
}

async function upsertOutstanding(records, { company, traceId, syncRunId }) {
  let created = 0;
  let updated = 0;
  for (const r of records) {
    const d = r.canonical_data;
    const filter = {
      tenantId: r.tenant_id,
      company,
      partyName: d.party_name,
      billNo: d.bill_no || '',
    };
    const prov = buildProvenance('outstanding', 'outstanding', syncRunId, r);
    prov.rawTallyPayload = d;
    const update = {
      $set: {
        company,
        partyName: d.party_name,
        ledgerName: d.ledger_name,
        billNo: d.bill_no || '',
        billDate: d.bill_date ? new Date(d.bill_date) : null,
        dueDate: d.due_date ? new Date(d.due_date) : null,
        daysOverdue: d.days_overdue,
        amount: d.amount,
        received: d.received,
        balance: d.balance,
        billType: d.bill_type,
        source: 'tally',
        traceId: r.trace_id || traceId,
        rawRef: r.raw_ref,
        syncedAt: new Date(),
        provenance: prov,
      },
    };
    const res = await TallyOutstanding.updateOne(filter, update, { upsert: true });
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  return { created, updated, total: records.length };
}

async function upsertVouchers(records, { company, traceId, syncRunId }) {
  let created = 0;
  let updated = 0;
  for (const r of records) {
    const d = r.canonical_data;
    const filter = {
      tenantId: r.tenant_id,
      company,
      voucherNumber: d.voucher_number || '',
      date: d.date ? new Date(d.date) : null,
    };
    const prov = buildProvenance('voucher', 'vouchers', syncRunId, r);
    prov.rawTallyPayload = d;
    const update = {
      $set: {
        company,
        voucherType: d.voucher_type,
        voucherNumber: d.voucher_number || '',
        date: d.date ? new Date(d.date) : null,
        partyName: d.party_name,
        partyLedgerName: d.party_name,
        amount: d.amount,
        narration: d.narration,
        reference: d.reference,
        entries: d.entries || [],
        gstDetails: d.gst_details || {},
        source: 'tally',
        traceId: r.trace_id || traceId,
        rawRef: r.raw_ref,
        syncedAt: new Date(),
        provenance: prov,
      },
    };
    const res = await TallyVoucher.updateOne(filter, update, { upsert: true });
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  return { created, updated, total: records.length };
}

/**
 * Full sync run: companies → parties → outstanding → vouchers.
 * Records a TallySyncRun evidence row (mirrors Setu-Aman RUNTIME_EVIDENCE).
 */
/**
 * Sync entry point. Runs persistence + bridge inside the connector's
 * workspace scope so raw Tally* snapshots and bridged ARTHA records get
 * companyId stamped — without a scope they are invisible to every
 * company-scoped query ("Sync Now does nothing").
 */
async function runSync(args = {}) {
  const workspace = await resolveWorkspace(companyName(args.company));
  return runWithScope(
    { workspace, userId: null, role: 'system', crossCompany: false },
    () => runSyncScoped(args),
  );
}

async function runSyncScoped({ company, fromDate, toDate } = {}) {
  const tenant = tenantId();
  const comp = companyName(company);
  const traceId = `tally-sync-${Date.now()}`;

  const run = await TallySyncRun.create({
    tenantId: tenant,
    company: comp,
    connector: 'tally',
    readOnly: true,
    status: 'running',
    startedAt: new Date(),
    provenance: {
      brightConnectionId: brightConnectionId(),
      accountId: accountId(),
      storeId: storeId(),
      storeName: storeName(),
      datasets: ['parties', 'outstanding', 'vouchers'],
    },
  });

  const stats = {};
  const errors = [];
  let mduCount = 0;
  const mduRecords = [];

  try {
    const parties = await connector.fetchAndNormalize('party', { company: comp, traceId });
    stats.parties = await upsertParties(parties, { company: comp, traceId, syncRunId: run.runId });
    mduCount += parties.length;
    mduRecords.push(...parties);

    const outstanding = await connector.fetchAndNormalize('outstanding', { company: comp, traceId });
    stats.outstanding = await upsertOutstanding(outstanding, { company: comp, traceId, syncRunId: run.runId });
    mduCount += outstanding.length;
    mduRecords.push(...outstanding);

    const vouchers = await connector.fetchAndNormalize('voucher', { company: comp, fromDate, toDate, traceId });
    stats.vouchers = await upsertVouchers(vouchers, { company: comp, traceId, syncRunId: run.runId });
    mduCount += vouchers.length;
    mduRecords.push(...vouchers);

    let bridgeResults = null;
    try {
      bridgeResults = await bridgeTallyRecords(mduRecords, tenant, comp);
      stats.bridge = bridgeResults;
    } catch (bridgeErr) {
      stats.bridge = { error: bridgeErr.message };
    }

    run.status = 'completed';
    run.completedAt = new Date();
    run.entityStats = stats;
    run.mduCount = mduCount;
    run.evidence = {
      readOnly: true,
      connector: 'tally',
      envelopeRequests: ['Export Data'],
      protocol: 'tally-xml-gateway',
    };
    await run.save();
  } catch (err) {
    errors.push({ stage: err.stage || 'sync', message: err.message, code: err.code || 'UNKNOWN' });
    run.status = stats.parties ? 'partial' : 'failed';
    run.completedAt = new Date();
    run.entityStats = stats;
    run.errors = errors;
    run.mduCount = mduCount;
    await run.save();
  }

  return {
    runId: run.runId,
    tenantId: tenant,
    company: comp,
    status: run.status,
    entityStats: run.entityStats,
    mduCount: run.mduCount,
    errors: run.errors,
    readOnly: true,
    traceId,
    mduRecords,
  };
}

/**
 * Dealer demo summary: party + outstanding + last billing + payments.
 * Produces the data that flows to SETU insight and then to a MITRA-readable
 * summary. MITRA does NOT compute these figures — ARTHA computes, MITRA presents.
 */
async function getDealerSummary(partyName, { company } = {}) {
  const tenant = tenantId();
  const comp = companyName(company);

  const party = await TallyParty.findOne({
    tenantId: tenant,
    company: comp,
    $or: [{ ledgerName: { $regex: `^${partyName}$`, $options: 'i' } }, { partyName: partyName }],
  });

  const outstanding = await TallyOutstanding.find({
    tenantId: tenant,
    company: comp,
    partyName: { $regex: `^${partyName}$`, $options: 'i' },
  }).sort({ dueDate: 1 });

  const vouchers = await TallyVoucher.find({
    tenantId: tenant,
    company: comp,
    partyName: { $regex: `^${partyName}$`, $options: 'i' },
  }).sort({ date: -1 });

  const sales = vouchers.filter((v) => /sales|invoice/i.test(v.voucherType));
  const receipts = vouchers.filter((v) => /receipt|payment/i.test(v.voucherType));

  const totalOutstanding = outstanding.reduce((s, o) => s + (o.balance || 0), 0);
  const overdue = outstanding.filter((o) => o.daysOverdue > 0);
  const overdueAmount = overdue.reduce((s, o) => s + (o.balance || 0), 0);

  const lastBilling = sales[0] || null;
  const lastPayment = receipts[0] || null;

  const accountStatus = buildAccountStatus({
    party,
    totalOutstanding,
    overdueAmount,
    hasSales: sales.length > 0,
    hasReceipts: receipts.length > 0,
  });

  const insight = buildSetuInsight({
    party,
    totalOutstanding,
    overdueAmount,
    lastBilling,
    lastPayment,
    accountStatus,
  });

  const summary = {
    dealer: party ? party.ledgerName : partyName,
    tenantId: tenant,
    company: comp,
    account: {
      group: party?.group || '',
      type: party?.partyType || 'UNKNOWN',
      gstin: party?.gstin || '',
      pan: party?.pan || '',
      creditLimit: party?.creditLimit || 0,
      openingBalance: party?.openingBalance || 0,
      closingBalance: party?.closingBalance || 0,
    },
    outstanding: {
      total: totalOutstanding,
      bills: outstanding.length,
      overdueAmount,
      overdueBills: overdue.length,
      details: outstanding.map((o) => ({
        billNo: o.billNo,
        billDate: o.billDate ? o.billDate.toISOString().slice(0, 10) : null,
        dueDate: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
        daysOverdue: o.daysOverdue,
        amount: o.amount,
        received: o.received,
        balance: o.balance,
        billType: o.billType,
      })),
    },
    lastBilling: lastBilling
      ? {
          voucherNumber: lastBilling.voucherNumber,
          date: lastBilling.date ? lastBilling.date.toISOString().slice(0, 10) : null,
          amount: lastBilling.amount,
          gstDetails: lastBilling.gstDetails || {},
        }
      : null,
    lastPayment: lastPayment
      ? {
          voucherNumber: lastPayment.voucherNumber,
          date: lastPayment.date ? lastPayment.date.toISOString().slice(0, 10) : null,
          amount: lastPayment.amount,
        }
      : null,
    accountStatus,
    setuInsight: insight,
  };

  summary.mitraReadable = buildMitraReadable(summary);

  return summary;
}

function buildAccountStatus({ party, totalOutstanding, overdueAmount, hasSales, hasReceipts }) {
  const creditLimit = party?.creditLimit || 0;
  const statuses = [];
  if (creditLimit > 0 && totalOutstanding > creditLimit) statuses.push('OVER_CREDIT_LIMIT');
  if (overdueAmount > 0) statuses.push('OVERDUE_BALANCE');
  if (!hasSales) statuses.push('NO_RECENT_SALES');
  if (hasReceipts && totalOutstanding <= 0) statuses.push('CLEARED');
  if (!statuses.length) statuses.push('CLEAR');
  return statuses.join('|');
}

function buildSetuInsight({ party, totalOutstanding, overdueAmount, lastBilling, lastPayment, accountStatus }) {
  return {
    dealer: party?.ledgerName || 'UNKNOWN',
    computedBy: 'ARTHA (MITRA is presentational only)',
    summary: `${party?.ledgerName || 'Dealer'} has outstanding ${totalOutstanding.toFixed(2)} INR across bills; overdue ${overdueAmount.toFixed(2)} INR.`,
    keySignals: [
      totalOutstanding > 0 ? 'OUTSTANDING_BALANCE' : 'NO_OUTSTANDING',
      overdueAmount > 0 ? 'OVERDUE_EXPOSURE' : 'NO_OVERDUE',
      lastBilling ? 'RECENT_BILLING' : 'NO_BILLING',
      lastPayment ? 'RECENT_PAYMENT' : 'NO_PAYMENT',
    ],
    metrics: {
      totalOutstanding,
      overdueAmount,
      lastBillingAmount: lastBilling?.amount || 0,
      lastBillingDate: lastBilling?.date ? lastBilling.date.toISOString().slice(0, 10) : null,
      lastPaymentAmount: lastPayment?.amount || 0,
      lastPaymentDate: lastPayment?.date ? lastPayment.date.toISOString().slice(0, 10) : null,
      accountStatus,
    },
  };
}

function buildMitraReadable(summary) {
  const lines = [
    `DEALER: ${summary.dealer}`,
    `ACCOUNT STATUS: ${summary.accountStatus}`,
    `OUTSTANDING: ${summary.outstanding.total.toFixed(2)} INR (${summary.outstanding.bills} bills)`,
    `OVERDUE: ${summary.outstanding.overdueAmount.toFixed(2)} INR (${summary.outstanding.overdueBills} bills)`,
  ];
  if (summary.lastBilling) {
    lines.push(`LAST BILLING: #${summary.lastBilling.voucherNumber} on ${summary.lastBilling.date} for ${summary.lastBilling.amount.toFixed(2)} INR`);
  }
  if (summary.lastPayment) {
    lines.push(`LAST PAYMENT: #${summary.lastPayment.voucherNumber} on ${summary.lastPayment.date} for ${summary.lastPayment.amount.toFixed(2)} INR`);
  }
  lines.push(`CREDIT LIMIT: ${summary.account.creditLimit.toFixed(2)} INR`);
  lines.push(`GSTIN: ${summary.account.gstin || 'N/A'}`);
  return lines.join('\n');
}

export default {
  runSync,
  getDealerSummary,
  tenantId,
  companyName,
};