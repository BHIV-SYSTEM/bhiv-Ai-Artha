import mongoose from 'mongoose';
import companyScope from '../utils/companyScope.js';

const companySettingsSchema = new mongoose.Schema({
  // Workspace that owns this settings document (Company._id for company
  // members, User._id for a personal workspace). Legacy singleton documents
  // created before scoping have a string _id and null companyId.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
  },

  // Basic Info
  companyName: {
    type: String,
    required: true,
    default: 'My Company',
  },
  // Form-facing alias of companyName (Company settings tab)
  name: String,
  legalName: String,

  // Address (line1/line2/pincode are used by the settings form;
  // street/postalCode kept for backward compatibility)
  address: {
    line1: String,
    line2: String,
    street: String,
    city: String,
    state: String,
    pincode: String,
    postalCode: String,
    country: {
      type: String,
      default: 'India',
    },
  },
  
  // Contact
  phone: String,
  email: String,
  website: String,
  
  // India Statutory IDs
  gstin: {
    type: String,
    match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  },
  gstinRegistrations: [{
    gstin: {
      type: String,
      match: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
    },
    state: String,
    branchCode: String,
    isPrimary: {
      type: Boolean,
      default: false,
    },
  }],
  pan: {
    type: String,
    match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
  },
  tan: {
    type: String,
    match: /^[A-Z]{4}[0-9]{5}[A-Z]{1}$/,
  },
  cin: String, // Corporate Identification Number
  
  // Bank Details (settings form)
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    ifscCode: String,
    branch: String,
  },

  // Bank Accounts (legacy array form)
  bankAccounts: [{
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountType: {
      type: String,
      enum: ['savings', 'current'],
    },
    isPrimary: Boolean,
  }],
  
  // GST Settings
  gstSettings: {
    isRegistered: {
      type: Boolean,
      default: true,
    },
    filingFrequency: {
      type: String,
      enum: ['monthly', 'quarterly'],
      default: 'monthly',
    },
    compositionScheme: {
      type: Boolean,
      default: false,
    },
    reverseChargeMechanism: {
      type: Boolean,
      default: false,
    },
  },
  
  // TDS Settings
  tdsSettings: {
    isTANActive: {
      type: Boolean,
      default: true,
    },
    defaultTDSRate: Number,
    autoCalculateTDS: {
      type: Boolean,
      default: true,
    },
  },
  
  // Accounting Settings
  accountingSettings: {
    financialYearStart: {
      month: {
        type: Number,
        default: 4, // April
      },
      day: {
        type: Number,
        default: 1,
      },
    },
    baseCurrency: {
      type: String,
      default: 'INR',
    },
    decimalPlaces: {
      type: Number,
      default: 2,
    },
  },
  
  // Invoice Settings (settings form)
  invoiceSettings: {
    prefix: { type: String, default: 'INV' },
    nextNumber: { type: Number, default: 1 },
    termsAndConditions: String,
    notes: String,
  },

  // Financial year (settings form)
  financialYear: {
    startMonth: { type: Number, default: 4 },
    startDay: { type: Number, default: 1 },
  },

  // Logo
  logo: {
    filename: String,
    path: String,
  },
}, {
  timestamps: true,
});

// Additional indexes for performance
companySettingsSchema.index({ gstin: 1 });
companySettingsSchema.index({ pan: 1 });
companySettingsSchema.index({ tan: 1 });
companySettingsSchema.index({ 'gstSettings.isRegistered': 1 });
companySettingsSchema.index({ 'tdsSettings.isTANActive': 1 });
// One settings document per workspace (legacy singleton has null companyId)
companySettingsSchema.index(
  { companyId: 1 },
  { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } }
);

companySettingsSchema.plugin(companyScope);

export default mongoose.model('CompanySettings', companySettingsSchema);