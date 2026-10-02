import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

/**
 * TallySyncRun — provenance/evidence record for each connector sync run.
 * Mirrors the Setu-Aman runtime evidence concept (RUNTIME_EVIDENCE.json).
 */
const tallySyncRunSchema = new mongoose.Schema({
  runId: {
    type: String,
    default: () => `TLYSYNC-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  tenantId: {
    type: String,
    default: 'tenant_bright_connection_001',
    index: true,
  },
  company: { type: String, default: '' },
  connector: { type: String, default: 'tally' },
  readOnly: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['running', 'completed', 'partial', 'failed'],
    default: 'running',
    index: true,
  },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  entityStats: { type: mongoose.Schema.Types.Mixed, default: {} },
  errors: [{ type: mongoose.Schema.Types.Mixed, default: {} }],
  mduCount: { type: Number, default: 0 },
  setuDispatched: { type: Boolean, default: false },
  setuDispatch: { type: mongoose.Schema.Types.Mixed, default: {} },
  evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  provenance: {
    brightConnectionId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    storeId: { type: String, default: '' },
    storeName: { type: String, default: '' },
    datasets: [{ type: String }],
    rawPayloadReceived: { type: Number, default: 0 },
    rawPayloadSize: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
  suppressReservedKeysWarning: true,
});

tallySyncRunSchema.index({ tenantId: 1, status: 1, startedAt: -1 });

tallySyncRunSchema.add({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
});
tallySyncRunSchema.plugin(companyScope);

export default mongoose.model('TallySyncRun', tallySyncRunSchema);