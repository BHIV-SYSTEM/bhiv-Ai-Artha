import JournalEntry from '../models/JournalEntry.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import TallyVoucher from '../models/TallyVoucher.js';
import ledgerService from './ledger.service.js';
import logger from '../config/logger.js';
import notificationEvent from './notificationEvent.service.js';

/**
 * tallyToArthaBridge — converts Tally voucher/party/outstanding data into
 * ARTHA's core financial models (JournalEntry, Invoice, Expense) so the data
 * appears in dashboard, reports, GST, TDS, etc.
 *
 * Design principles:
 * - Idempotent: uses Tally voucher_number as reference to prevent duplicates
 * - Read-only: never writes back to Tally
 * - Additive: only creates, never deletes or modifies existing ARTHA records
 */

function parseAmount(val) {
  if (!val) return 0;
  const s = String(val).replace(/[₹,\s]/g, '');
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const n = parseFloat(clean);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

function formatAmount(n) {
  return String(Math.abs(Math.round(n * 100) / 100));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a Tally ledger name to a ChartOfAccounts record (case-insensitive
 * exact match). Falls back to the caller's default account so journal
 * vouchers still import when the ledger isn't in the COA yet.
 */
async function resolveLedgerAccount(ledgerName, fallback) {
  const name = String(ledgerName || '').trim();
  if (!name) return fallback;
  const match = await ChartOfAccounts.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    isActive: true,
  });
  return match || fallback;
}

function buildBridgeProvenance(voucher, _tenantId, _company) {
  const raw = voucher;
  return {
    brightConnectionId: raw.brightConnectionId || raw.provenance?.brightConnectionId || process.env.TALLY_BRIGHT_CONNECTION_ID || 'bc_bright_connection_001',
    accountId: raw.accountId || raw.provenance?.accountId || process.env.TALLY_ACCOUNT_ID || 'acct_bright_connection',
    storeId: raw.storeId || raw.provenance?.storeId || process.env.TALLY_STORE_ID || '',
    storeName: raw.storeName || raw.provenance?.storeName || process.env.TALLY_STORE_NAME || '',
    sourceEntity: raw.voucher_type || raw.voucherType || 'voucher',
    dataset: 'tally_vouchers',
    rawTallyPayload: raw,
    syncedAt: new Date(),
    lastSyncedAt: new Date(),
    syncRunId: raw.provenance?.syncRunId || '',
    tallyVoucherId: raw.voucherId || raw.voucher_number || raw.voucherNumber || '',
    mitraAction: '',
    mitraInsight: '',
  };
}

function alreadyImported(voucherNumber) {
  if (!voucherNumber) return false;
  return JournalEntry.exists({ tags: `tally:${voucherNumber}` }).then(Boolean);
}

async function invoiceExists(voucherNumber) {
  if (!voucherNumber) return false;
  return Invoice.exists({ invoiceNumber: voucherNumber }).then(Boolean);
}

async function expenseExists(voucherNumber) {
  if (!voucherNumber) return false;
  return Expense.exists({ expenseNumber: { $regex: voucherNumber } }).then(Boolean);
}

// ─── Sales Voucher → Invoice + JournalEntry ────────────────────────
async function importSalesVoucher(voucher, tenantId, company) {
  const vNum = voucher.voucher_number || voucher.voucherNumber;
  if (await alreadyImported(vNum)) return { imported: false, reason: 'duplicate' };
  if (await invoiceExists(vNum)) return { imported: false, reason: 'duplicate-invoice' };

  const amount = parseAmount(voucher.amount);
  if (amount <= 0) return { imported: false, reason: 'zero-amount' };

  const date = voucher.date ? new Date(voucher.date) : new Date();
  const partyName = voucher.party_name || voucher.partyName || 'Unknown';
  const gst = voucher.gst_details || voucher.gstDetails || {};
  const prov = buildBridgeProvenance(voucher, tenantId, company);

  // Find or create accounts
  let arAccount = await ChartOfAccounts.findOne({ code: '1100', isActive: true });
  let revenueAccount = await ChartOfAccounts.findOne({ code: '4000', isActive: true });
  if (!arAccount) arAccount = await ChartOfAccounts.findOne({ type: 'Asset', isActive: true });
  if (!revenueAccount) revenueAccount = await ChartOfAccounts.findOne({ type: 'Income', isActive: true });

  if (!arAccount || !revenueAccount) {
    logger.warn(`[TALLY-BRIDGE] Missing accounts for sales voucher ${vNum}`);
    return { imported: false, reason: 'missing-accounts' };
  }

  const cgstAccount = await ChartOfAccounts.findOne({ code: '2311', isActive: true });
  const sgstAccount = await ChartOfAccounts.findOne({ code: '2312', isActive: true });
  const igstAccount = await ChartOfAccounts.findOne({ code: '2313', isActive: true });

  if (!arAccount || !revenueAccount) {
    logger.warn(`[TALLY-BRIDGE] Missing accounts for sales voucher ${vNum}`);
    return { imported: false, reason: 'missing-accounts' };
  }

  // GST calculation
  const taxableValue = gst.taxable_value || amount;
  const cgst = parseAmount(gst.cgst);
  const sgst = parseAmount(gst.sgst);
  const igst = parseAmount(gst.igst);

  // Create Invoice with provenance
  const invoice = await Invoice.create({
    invoiceNumber: vNum || `TALLY-${Date.now()}`,
    customerName: partyName,
    customerEmail: `tally-${vNum}@imported.local`,
    invoiceDate: date,
    dueDate: new Date(date.getTime() + 30 * 86400000),
    items: [{ description: `Tally sales voucher ${vNum}`, quantity: 1, unitPrice: String(taxableValue), amount: String(taxableValue) }],
    subtotal: String(taxableValue),
    taxRate: cgst > 0 || sgst > 0 ? 18 : (igst > 0 ? 18 : 0),
    taxAmount: String(cgst + sgst + igst),
    totalAmount: String(amount),
    status: 'sent',
    source: 'tally-connector',
    provenance: prov,
  });

  // Build journal lines
  const lines = [
    { account: arAccount._id, debit: formatAmount(amount), credit: '0', description: `AR - ${partyName}` },
    { account: revenueAccount._id, debit: '0', credit: formatAmount(taxableValue), description: `Revenue - ${partyName}` },
  ];

  if (cgst > 0 && cgstAccount) {
    lines.push({ account: cgstAccount._id, debit: '0', credit: formatAmount(cgst), description: 'Output CGST' });
  }
  if (sgst > 0 && sgstAccount) {
    lines.push({ account: sgstAccount._id, debit: '0', credit: formatAmount(sgst), description: 'Output SGST' });
  }
  if (igst > 0 && igstAccount) {
    lines.push({ account: igstAccount._id, debit: '0', credit: formatAmount(igst), description: 'Output IGST' });
  }

  // Create + post journal entry with provenance
  const entry = await ledgerService.importAndPostJournalEntry({
    date,
    description: `Tally sales - ${partyName} (${vNum})`,
    lines,
    reference: vNum,
    tags: ['tally', `tally:${vNum}`, 'sales'],
    source: 'TALLY_COMPATIBILITY',
    trace_id: `tally-sales-${vNum}`,
    provenance: prov,
  });

  // Mark TallyVoucher as migrated
  await TallyVoucher.updateOne(
    { tenantId, voucherNumber: vNum },
    { $set: { 'provenance.migratedToArtha': true, 'provenance.arthaModelType': 'Invoice', 'provenance.arthaRecordId': String(invoice._id) } }
  ).catch(() => {});

  return { imported: true, type: 'sales', invoiceId: invoice._id, journalEntryId: entry._id };
}

// ─── Receipt Voucher → Payment + JournalEntry ──────────────────────
async function importReceiptVoucher(voucher, tenantId, company) {
  const vNum = voucher.voucher_number || voucher.voucherNumber;
  if (await alreadyImported(vNum)) return { imported: false, reason: 'duplicate' };

  const amount = parseAmount(voucher.amount);
  if (amount <= 0) return { imported: false, reason: 'zero-amount' };

  const date = voucher.date ? new Date(voucher.date) : new Date();
  const partyName = voucher.party_name || voucher.partyName || 'Unknown';
  const prov = buildBridgeProvenance(voucher, tenantId, company);

  let bankAccount = await ChartOfAccounts.findOne({ code: '1010', isActive: true });
  let arAccount = await ChartOfAccounts.findOne({ code: '1100', isActive: true });
  if (!bankAccount) bankAccount = await ChartOfAccounts.findOne({ type: 'Asset', isActive: true });
  if (!arAccount) arAccount = await ChartOfAccounts.findOne({ type: 'Asset', isActive: true, code: { $ne: bankAccount?.code } });

  if (!bankAccount || !arAccount) {
    logger.warn(`[TALLY-BRIDGE] Missing accounts for receipt voucher ${vNum}`);
    return { imported: false, reason: 'missing-accounts' };
  }

  const lines = [
    { account: bankAccount._id, debit: formatAmount(amount), credit: '0', description: `Bank receipt - ${partyName}` },
    { account: arAccount._id, debit: '0', credit: formatAmount(amount), description: `AR reduction - ${partyName}` },
  ];

  const entry = await ledgerService.importAndPostJournalEntry({
    date,
    description: `Tally receipt - ${partyName} (${vNum})`,
    lines,
    reference: vNum,
    tags: ['tally', `tally:${vNum}`, 'receipt'],
    source: 'TALLY_COMPATIBILITY',
    trace_id: `tally-receipt-${vNum}`,
    provenance: prov,
  });

  // Mark TallyVoucher as migrated
  await TallyVoucher.updateOne(
    { tenantId, voucherNumber: vNum },
    { $set: { 'provenance.migratedToArtha': true, 'provenance.arthaModelType': 'JournalEntry', 'provenance.arthaRecordId': String(entry._id) } }
  ).catch(() => {});

  return { imported: true, type: 'receipt', journalEntryId: entry._id };
}

// ─── Payment Voucher → Expense + JournalEntry ──────────────────────
async function importPaymentVoucher(voucher, tenantId, company) {
  const vNum = voucher.voucher_number || voucher.voucherNumber;
  if (await alreadyImported(vNum)) return { imported: false, reason: 'duplicate' };
  if (await expenseExists(vNum)) return { imported: false, reason: 'duplicate-expense' };

  const amount = parseAmount(voucher.amount);
  if (amount <= 0) return { imported: false, reason: 'zero-amount' };

  const date = voucher.date ? new Date(voucher.date) : new Date();
  const partyName = voucher.party_name || voucher.partyName || 'Unknown';
  const prov = buildBridgeProvenance(voucher, tenantId, company);

  let bankAccount = await ChartOfAccounts.findOne({ code: '1010', isActive: true });
  let expenseAccount = await ChartOfAccounts.findOne({ code: '6900', isActive: true });
  if (!bankAccount) bankAccount = await ChartOfAccounts.findOne({ type: 'Asset', isActive: true });
  if (!expenseAccount) expenseAccount = await ChartOfAccounts.findOne({ type: 'Expense', isActive: true });

  if (!bankAccount || !expenseAccount) {
    logger.warn(`[TALLY-BRIDGE] Missing accounts for payment voucher ${vNum}`);
    return { imported: false, reason: 'missing-accounts' };
  }

  // Create Expense record with provenance
  const expense = await Expense.create({
    expenseNumber: `TALLY-${vNum || Date.now()}`,
    date,
    vendor: partyName,
    description: `Tally payment - ${partyName}`,
    category: 'other',
    amount: String(amount),
    totalAmount: String(amount),
    paymentMethod: 'bank_transfer',
    status: 'recorded',
    source: 'tally-connector',
    provenance: prov,
  });

  const lines = [
    { account: expenseAccount._id, debit: formatAmount(amount), credit: '0', description: `Expense - ${partyName}` },
    { account: bankAccount._id, debit: '0', credit: formatAmount(amount), description: `Bank payment - ${partyName}` },
  ];

  const entry = await ledgerService.importAndPostJournalEntry({
    date,
    description: `Tally payment - ${partyName} (${vNum})`,
    lines,
    reference: vNum,
    tags: ['tally', `tally:${vNum}`, 'payment'],
    source: 'TALLY_COMPATIBILITY',
    trace_id: `tally-payment-${vNum}`,
    provenance: prov,
  });

  // Mark TallyVoucher as migrated
  await TallyVoucher.updateOne(
    { tenantId, voucherNumber: vNum },
    { $set: { 'provenance.migratedToArtha': true, 'provenance.arthaModelType': 'Expense', 'provenance.arthaRecordId': String(expense._id) } }
  ).catch(() => {});

  return { imported: true, type: 'payment', expenseId: expense._id, journalEntryId: entry._id };
}

// ─── Journal Voucher → JournalEntry ────────────────────────────────
async function importJournalVoucher(voucher, tenantId, company) {
  const vNum = voucher.voucher_number || voucher.voucherNumber;
  if (await alreadyImported(vNum)) return { imported: false, reason: 'duplicate' };

  const amount = parseAmount(voucher.amount);
  if (amount <= 0) return { imported: false, reason: 'zero-amount' };

  const date = voucher.date ? new Date(voucher.date) : new Date();
  const partyName = voucher.party_name || voucher.partyName || '';
  const narration = voucher.narration || '';
  const prov = buildBridgeProvenance(voucher, tenantId, company);

  // For journal vouchers, we need at least 2 lines from entries
  const entries = voucher.entries || [];
  if (entries.length < 2) {
    logger.warn(`[TALLY-BRIDGE] Journal voucher ${vNum} has < 2 entries, skipping`);
    return { imported: false, reason: 'insufficient-entries' };
  }

  const arAccount = await ChartOfAccounts.findOne({ code: '1100', isActive: true });
  const bankAccount = await ChartOfAccounts.findOne({ code: '1010', isActive: true });
  const defaultAccount = arAccount || bankAccount || await ChartOfAccounts.findOne({ isActive: true });

  if (!defaultAccount) return { imported: false, reason: 'missing-accounts' };

  const lines = [];
  for (const e of entries.slice(0, 10)) {
    const entryAmount = parseAmount(e.amount);
    if (entryAmount === 0) continue;
    const account = await resolveLedgerAccount(e.ledgerName, defaultAccount);
    lines.push({
      account: account._id,
      debit: entryAmount > 0 ? formatAmount(entryAmount) : '0',
      credit: entryAmount < 0 ? formatAmount(-entryAmount) : '0',
      description: e.ledgerName || '',
    });
  }

  // Ensure at least 2 lines
  if (lines.length < 2) return { imported: false, reason: 'insufficient-entries' };

  const entry = await ledgerService.importAndPostJournalEntry({
    date,
    description: `Tally journal - ${partyName} (${vNum})${narration ? ': ' + narration.slice(0, 100) : ''}`,
    lines,
    reference: vNum,
    tags: ['tally', `tally:${vNum}`, 'journal'],
    source: 'TALLY_COMPATIBILITY',
    trace_id: `tally-journal-${vNum}`,
    provenance: prov,
  });

  // Mark TallyVoucher as migrated
  await TallyVoucher.updateOne(
    { tenantId, voucherNumber: vNum },
    { $set: { 'provenance.migratedToArtha': true, 'provenance.arthaModelType': 'JournalEntry', 'provenance.arthaRecordId': String(entry._id) } }
  ).catch(() => {});

  return { imported: true, type: 'journal', journalEntryId: entry._id };
}

// ─── Main bridge function ──────────────────────────────────────────
export async function bridgeTallyRecords(records, tenantId, company) {
  const results = { sales: 0, receipt: 0, payment: 0, journal: 0, skipped: 0, errors: 0, errorDetails: [] };

  // Ensure ChartOfAccounts has default accounts — seed inline if missing
  const requiredAccountCodes = ['1010', '1100', '4000', '6900', '2311', '2312', '2313'];
  const existingAccounts = await ChartOfAccounts.find({ code: { $in: requiredAccountCodes }, isActive: true }).select('code');
  const existingCodes = new Set(existingAccounts.map(a => a.code));
  const missingCodes = requiredAccountCodes.filter(c => !existingCodes.has(c));

  if (missingCodes.length > 0) {
    logger.info(`[TALLY-BRIDGE] Missing required accounts: ${missingCodes.join(', ')} — seeding...`);
    const defaultAccounts = [
      { code: '1000', name: 'Cash', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '2000', name: 'Accounts Payable', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2311', name: 'Output CGST', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2312', name: 'Output SGST', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2313', name: 'Output IGST', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '3000', name: "Owner's Capital", type: 'Equity', subtype: 'Equity', normalBalance: 'credit' },
      { code: '4000', name: 'Sales Revenue', type: 'Income', subtype: 'Operating Revenue', normalBalance: 'credit' },
      { code: '6900', name: 'Miscellaneous Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
    ];
    for (const acct of defaultAccounts) {
      if (!existingCodes.has(acct.code)) {
        try {
          await ChartOfAccounts.findOneAndUpdate({ code: acct.code }, { $setOnInsert: acct }, { upsert: true });
        } catch (e) {
          logger.warn(`[TALLY-BRIDGE] Failed to seed account ${acct.code}: ${e.message}`);
        }
      }
    }
  }

  const vouchers = records.filter((r) => r.entity_type === 'voucher');
  for (const rec of vouchers) {
    try {
      const v = rec.canonical_data;
      let vType = (v.voucher_type || '').toLowerCase().trim();

      // Infer voucher type from context when type is empty
      if (!vType || vType === 'journal') {
        const narration = (v.narration || '').toLowerCase();
        const entries = v.entries || [];
        const entryNames = entries.map(e => (e.ledgerName || '').toLowerCase()).join(' ');
        const party = (v.party_name || '').toLowerCase();
        const allContext = `${narration} ${entryNames} ${party}`;

        if (/sales|invoice|sale|credit.?note|debit.?note|gst|cgst|sgst/.test(allContext) && entries.length >= 2) {
          vType = 'sales';
        } else if (/receipt|payment.?received|bank.*debit|credit.?note/.test(allContext) && !/payment|pay.*to|disbursement/.test(allContext)) {
          vType = 'receipt';
        } else if (/payment|pay.*to|disbursement|bank.*credit|salary|wage/.test(allContext)) {
          vType = 'payment';
        }
      }

      let result;
      if (vType === 'sales' || vType === 'credit note') {
        result = await importSalesVoucher(v, tenantId, company);
        if (result.imported) results.sales++;
      } else if (vType === 'receipt' || vType === 'debit note') {
        result = await importReceiptVoucher(v, tenantId, company);
        if (result.imported) results.receipt++;
      } else if (vType === 'payment') {
        result = await importPaymentVoucher(v, tenantId, company);
        if (result.imported) results.payment++;
      } else if (vType === 'journal') {
        result = await importJournalVoucher(v, tenantId, company);
        if (result.imported) results.journal++;
      } else {
        // Last resort: try to import as journal if it has >= 2 entries
        const entries = v.entries || [];
        if (entries.length >= 2) {
          result = await importJournalVoucher(v, tenantId, company);
          if (result.imported) results.journal++;
        } else {
          results.skipped++;
        }
      }
      if (result && !result.imported && result.reason) {
        results.errorDetails.push({ voucher: v.voucher_number || v.voucherNumber, reason: result.reason });
      }
    } catch (err) {
      logger.error(`[TALLY-BRIDGE] Error importing voucher: ${err.message}`);
      results.errors++;
      results.errorDetails.push({ voucher: rec.canonical_data?.voucher_number, error: err.message });
    }
  }

  logger.info(`[TALLY-BRIDGE] Completed: ${results.sales} sales, ${results.receipt} receipts, ${results.payment} payments, ${results.journal} journals, ${results.skipped} skipped, ${results.errors} errors`);

  notificationEvent.tallySyncComplete(results).catch(() => {});

  return results;
}