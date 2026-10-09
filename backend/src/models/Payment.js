import mongoose from 'mongoose';
import './Counter.js';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { getScope } from '../utils/companyScope.js';

const validateDecimal = {
  validator: function(v) {
    if (v === null || v === undefined) return true;
    try { new Decimal(v); return true; } catch { return false; }
  },
  message: 'Invalid decimal value'
};

const paymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    unique: true,
    default: () => `PAY-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
  },
  entityType: {
    type: String,
    enum: ['Invoice', 'Expense', 'TDSEntry', 'Manual'],
    required: true,
    index: true,
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  amount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  currency: {
    type: String,
    default: 'INR',
    uppercase: true,
  },
  paymentMethod: {
    type: String,
    enum: ['NEFT', 'RTGS', 'UPI', 'IMPS', 'Cheque', 'Cash', 'Card', 'NetBanking', 'Other'],
    required: true,
    index: true,
  },
  paymentMode: {
    type: String,
    enum: ['online', 'offline'],
    default: 'online',
  },
  status: {
    type: String,
    enum: ['initiated', 'processing', 'completed', 'failed', 'reversed', 'pending_verification'],
    default: 'initiated',
    index: true,
  },
  failureReason: String,
  retryCount: {
    type: Number,
    default: 0,
  },
  maxRetries: {
    type: Number,
    default: 3,
  },
  lastRetryAt: Date,
  nextRetryAt: Date,

  // Bank details
  bankDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    branch: String,
    upiId: String,
    transactionId: String,
    utrNumber: String,
    chequeNumber: String,
    chequeDate: Date,
    bankReference: String,
  },

  // Payer/Payee
  payer: {
    name: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
  },
  payee: {
    name: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
  },

  // Accounting
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  },
  ledgerEntryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LedgerEntry',
  }],

  // Reconciliation
  reconciled: {
    type: Boolean,
    default: false,
  },
  reconciledAt: Date,
  reconciledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  bankStatementTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankStatement',
  },

  // Traceability
  traceId: {
    type: String,
    index: true,
  },

  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  verifiedAt: Date,

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

paymentSchema.index({ entityType: 1, entityId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ paymentMethod: 1, status: 1 });
paymentSchema.index({ reconciled: 1 });

paymentSchema.pre('save', async function(next) {
  if (this.isNew && !this.paymentReference) {
    const Counter = mongoose.model('Counter');
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const scope = getScope();
    const wsKey = scope && scope.workspace ? String(scope.workspace) : null;
    const seq = wsKey
      ? await Counter.getNextSequence('payment', { ws: wsKey, date: dateStr }, { date: dateStr })
      : await Counter.getNextSequence('payment', { date: dateStr });
    this.paymentReference = `PAYREF-${dateStr}-${String(seq).padStart(4, '0')}`;
  }
  next();
});

paymentSchema.methods.canRetry = function() {
  return this.status === 'failed' && this.retryCount < this.maxRetries;
};

paymentSchema.methods.markFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  this.retryCount += 1;
  this.lastRetryAt = new Date();
  if (this.retryCount < this.maxRetries) {
    const delay = Math.pow(2, this.retryCount) * 60000;
    this.nextRetryAt = new Date(Date.now() + delay);
  }
};

export default mongoose.model('Payment', paymentSchema);
