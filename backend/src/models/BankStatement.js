import mongoose from 'mongoose';
import './Counter.js';
import Decimal from 'decimal.js';
import companyScope from '../utils/companyScope.js';

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

const transactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  reference: {
    type: String,
  },
  debit: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  credit: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  balance: {
    type: String,
    validate: validateDecimal,
  },
  type: {
    type: String,
    enum: ['debit', 'credit'],
    required: true,
  },
  category: {
    type: String,
    enum: [
      'deposit',
      'withdrawal',
      'transfer',
      'payment',
      'fee',
      'interest',
      'refund',
      'other',
    ],
  },
  payee: {
    type: String,
  },
  matched: {
    type: Boolean,
    default: false,
  },
  matchedExpenseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expense',
  },
  matchedInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
  },
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  },
  autoCreated: {
    type: Boolean,
    default: false,
  },
  notes: String,
});

const bankStatementSchema = new mongoose.Schema({
  statementNumber: {
    type: String,
    unique: true,
  },
  accountNumber: {
    type: String,
    required: true,
  },
  bankName: {
    type: String,
    required: true,
  },
  accountHolderName: {
    type: String,
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  openingBalance: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  closingBalance: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  file: {
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
  },
  transactions: [transactionSchema],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  processingError: String,
  totalDebits: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  totalCredits: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  transactionCount: {
    type: Number,
    default: 0,
  },
  reconciliation: {
    matchedExpenses: { type: Number, default: 0 },
    matchedInvoices: { type: Number, default: 0 },
    autoCreatedExpenses: { type: Number, default: 0 },
    journalEntriesCreated: { type: Number, default: 0 },
    reconciledAt: Date,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  processedAt: Date,
}, {
  timestamps: true,
});

// Indexes for performance
bankStatementSchema.index({ status: 1 });
bankStatementSchema.index({ endDate: -1 });
bankStatementSchema.index({ accountNumber: 1 });
bankStatementSchema.index({ 'transactions.date': -1 });

// Auto-generate statement number
bankStatementSchema.pre('save', async function(next) {
  if (this.isNew && !this.statementNumber) {
    const Counter = mongoose.model('Counter');
    const seq = await Counter.getNextSequence('bankStatement');
    this.statementNumber = `STMT-${String(seq).padStart(6, '0')}`;
  }
  next();
});

bankStatementSchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
bankStatementSchema.plugin(companyScope);

export default mongoose.model('BankStatement', bankStatementSchema);
