import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const financialPeriodSchema = new mongoose.Schema({
  periodId: {
    type: String,
    unique: true,
    default: () => `FP-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  financialYear: {
    type: String,
    required: true,
    index: true,
    // Format: FY2025-26
  },
  periodType: {
    type: String,
    enum: ['month', 'quarter', 'year'],
    required: true,
    index: true,
  },
  periodNumber: {
    type: Number,
    required: true,
    // Month: 1-12, Quarter: 1-4, Year: 1
  },
  periodName: {
    type: String,
    required: true,
    // e.g., "April 2025", "Q1 FY2025-26", "FY2025-26"
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['open', 'closing', 'closed', 'locked'],
    default: 'open',
    index: true,
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  closedAt: Date,
  lockReason: String,

  // Close checklist
  closeChecklist: {
    allJournalsPosted: { type: Boolean, default: false },
    depreciationPosted: { type: Boolean, default: false },
    accrualsPosted: { type: Boolean, default: false },
    bankReconciled: { type: Boolean, default: false },
    gstReconciled: { type: Boolean, default: false },
    tdsReconciled: { type: Boolean, default: false },
    receivablesVerified: { type: Boolean, default: false },
    payablesVerified: { type: Boolean, default: false },
    trialBalanceBalanced: { type: Boolean, default: false },
    adjustmentsPosted: { type: Boolean, default: false },
  },

  // Period totals (snapshot at close)
  periodSnapshot: {
    totalAssets: String,
    totalLiabilities: String,
    totalEquity: String,
    totalIncome: String,
    totalExpenses: String,
    netIncome: String,
    totalDebits: String,
    totalCredits: String,
    journalEntryCount: Number,
    transactionCount: Number,
  },

  // GST filing status
  gstFiling: {
    gstr1Status: { type: String, enum: ['pending', 'filed', 'verified'], default: 'pending' },
    gstr3bStatus: { type: String, enum: ['pending', 'filed', 'verified'], default: 'pending' },
    gstr1FiledAt: Date,
    gstr3bFiledAt: Date,
  },

  // TDS filing status
  tdsFiling: {
    form26qStatus: { type: String, enum: ['pending', 'filed', 'verified'], default: 'pending' },
    form24qStatus: { type: String, enum: ['pending', 'filed', 'verified'], default: 'pending' },
    filedAt: Date,
  },

  // Reconciliation status
  reconciliation: {
    bankReconciled: { type: Boolean, default: false },
    bankReconciledAt: Date,
    gstReconciled: { type: Boolean, default: false },
    gstReconciledAt: Date,
    tdsReconciled: { type: Boolean, default: false },
    tdsReconciledAt: Date,
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

financialPeriodSchema.index({ companyId: 1, financialYear: 1, periodType: 1 });
financialPeriodSchema.index({ status: 1, startDate: 1 });
financialPeriodSchema.index({ financialYear: 1, periodType: 1, periodNumber: 1 });

financialPeriodSchema.statics.getCurrentFY = function() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) {
    return `FY${year}-${String(year + 1).slice(2)}`;
  }
  return `FY${year - 1}-${String(year).slice(2)}`;
};

financialPeriodSchema.statics.getCurrentQuarter = function() {
  const now = new Date();
  const month = now.getMonth() + 1;
  if (month >= 4 && month <= 6) return 'Q1';
  if (month >= 7 && month <= 9) return 'Q2';
  if (month >= 10 && month <= 12) return 'Q3';
  return 'Q4';
};

financialPeriodSchema.statics.getCurrentMonth = function() {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[now.getMonth()];
};

financialPeriodSchema.plugin(companyScope);

export default mongoose.model('FinancialPeriod', financialPeriodSchema);
