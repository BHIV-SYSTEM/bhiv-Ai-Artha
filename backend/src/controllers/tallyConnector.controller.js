import adapter from '../tallyIntegration/tallyAdapter.service.js';
import connector from '../tallyIntegration/tallyConnector.service.js';
import setuBridge from '../tallyIntegration/tallySetuBridge.service.js';
import tallySyncScheduler from '../services/tallySyncScheduler.service.js';
import { getMaskedConfig } from '../tallyIntegration/tallyXmlClient.js';
import TallyParty from '../models/TallyParty.js';
import TallyOutstanding from '../models/TallyOutstanding.js';
import TallyVoucher from '../models/TallyVoucher.js';
import TallySyncRun from '../models/TallySyncRun.js';
import TallyConnectorCredential, {
  generateApiKey,
  generateHmacSecret,
} from '../models/TallyConnectorCredential.js';

/**
 * tallyConnector.controller — HTTP surface for the read-only Tally connector.
 * Endpoints under /api/v1/tally-connect.
 */

function paramCompany(req) {
  return req.query.company || '';
}

export const getConfig = async (req, res) => {
  res.json({ success: true, data: getMaskedConfig() });
};

export const getManifest = async (req, res) => {
  res.json({ success: true, data: connector.manifest() });
};

export const getHealth = async (req, res) => {
  try {
    const result = await connector.authenticate();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message, code: err.code });
  }
};

export const runSync = async (req, res) => {
  try {
    const result = await adapter.runSync({
      company: req.body.company,
      fromDate: req.body.fromDate,
      toDate: req.body.toDate,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};

export const listParties = async (req, res) => {
  const tenant = adapter.tenantId();
  const company = paramCompany(req);
  const filter = { tenantId: tenant };
  if (company) filter.company = company;
  if (req.query.group) filter.partyType = { $regex: `^${req.query.group}$`, $options: 'i' };
  if (req.query.search) filter.ledgerName = { $regex: req.query.search, $options: 'i' };
  const parties = await TallyParty.find(filter).sort({ ledgerName: 1 }).limit(500);
  res.json({ success: true, data: parties });
};

export const listOutstanding = async (req, res) => {
  const tenant = adapter.tenantId();
  const company = paramCompany(req);
  const filter = { tenantId: tenant };
  if (company) filter.company = company;
  if (req.query.party) filter.partyName = { $regex: `^${req.query.party}$`, $options: 'i' };
  if (req.query.overdue === 'true') filter.daysOverdue = { $gt: 0 };
  const records = await TallyOutstanding.find(filter).sort({ daysOverdue: -1 }).limit(1000);
  res.json({ success: true, data: records });
};

export const listVouchers = async (req, res) => {
  const tenant = adapter.tenantId();
  const company = paramCompany(req);
  const filter = { tenantId: tenant };
  if (company) filter.company = company;
  if (req.query.party) filter.partyName = { $regex: `^${req.query.party}$`, $options: 'i' };
  if (req.query.type) filter.voucherType = { $regex: req.query.type, $options: 'i' };
  const records = await TallyVoucher.find(filter).sort({ date: -1 }).limit(1000);
  res.json({ success: true, data: records });
};

export const dealerSummary = async (req, res) => {
  try {
    const partyName = req.params.partyName;
    const summary = await adapter.getDealerSummary(partyName, { company: paramCompany(req) });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};

export const dealerSetu = async (req, res) => {
  try {
    const partyName = req.params.partyName;
    const summary = await adapter.getDealerSummary(partyName, { company: paramCompany(req) });

    const record = {
      entity_type: 'dealer_summary',
      entity_id: `dealer:${partyName}`,
      tenant_id: summary.tenantId,
      source_connector: 'tally',
      read_only: true,
      company: summary.company,
      canonical_data: summary,
      trace_id: `tally-dealer-${Date.now()}`,
      schema_version: '1.0.0',
      idempotency_key: `${summary.tenantId}:dealer_summary:${partyName}`,
    };

    const outcomes = await setuBridge.dispatchRecord(record, {
      signalId: 'SIG_TALLY_DEALER_OUTSTANDING',
      entityType: 'dealer_summary',
      entityId: record.entity_id,
    });

    res.json({ success: true, data: { summary, outcomes } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};

export const exportMdu = async (req, res) => {
  const records = await setuBridge.exportMduRecords({ tenantId: req.query.tenantId });
  res.json({ success: true, count: records.length, data: records });
};

export const listSyncRuns = async (req, res) => {
  const runs = await TallySyncRun.find({}).sort({ startedAt: -1 }).limit(50);
  res.json({ success: true, data: runs });
};

export const syncNow = async (req, res) => {
  try {
    const result = await tallySyncScheduler.runOnce({ company: req.body.company });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, code: err.code });
  }
};

/**
 * GET /tally-connect/credentials — issue (on first call) and return the
 * calling account's connector credentials. Bound to req.workspaceId so data
 * pushed with them is visible only to this account.
 */
export const getCredentials = async (req, res) => {
  try {
    const workspace = req.workspaceId;
    if (!workspace) {
      return res.status(400).json({ success: false, message: 'No workspace for this account' });
    }
    let cred = await TallyConnectorCredential.findOne({ workspaceId: workspace });
    if (!cred) {
      cred = await TallyConnectorCredential.create({
        workspaceId: workspace,
        apiKey: generateApiKey(),
        hmacSecret: generateHmacSecret(),
        label: `${req.user?.name || 'Account'} connector`,
      });
    }
    res.json({
      success: true,
      data: {
        cloudUrl: `${req.protocol}://${req.get('host')}`,
        apiKey: cred.apiKey,
        hmacSecret: cred.hmacSecret,
        active: cred.active,
        createdAt: cred.createdAt,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      // Race: another request issued it first — re-read and return.
      const existing = await TallyConnectorCredential.findOne({ workspaceId: req.workspaceId });
      if (existing) {
        return res.json({
          success: true,
          data: {
            cloudUrl: `${req.protocol}://${req.get('host')}`,
            apiKey: existing.apiKey,
            hmacSecret: existing.hmacSecret,
            active: existing.active,
            createdAt: existing.createdAt,
          },
        });
      }
    }
    res.status(500).json({ success: false, message: 'Could not issue connector credentials' });
  }
};

/** POST /tally-connect/credentials/rotate — regenerate this account's keys. */
export const rotateCredentials = async (req, res) => {
  try {
    const workspace = req.workspaceId;
    if (!workspace) {
      return res.status(400).json({ success: false, message: 'No workspace for this account' });
    }
    const cred = await TallyConnectorCredential.findOneAndUpdate(
      { workspaceId: workspace },
      {
        $set: { apiKey: generateApiKey(), hmacSecret: generateHmacSecret(), active: true },
        $setOnInsert: { workspaceId: workspace },
      },
      { upsert: true, new: true },
    );
    res.json({
      success: true,
      data: {
        cloudUrl: `${req.protocol}://${req.get('host')}`,
        apiKey: cred.apiKey,
        hmacSecret: cred.hmacSecret,
        active: cred.active,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not rotate credentials' });
  }
};

export const syncStatus = async (req, res) => {
  res.json({ success: true, data: tallySyncScheduler.status() });
};

export const readonlyProof = async (req, res) => {
  res.json({
    success: true,
    data: {
      connector: connector.manifest(),
      readOnly: true,
      guard: 'assertReadOnlyEnvelope() rejects any non-Export TALLYREQUEST before it reaches the wire',
      allowedRequests: ['Export Data', 'Export'],
      evidence: 'See tests: unauthorized-write-attempt & read-only-proof',
    },
  });
};

export default {
  getConfig,
  getManifest,
  getHealth,
  runSync,
  listParties,
  listOutstanding,
  listVouchers,
  dealerSummary,
  dealerSetu,
  exportMdu,
  listSyncRuns,
  syncNow,
  syncStatus,
  readonlyProof,
  getCredentials,
  rotateCredentials,
};