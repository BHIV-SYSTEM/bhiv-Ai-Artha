import mongoose from 'mongoose';
import './Counter.js';
import Decimal from 'decimal.js';
import companyScope, { getScope } from '../utils/companyScope.js';

// Decimal validation helper
const validateDecimal = {
  validator: function(v) {
    if (v === null || v === undefined) return true;
    try {
      new Decimal(v);
      return true;
    } catch {
      return false;
    }
  },
  message: 'Invalid decimal value'
};

const receiptSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
  },
  path: {
    type: String,
    required: true,
  },
  mimetype: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

const expenseSchema = new mongoose.Schema({
  expenseNumber: {
    type: String,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  vendor: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: [
      'travel',
      'meals',
      'supplies',
      'utilities',
      'rent',
      'insurance',
      'marketing',
      'professional_services',
      'equipment',
      'software',
      'other',
    ],
  },
  amount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  gstRate: {
    type: Number,
    min: 0,
    max: 100,
  },
  taxAmount: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  totalAmount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'other'],
  },
  supplierState: {
    type: String,
  },
  receipts: [receiptSchema],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'recorded'],
    default: 'pending',
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
  },
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedAt: Date,
  rejectionReason: String,
  notes: String,
  source: {
    type: String,
    enum: ['manual', 'tally-connector', 'upload', 'ocr', 'api'],
    default: 'manual',
    index: true,
  },
  provenance: {
    brightConnectionId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    storeId: { type: String, default: '' },
    storeName: { type: String, default: '' },
    sourceEntity: { type: String, default: '' },
    dataset: { type: String, default: 'expenses' },
    rawTallyPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    syncedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    syncRunId: { type: String, default: '' },
    tallyVoucherId: { type: String, default: '' },
    mitraAction: { type: String, default: '' },
    mitraInsight: { type: String, default: '' },
  },
}, {
  timestamps: true,
});

// Additional indexes for performance
expenseSchema.index({ status: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ status: 1, date: -1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ submittedBy: 1 });
expenseSchema.index({ approvedBy: 1 });
expenseSchema.index({ vendor: 1 });
expenseSchema.index({ account: 1 });

// Auto-generate expense number
expenseSchema.pre('save', async function(next) {
  if (this.isNew && !this.expenseNumber) {
    const Counter = mongoose.model('Counter');
    const scope = getScope();
    const wsKey = scope && scope.workspace ? String(scope.workspace) : null;
    const seq = wsKey
      ? await Counter.getNextSequence('expense', { ws: wsKey }, {})
      : await Counter.getNextSequence('expense');
    this.expenseNumber = `EXP-${String(seq).padStart(6, '0')}`;
  }
  next();
});

expenseSchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
expenseSchema.plugin(companyScope);
// Unique per workspace — different accounts may hold the same expense number.
expenseSchema.index({ companyId: 1, expenseNumber: 1 }, { unique: true });

export default mongoose.model('Expense', expenseSchema);