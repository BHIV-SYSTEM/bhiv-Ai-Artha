import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

/**
 * ReceivableReport — an uploaded "list of outstanding due" / receivables
 * statement (e.g. BizAnalyst export) parsed into customers → bills → aging.
 *
 * Everything is derived from the file itself: customers, per-bill rows,
 * day counts and aging buckets are never hard-coded. `integrity` records
 * whether the parsed rows reconcile with the totals declared in the document.
 */
const receivableBillSchema = new mongoose.Schema(
  {
    date: { type: Date, default: null },
    ref: { type: String, default: null },
    amount: { type: Number, default: 0 },
    dueDate: { type: Date, default: null },
    daysOverdue: { type: Number, default: 0 },
    bucket: {
      type: String,
      enum: ['current', '1-30', '31-60', '61-90', '90+'],
      default: 'current',
    },
  },
  { _id: false }
);

const receivableCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    group: { type: String, default: '' },
    statedTotal: { type: Number, default: null },
    computedTotal: { type: Number, default: 0 },
    aging: {
      current: { type: Number, default: 0 },
      '1-30': { type: Number, default: 0 },
      '31-60': { type: Number, default: 0 },
      '61-90': { type: Number, default: 0 },
      '90+': { type: Number, default: 0 },
    },
    bills: [receivableBillSchema],
  },
  { _id: false }
);

const receivableReportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      unique: true,
      default: () => `RCV-${randomUUID()}`,
      immutable: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      index: true,
    },
    fileName: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, default: 'smart-upload' },
    title: { type: String, default: '' },
    group: { type: String, default: '' },
    asOfDate: { type: Date, default: null, index: true },
    declared: {
      customers: { type: Number, default: null },
      amount: { type: Number, default: null },
    },
    summary: {
      customerCount: { type: Number, default: 0 },
      billCount: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
      aging: {
        current: { type: Number, default: 0 },
        '1-30': { type: Number, default: 0 },
        '31-60': { type: Number, default: 0 },
        '61-90': { type: Number, default: 0 },
        '90+': { type: Number, default: 0 },
      },
    },
    integrity: {
      declaredCustomers: { type: Number, default: null },
      parsedCustomers: { type: Number, default: 0 },
      customersMatch: { type: Boolean, default: null },
      declaredTotal: { type: Number, default: null },
      computedTotal: { type: Number, default: 0 },
      totalMatches: { type: Boolean, default: null },
      customerTotalMismatches: { type: Number, default: 0 },
      mismatchedCustomers: [{ type: String }],
      billCount: { type: Number, default: 0 },
    },
    customers: [receivableCustomerSchema],
  },
  { timestamps: true }
);

receivableReportSchema.index({ companyId: 1, createdAt: -1 });
receivableReportSchema.plugin(companyScope);

export default mongoose.model('ReceivableReport', receivableReportSchema);
