import mongoose from 'mongoose';
import './Counter.js';
import Decimal from 'decimal.js';
import companyScope from '../utils/companyScope.js';
import companySettingsService from '../services/companySettings.service.js';

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

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
  },
  customerName: {
    type: String,
    required: true,
  },
  customerEmail: {
    type: String,
    required: false,
    lowercase: true,
    trim: true,
    default: '',
  },
  customerAddress: {
    type: mongoose.Schema.Types.Mixed,
  },
  customerState: {
    type: String,
  },
  customerGSTIN: {
    type: String,
    match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    // Optional - for B2B transactions
  },
  invoiceDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  dueDate: {
    type: Date,
    required: true,
  },
  items: [{
    description: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unitPrice: {
      type: String,
      required: true,
      validate: validateDecimal,
    },
    amount: {
      type: String,
      required: true,
      validate: validateDecimal,
    },
    taxRate: {
      type: Number,
      min: 0,
      max: 100,
    },
    hsnCode: String, // HSN/SAC code for GST
  }],
  
  // Alias for backward compatibility - both items and lines are supported
  lines: {
    type: [{
      description: { type: String, required: true },
      quantity: { type: Number, required: true, min: 0.01 },
      unitPrice: { type: String, required: true, validate: validateDecimal },
      amount: { type: String, required: true, validate: validateDecimal },
      taxRate: { type: Number, min: 0, max: 100 },
      hsnCode: String,
    }],
  },
  subtotal: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  taxRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  taxAmount: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  
  // GST breakdown (for India compliance)
  gstBreakdown: {
    cgst: {
      type: String,
      default: '0',
      validate: validateDecimal,
    },
    sgst: {
      type: String,
      default: '0',
      validate: validateDecimal,
    },
    igst: {
      type: String,
      default: '0',
      validate: validateDecimal,
    },
    cess: {
      type: String,
      default: '0',
      validate: validateDecimal,
    },
  },
  
  // Alias for backward compatibility
  totalTax: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  totalAmount: {
    type: String,
    required: true,
    validate: validateDecimal,
  },
  amountPaid: {
    type: String,
    default: '0',
    validate: validateDecimal,
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'],
    default: 'draft',
  },
  payments: [{
    amount: {
      type: String,
      required: true,
      validate: validateDecimal,
    },
    paymentDate: {
      type: Date,
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    reference: String,
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
    },
    notes: String,
  }],
  notes: String,
  source: {
    type: String,
    enum: ['manual', 'tally-connector', 'upload', 'api'],
    default: 'manual',
    index: true,
  },
  provenance: {
    brightConnectionId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    storeId: { type: String, default: '' },
    storeName: { type: String, default: '' },
    sourceEntity: { type: String, default: '' },
    dataset: { type: String, default: 'invoices' },
    rawTallyPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    syncedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    syncRunId: { type: String, default: '' },
    tallyVoucherId: { type: String, default: '' },
    mitraAction: { type: String, default: '' },
    mitraInsight: { type: String, default: '' },
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
}, {
  timestamps: true,
});

invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

// Additional indexes for performance
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ invoiceDate: -1 });
invoiceSchema.index({ dueDate: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ customerName: 1 });
invoiceSchema.index({ customerName: 1, invoiceDate: -1 });
invoiceSchema.index({ customerEmail: 1 });
invoiceSchema.index({ createdBy: 1 });
invoiceSchema.index({ customerGSTIN: 1 });

// Virtual for amount due using Decimal.js for precision
invoiceSchema.virtual('amountDue').get(function() {
  try {
    const total = new Decimal(this.totalAmount || 0);
    const paid = new Decimal(this.amountPaid || 0);
    return total.minus(paid).toFixed(2);
  } catch {
    return '0.00';
  }
});

invoiceSchema.virtual('invoice_amount').get(function() {
  return this.totalAmount || '0.00';
});

invoiceSchema.virtual('paid_amount').get(function() {
  return this.amountPaid || '0.00';
});

invoiceSchema.virtual('outstanding_amount').get(function() {
  return this.amountDue;
});

// Sync items and lines fields for backward compatibility
invoiceSchema.pre('save', async function(next) {
  try {
    if (this.isNew && !this.invoiceNumber) {
      const Counter = mongoose.model('Counter');
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
      const seq = await Counter.getNextSequence('invoice', { date: dateStr });
      let prefix = 'INV';
      try {
        const settings = await companySettingsService.getSettings();
        const configured = String(settings?.invoiceSettings?.prefix || '')
          .trim()
          .replace(/[^A-Za-z0-9_-]/g, '');
        if (configured) prefix = configured;
      } catch (err) {
        // Settings unavailable - keep the default prefix.
      }
      this.invoiceNumber = `${prefix}-${dateStr}-${String(seq).padStart(4, '0')}`;
    }
    
    // Sync items and lines
    if (this.items && this.items.length > 0 && (!this.lines || this.lines.length === 0)) {
      this.lines = this.items;
    } else if (this.lines && this.lines.length > 0 && (!this.items || this.items.length === 0)) {
      this.items = this.lines;
    }
    
    // Update status based on payments using Decimal.js
    try {
      const total = new Decimal(this.totalAmount || 0);
      const paid = new Decimal(this.amountPaid || 0);
      
      if (this.status !== 'cancelled') {
        if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) {
          this.status = 'paid';
        } else if (paid.greaterThan(0)) {
          this.status = 'partial';
        } else if (this.status === 'sent' && new Date() > this.dueDate) {
          this.status = 'overdue';
        }
      }
    } catch (error) {
      // If decimal parsing fails, use original logic as fallback
      const total = parseFloat(this.totalAmount) || 0;
      const paid = parseFloat(this.amountPaid) || 0;
      
      if (this.status !== 'cancelled') {
        if (paid >= total && total > 0) {
          this.status = 'paid';
        } else if (paid > 0) {
          this.status = 'partial';
        } else if (this.status === 'sent' && new Date() > this.dueDate) {
          this.status = 'overdue';
        }
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});



invoiceSchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
invoiceSchema.plugin(companyScope);
// Unique per workspace — different accounts may hold the same invoice number.
invoiceSchema.index({ companyId: 1, invoiceNumber: 1 }, { unique: true });

export default mongoose.model('Invoice', invoiceSchema);