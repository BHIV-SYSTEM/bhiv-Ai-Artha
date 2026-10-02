import mongoose from 'mongoose';
import companyScope from '../utils/companyScope.js';

const accountBalanceSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true,
  },
  // Workspace (company or personal) that owns this balance row. Balances are
  // strictly per-workspace so one tenant's journals never move another's
  // account balances.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
  },
  balance: {
    type: String,
    default: '0',
    // Stored as string for precision, represents net balance
  },
  debitTotal: {
    type: String,
    default: '0',
  },
  creditTotal: {
    type: String,
    default: '0',
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Additional indexes for performance
accountBalanceSchema.index({ lastUpdated: -1 });
// One balance row per account per workspace (legacy rows have companyId null
// and keep their original one-per-account uniqueness via the partial filter).
accountBalanceSchema.index(
  { account: 1, companyId: 1 },
  { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } }
);

accountBalanceSchema.plugin(companyScope);

export default mongoose.model('AccountBalance', accountBalanceSchema);