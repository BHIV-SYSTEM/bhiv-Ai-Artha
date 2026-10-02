import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

/**
 * TallyParty — snapshot of a Tally party/ledger (dealer) pulled from the
 * Bright Connection Tally gateway by the read-only connector.
 * Additive model: never written back to Tally. ARTHA owns the snapshot.
 */
const tallyPartySchema = new mongoose.Schema({
  partyId: {
    type: String,
    default: () => `TLYPARTY-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  tenantId: {
    type: String,
    default: 'tenant_bright_connection_001',
    index: true,
  },
  company: { type: String, default: '', index: true },
  ledgerName: { type: String, required: true, index: true },
  group: { type: String, default: '' },
  partyType: {
    type: String,
    enum: ['SUNDRY_DEBTOR', 'SUNDRY_CREDITOR', 'OTHER'],
    default: 'OTHER',
  },
  openingBalance: { type: Number, default: 0 },
  closingBalance: { type: Number, default: 0 },
  creditLimit: { type: Number, default: 0 },
  gstin: { type: String, default: '' },
  pan: { type: String, default: '' },
  address: { type: String, default: '' },
  contact: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  source: { type: String, default: 'tally' },
  traceId: { type: String, default: '' },
  rawRef: { type: String, default: '' },
  syncedAt: { type: Date, default: Date.now, index: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  provenance: {
    brightConnectionId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    storeId: { type: String, default: '' },
    storeName: { type: String, default: '' },
    sourceEntity: { type: String, default: 'party' },
    dataset: { type: String, default: 'parties' },
    rawTallyPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    syncedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date, default: Date.now },
    syncRunId: { type: String, default: '' },
    migratedToArtha: { type: Boolean, default: false },
    arthaModelType: { type: String, default: '' },
    arthaRecordId: { type: String, default: '' },
    mitraAction: { type: String, default: '' },
    mitraInsight: { type: String, default: '' },
  },
}, {
  timestamps: true,
});

tallyPartySchema.index({ companyId: 1, tenantId: 1, company: 1, ledgerName: 1 }, { unique: true });

tallyPartySchema.add({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
});
tallyPartySchema.plugin(companyScope);

export default mongoose.model('TallyParty', tallyPartySchema);