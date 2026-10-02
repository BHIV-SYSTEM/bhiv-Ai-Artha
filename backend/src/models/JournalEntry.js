import mongoose from 'mongoose';
import './Counter.js';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const journalLineSchema = new mongoose.Schema({
  id: {
    type: String,
    default: randomUUID,
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true,
  },
  debit: {
    type: String,
    default: '0',
    validate: {
      validator: function(v) {
        try {
          new Decimal(v);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid decimal value for debit'
    },
  },
  credit: {
    type: String,
    default: '0',
    validate: {
      validator: function(v) {
        try {
          new Decimal(v);
          return true;
        } catch {
          return false;
        }
      },
      message: 'Invalid decimal value for credit'
    },
  },
  description: String,
}, { _id: false });

const auditTraceSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
  },
  entity_id: {
    type: String,
    required: true,
  },
  before_state: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  after_state: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  action_user: {
    type: String,
    default: null,
  },
  timestamp: {
    type: String,
    required: true,
  },
  trace_id: {
    type: String,
    required: true,
  },
}, { _id: false });

const gstDetailSchema = new mongoose.Schema({
  transaction_type: {
    type: String,
    enum: ['sale', 'purchase'],
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  gst_rate: {
    type: Number,
    required: true,
  },
  supplier_state: {
    type: String,
    required: true,
  },
  company_state: {
    type: String,
    required: true,
  },
  company_gstin: {
    type: String,
  },
  counterparty_gstin: {
    type: String,
  },
  place_of_supply: {
    type: String,
  },
  reverse_charge: {
    type: Boolean,
    default: false,
  },
  supply_type: {
    type: String,
    enum: ['B2B', 'B2CL', 'B2CS', 'CDNR', 'EXP', 'NIL', 'EXEMPT', 'ZERO_RATED'],
  },
  invoice_type: {
    type: String,
  },
  is_export: {
    type: Boolean,
    default: false,
  },
  is_exempt: {
    type: Boolean,
    default: false,
  },
  is_zero_rated: {
    type: Boolean,
    default: false,
  },
  taxable_value: {
    type: String,
    required: true,
  },
  cgst: {
    type: String,
    required: true,
  },
  sgst: {
    type: String,
    required: true,
  },
  igst: {
    type: String,
    required: true,
  },
  total_amount: {
    type: String,
  },
  is_interstate: {
    type: Boolean,
  },
}, { _id: false });

const journalEntrySchema = new mongoose.Schema({
  id: {
    type: String,
    default: randomUUID,
    unique: true,
    index: true,
  },
  entryNumber: {
    type: String,
    unique: true,
    // Format: JE-YYYYMMDD-XXXX
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  description: {
    type: String,
    required: true,
  },
  lines: {
    type: [journalLineSchema],
    validate: {
      validator: function(lines) {
        return lines && lines.length >= 2;
      },
      message: 'Journal entry must have at least 2 lines',
    },
  },
  reference: {
    type: String,
    // External reference: invoice number, expense ID, etc.
  },
  reference_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
  },
  status: {
    type: String,
    enum: ['DRAFT', 'VALIDATED', 'POSTED', 'VOIDED', 'draft', 'posted', 'voided'],
    default: 'DRAFT',
    index: true,
  },
  source: {
    type: String,
    enum: ['OCR', 'MANUAL', 'SYSTEM', 'TALLY_COMPATIBILITY'],
    default: 'MANUAL',
    index: true,
  },
  provenance: {
    brightConnectionId: { type: String, default: '' },
    accountId: { type: String, default: '' },
    storeId: { type: String, default: '' },
    storeName: { type: String, default: '' },
    sourceEntity: { type: String, default: '' },
    dataset: { type: String, default: 'journal_entries' },
    rawTallyPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    syncedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    syncRunId: { type: String, default: '' },
    tallyVoucherId: { type: String, default: '' },
    mitraAction: { type: String, default: '' },
    mitraInsight: { type: String, default: '' },
  },
  trace_id: {
    type: String,
    default: randomUUID,
    index: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  auditTrace: auditTraceSchema,
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  postedAt: Date,
  voidedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  voidReason: String,

  correctionMetadata: {
    originalTransactionId: String,
    reversalReference: String,
    correctionReason: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    createdAt: Date,
  },
  
  // Enhanced hash-chain fields
  prevHash: {
    type: String,
    default: '0',
    index: true,
  },
  hash: {
    type: String,
    index: true,
  },
  chainPosition: {
    type: Number,
    default: 0,
    index: true,
  },
  hashTimestamp: {
    type: Date,
    default: Date.now,
  },
  
  // Legacy fields (backward compatibility)
  immutable_hash: {
    type: String,
  },
  prev_hash: {
    type: String,
    default: '0',
  },
  immutable_chain_valid: {
    type: Boolean,
    default: true,
  },
  
  // Approval workflow
  approvals: [{
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: Date,
    comment: String,
  }],
  
  // Audit trail
  auditTrail: [auditTraceSchema],

  gstDetails: {
    type: [gstDetailSchema],
    default: undefined,
  },
  
  // Metadata
  tags: [String],
  attachments: [String],
}, {
  timestamps: true,
});

// Additional indexes for performance
journalEntrySchema.index({ date: -1 });
journalEntrySchema.index({ status: 1, date: -1 });
journalEntrySchema.index({ 'lines.account': 1 });
journalEntrySchema.index({ 'lines.account': 1, date: -1 });
journalEntrySchema.index({ postedBy: 1 });
journalEntrySchema.index({ reference: 1 });
journalEntrySchema.index({ tags: 1 });
journalEntrySchema.index({ reference_entry_id: 1 });

// Hash-chain indexes
journalEntrySchema.index({ chainPosition: 1, status: 1 });
journalEntrySchema.index({ hash: 1, prevHash: 1 });

// Static method to compute hash for an entry
journalEntrySchema.statics.computeHash = function(entryData, prevHash = '0') {
  // Stable field ordering for hash computation
  const stableData = {
    entryNumber: entryData.entryNumber,
    date: entryData.date?.toISOString ? entryData.date.toISOString() : new Date(entryData.date).toISOString(),
    description: entryData.description,
    lines: (entryData.lines || [])
      .map(line => ({
        account: line.account?.toString(),
        debit: line.debit || '0',
        credit: line.credit || '0',
      }))
      .sort((a, b) => a.account.localeCompare(b.account)),
    status: entryData.status,
    reference: entryData.reference || '',
    reference_entry_id: entryData.reference_entry_id
      ? entryData.reference_entry_id.toString()
      : undefined,
    gstDetails: entryData.gstDetails ?? undefined,
    prevHash: prevHash,
  };

  const payload = JSON.stringify(stableData);
  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) throw new Error('HMAC_SECRET environment variable is required');

  return crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');
};

// Instance method to verify hash
journalEntrySchema.methods.verifyHash = function() {
  const computedHash = this.constructor.computeHash(this.toObject(), this.prevHash);
  if (computedHash.length !== this.hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(this.hash, 'hex'));
};

// Instance method to verify entire chain from this entry back to genesis
journalEntrySchema.methods.verifyChainFromEntry = async function() {
  const JournalEntry = this.constructor;
  const errors = [];
  let currentEntry = this;

  // Start from this entry and walk backwards
  for (let i = 0; i < 1000; i++) {
    if (!currentEntry.verifyHash()) {
      errors.push({
        position: currentEntry.chainPosition,
        entryNumber: currentEntry.entryNumber,
        issue: 'Hash mismatch',
        expected: currentEntry.hash,
        computed: JournalEntry.computeHash(currentEntry.toObject(), currentEntry.prevHash),
      });
      break;
    }

    // If at genesis (prevHash is '0'), we've verified the chain
    if (currentEntry.prevHash === '0') {
      return {
        isValid: errors.length === 0,
        totalEntriesVerified: i + 1,
        errors,
      };
    }

    // Find previous entry
    currentEntry = await JournalEntry.findOne({ hash: currentEntry.prevHash });

    if (!currentEntry) {
      errors.push({
        position: i,
        issue: 'Previous entry not found',
        prevHash: currentEntry?.prevHash,
      });
      break;
    }
  }

  return {
    isValid: false,
    totalEntriesVerified: 1000,
    errors,
  };
};

// Legacy method for backward compatibility
journalEntrySchema.methods.calculateHash = function() {
  const payload = {
    entryNumber: this.entryNumber || 'TEMP',
    date: this.date.toISOString(),
    description: this.description,
    lines: this.lines,
    prev_hash: this.prev_hash || this.prevHash,
    status: this.status,
  };
  
  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) throw new Error('HMAC_SECRET environment variable is required');
  const hmac = crypto.createHmac('sha256', hmacSecret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
};

// Generate entry number and hash
journalEntrySchema.pre('save', async function(next) {
  if (this.isNew && !this.entryNumber) {
    const Counter = mongoose.model('Counter');
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = await Counter.getNextSequence('journalEntry', { date: dateStr });
    this.entryNumber = `JE-${dateStr}-${String(seq).padStart(4, '0')}`;
  }
  
  // Set chain position for new entries
  if (this.isNew) {
    const Counter = mongoose.model('Counter');
    const chainPos = await Counter.getNextSequence('journalChain');
    this.chainPosition = chainPos - 1;
    
    const lastEntry = await mongoose.model('JournalEntry')
      .findOne({ status: { $in: ['POSTED', 'posted'] } })
      .sort({ chainPosition: -1 })
      .select('hash');
    
    this.prevHash = lastEntry ? lastEntry.hash : '0';
    this.prev_hash = this.prevHash;
  }
  
  // Calculate hash after entryNumber is set
  if (this.isNew || this.isModified('status') || this.isModified('lines')) {
    this.hash = this.constructor.computeHash(this.toObject(), this.prevHash);
    this.immutable_hash = this.hash; // Backward compatibility
    this.hashTimestamp = new Date();
  }
  
  next();
});

journalEntrySchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
journalEntrySchema.plugin(companyScope);

export default mongoose.model('JournalEntry', journalEntrySchema);