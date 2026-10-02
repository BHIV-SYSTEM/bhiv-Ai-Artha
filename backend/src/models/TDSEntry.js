import mongoose from 'mongoose';
import './Counter.js';
import Decimal from 'decimal.js';
import companyScope from '../utils/companyScope.js';

const validateDecimal = {
  validator: (v) => v === '' || v === null || v === undefined || (!isNaN(Number(v)) && isFinite(Number(v))),
  message: '{VALUE} is not a valid decimal amount',
};

const tdsEntrySchema = new mongoose.Schema({
  entryNumber: {
    type: String,
    unique: true,
  },
  
  transactionDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  
  deductee: {
    name: {
      type: String,
      required: true,
    },
    pan: {
      type: String,
      required: true,
      match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    },
    address: String,
  },

  employeeDetails: {
    employeeId: String,
    department: String,
    designation: String,
  },

  salaryDetails: {
    basic: { type: String, validate: validateDecimal },
    hra: { type: String, validate: validateDecimal },
    perquisites: { type: String, validate: validateDecimal },
    otherAllowances: { type: String, validate: validateDecimal },
    deductions: { type: String, validate: validateDecimal },
    employerDeductions: { type: String, validate: validateDecimal },
    taxableSalary: { type: String, validate: validateDecimal },
  },
  
  section: {
    type: String,
    required: true,
    enum: ['194A', '194C', '194H', '194I', '194J', '192', '194Q', 'other'],
  },
  
  nature: {
    type: String,
    required: true,
  },
  
  paymentAmount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  
  tdsRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  tdsAmount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  
  netPayable: {
    type: String,
    validate: validateDecimal,
  },
  
  // Payment details
  challanNumber: String,
  challanDate: Date,
  bankBSR: String,
  
  // Accounting
  expenseAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
  },
  
  tdsPayableAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
  },
  
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'deducted', 'deposited', 'filed'],
    default: 'pending',
  },
  
  // Form 26AS reconciliation
  form26ASMatched: {
    type: Boolean,
    default: false,
  },
  
  // Metadata
  quarter: {
    type: String,
    enum: ['Q1', 'Q2', 'Q3', 'Q4'],
  },
  financialYear: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  notes: String,
}, {
  timestamps: true,
});

// Generate entry number and calculate net payable
tdsEntrySchema.pre('save', async function(next) {
  if (this.isNew && !this.entryNumber) {
    const Counter = mongoose.model('Counter');
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = await Counter.getNextSequence('tdsEntry', { date: dateStr });
    this.entryNumber = `TDS-${dateStr}-${String(seq).padStart(4, '0')}`;
  }
  
  // Calculate net payable
  if (this.paymentAmount && this.tdsAmount) {
    const payment = new Decimal(this.paymentAmount);
    const tds = new Decimal(this.tdsAmount);
    this.netPayable = payment.minus(tds).toString();
  }
  
  next();
});

// Additional indexes for performance
tdsEntrySchema.index({ 'deductee.pan': 1 });
tdsEntrySchema.index({ status: 1 });
tdsEntrySchema.index({ quarter: 1, financialYear: 1 });
tdsEntrySchema.index({ transactionDate: -1 });
tdsEntrySchema.index({ section: 1 });
tdsEntrySchema.index({ createdBy: 1 });
tdsEntrySchema.index({ status: 1, transactionDate: -1 });
tdsEntrySchema.index({ form26ASMatched: 1 });

tdsEntrySchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
tdsEntrySchema.plugin(companyScope);

export default mongoose.model('TDSEntry', tdsEntrySchema);