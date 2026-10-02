import mongoose from 'mongoose';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const ledgerEntrySchema = new mongoose.Schema(
  {
    id: {
      type: String,
      default: randomUUID,
      unique: true,
      index: true,
    },
    journal_id: {
      type: String,
      required: true,
      index: true,
    },
    account_id: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['DEBIT', 'CREDIT'],
    },
    amount: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) return false;
          try {
            const num = Number(v);
            return !isNaN(num) && isFinite(num);
          } catch {
            return false;
          }
        },
        message: 'Invalid decimal amount',
      },
    },
    hash: {
      type: String,
      required: true,
      index: true,
    },
    prev_hash: {
      type: String,
      required: true,
      default: '0',
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  }
);

ledgerEntrySchema.index({ journal_id: 1, account_id: 1 });

ledgerEntrySchema.statics.computeHash = function({ journalId, accountId, amount, prevHash }) {
  return crypto
    .createHash('sha256')
    .update(`${journalId}${accountId}${amount}${prevHash}`)
    .digest('hex');
};

ledgerEntrySchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
ledgerEntrySchema.plugin(companyScope);

export default mongoose.model('LedgerEntry', ledgerEntrySchema);
