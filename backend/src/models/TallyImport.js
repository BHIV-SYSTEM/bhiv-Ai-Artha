import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const tallyImportSchema = new mongoose.Schema({
  importId: {
    type: String,
    unique: true,
    default: () => `TLYIMP-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  importType: {
    type: String,
    enum: ['vouchers', 'masters', 'opening_balances', 'gst_data', 'tds_data', 'full_import'],
    required: true,
    index: true,
  },
  format: {
    type: String,
    enum: ['xml', 'csv', 'json', 'xlsx'],
    default: 'xml',
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  file: {
    filename: String,
    path: String,
    mimetype: String,
    size: Number,
  },
  status: {
    type: String,
    enum: ['pending', 'validating', 'processing', 'completed', 'partial', 'failed'],
    default: 'pending',
    index: true,
  },
  validationResults: {
    totalRecords: { type: Number, default: 0 },
    validRecords: { type: Number, default: 0 },
    invalidRecords: { type: Number, default: 0 },
    warnings: [{ type: mongoose.Schema.Types.Mixed }],
    validationErrors: [{
      line: Number,
      field: String,
      message: String,
      severity: { type: String, enum: ['error', 'warning'], default: 'error' },
    }],
  },
  importResults: {
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  mapping: {
    voucherTypeMap: { type: mongoose.Schema.Types.Mixed, default: {} },
    accountMap: { type: mongoose.Schema.Types.Mixed, default: {} },
    partyMap: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  importedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

tallyImportSchema.index({ companyId: 1, importType: 1 });
tallyImportSchema.index({ status: 1, createdAt: -1 });

tallyImportSchema.plugin(companyScope);

export default mongoose.model('TallyImport', tallyImportSchema);
