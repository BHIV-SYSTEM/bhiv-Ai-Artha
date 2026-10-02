import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const validateDecimal = {
  validator: (v) => v === '' || v === null || v === undefined || (!isNaN(Number(v)) && isFinite(Number(v))),
  message: '{VALUE} is not a valid decimal amount',
};

const reconcileRecordSchema = new mongoose.Schema({
  reconcileId: {
    type: String,
    unique: true,
    default: () => `REC-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  reconcileType: {
    type: String,
    enum: ['bank', 'gst', 'tds', 'intercompany', 'vendor', 'customer'],
    required: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  period: {
    financialYear: String,
    quarter: String,
    month: String,
  },
  status: {
    type: String,
    enum: ['in_progress', 'completed', 'discrepancy', 'resolved'],
    default: 'in_progress',
    index: true,
  },
  summary: {
    totalItems: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    unmatched: { type: Number, default: 0 },
    discrepancyCount: { type: Number, default: 0 },
    totalDiscrepancyAmount: { type: String, default: '0', validate: validateDecimal },
  },
  items: [{
    sourceType: String,
    sourceId: String,
    sourceAmount: { type: String, validate: validateDecimal },
    targetType: String,
    targetId: String,
    targetAmount: { type: String, validate: validateDecimal },
    difference: { type: String, validate: validateDecimal },
    status: {
      type: String,
      enum: ['matched', 'unmatched', 'partial', 'discrepancy'],
    },
    notes: String,
  }],
  reconciledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  verifiedAt: Date,
  journalEntryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  }],
  traceId: String,
}, {
  timestamps: true,
});

reconcileRecordSchema.index({ reconcileType: 1, companyId: 1 });
reconcileRecordSchema.index({ status: 1, createdAt: -1 });
reconcileRecordSchema.index({ 'period.financialYear': 1, 'period.quarter': 1 });

reconcileRecordSchema.plugin(companyScope);

export default mongoose.model('ReconcileRecord', reconcileRecordSchema);
