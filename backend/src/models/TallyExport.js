import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const tallyExportSchema = new mongoose.Schema({
  exportId: {
    type: String,
    unique: true,
    default: () => `TLYEXP-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  exportType: {
    type: String,
    enum: ['vouchers', 'masters', 'opening_balances', 'gst_data', 'tds_data', 'full_export'],
    required: true,
    index: true,
  },
  format: {
    type: String,
    enum: ['xml', 'csv', 'json'],
    default: 'xml',
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  dateRange: {
    startDate: Date,
    endDate: Date,
  },
  voucherTypes: [{
    type: String,
    enum: ['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'credit_note', 'debit_note', 'all'],
  }],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true,
  },
  recordCount: {
    type: Number,
    default: 0,
  },
  fileSize: Number,
  filePath: String,
  fileName: String,
  exportErrors: [{
    entityType: String,
    entityId: String,
    error: String,
  }],
  exportedBy: {
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

tallyExportSchema.index({ companyId: 1, exportType: 1 });
tallyExportSchema.index({ status: 1, createdAt: -1 });

tallyExportSchema.plugin(companyScope);

export default mongoose.model('TallyExport', tallyExportSchema);
