import mongoose from 'mongoose';
import companyScope from '../utils/companyScope.js';

const gstReturnSchema = new mongoose.Schema({
  returnType: {
    type: String,
    required: true,
    enum: ['GSTR1', 'GSTR3B', 'GSTR9'],
    // GSTR1: Outward supplies, GSTR3B: Summary, GSTR9: Annual
  },
  period: {
    month: {
      type: Number,
      min: 1,
      max: 12,
      required: function() {
        return this.returnType === 'GSTR1' || this.returnType === 'GSTR3B';
      },
    },
    year: {
      type: Number,
      required: true,
    },
    quarter: Number,
  },
  gstin: {
    type: String,
    required: true,
    match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  },
  
  // GSTR1 fields (Outward Supplies)
  b2b: [{
    // Business to Business
    customerGSTIN: String,
    customerName: String,
    invoiceNumber: String,
    invoiceDate: Date,
    invoiceValue: String,
    taxableValue: String,
    cgst: String,
    sgst: String,
    igst: String,
    cess: String,
  }],
  
  b2c: [{
    // Business to Consumer
    invoiceNumber: String,
    invoiceDate: Date,
    invoiceValue: String,
    taxableValue: String,
    cgst: String,
    sgst: String,
    igst: String,
  }],
  
  // GSTR3B fields (Summary)
  outwardSupplies: {
    taxable: String,
    cgst: String,
    sgst: String,
    igst: String,
    cess: String,
  },
  
  inwardSupplies: {
    taxable: String,
    cgst: String,
    sgst: String,
    igst: String,
    itc: String, // Input Tax Credit
  },
  
  netTaxLiability: {
    cgst: String,
    sgst: String,
    igst: String,
    cess: String,
    total: String,
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'filed', 'revised'],
    default: 'draft',
  },
  
  filedDate: Date,
  filedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Portal filing handoff record
  acknowledgementNumber: String,
  portalUrl: String,
  filedVia: {
    type: String,
    enum: ['GST_PORTAL', 'GSP', 'API'],
    default: 'GST_PORTAL',
  },
  
  // Metadata
  jsonData: mongoose.Schema.Types.Mixed, // Full GST JSON format
  notes: String,
}, {
  timestamps: true,
});

// Additional indexes for performance
gstReturnSchema.index({ returnType: 1, 'period.year': 1, 'period.month': 1 });
gstReturnSchema.index({ gstin: 1 });
gstReturnSchema.index({ status: 1 });
gstReturnSchema.index({ filedDate: -1 });
gstReturnSchema.index({ filedBy: 1 });
gstReturnSchema.index({ gstin: 1, status: 1 });
gstReturnSchema.index({ returnType: 1, status: 1 });

gstReturnSchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
gstReturnSchema.plugin(companyScope);

export default mongoose.model('GSTReturn', gstReturnSchema);