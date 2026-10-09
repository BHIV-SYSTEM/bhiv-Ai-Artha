import mongoose from 'mongoose';
import { getScope } from '../utils/companyScope.js';

const chartOfAccountsSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    index: true,
    trim: true,
    // Format: 1000, 2000, etc.
  },
  // Workspace ownership for custom accounts. Shared system (seeded) accounts
  // have no companyId (or explicit null) and are visible to every workspace;
  // accounts created by a workspace are stamped with its companyId and stay
  // private to it.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['Asset', 'Liability', 'Equity', 'Income', 'Expense'],
  },
  subtype: {
    type: String,
    // e.g., 'Current Asset', 'Fixed Asset', 'Operating Expense', etc.
  },
  normalBalance: {
    type: String,
    enum: ['debit', 'credit'],
    required: true,
    // Asset/Expense = debit, Liability/Equity/Income = credit
  },
  parentAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  description: String,
}, {
  timestamps: true,
});

// Additional indexes for performance
chartOfAccountsSchema.index({ type: 1 });
chartOfAccountsSchema.index({ isActive: 1 });
chartOfAccountsSchema.index({ type: 1, isActive: 1 });
chartOfAccountsSchema.index({ parentAccount: 1 });
// Account codes are unique per scope: shared codes (companyId null/missing)
// and each workspace's own custom codes.
chartOfAccountsSchema.index({ code: 1, companyId: 1 }, { unique: true });

const COMPANY_FIELD = 'companyId';

// Workspace scoping: shared (system) accounts are readable by everyone;
// workspace-created accounts are private. Explicit companyId filters in a
// query are respected as-is (cross-company tooling).
function workspaceChartScope(schema) {
  const applyReadFilter = function () {
    const scope = getScope();
    if (!scope || scope.crossCompany || !scope.workspace) return;
    // Document-context middleware (doc.deleteOne(), doc.updateOne()) has no
    // Query API; the caller already obtained the doc through scoped reads.
    if (typeof this.getFilter !== 'function' || typeof this.where !== 'function') return;
    const filter = this.getFilter();
    if (filter && filter[COMPANY_FIELD] !== undefined) return;
    this.where({ [COMPANY_FIELD]: { $in: [scope.workspace, null] } });
  };

  const readHooks = [
    'find',
    'findOne',
    'count',
    'countDocuments',
    'distinct',
    'updateOne',
    'updateMany',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndRemove',
  ];
  for (const hook of readHooks) {
    schema.pre(hook, applyReadFilter);
  }

  schema.pre('aggregate', function () {
    const scope = getScope();
    if (!scope || scope.crossCompany || !scope.workspace) return;
    const first = this.pipeline()[0];
    const hasCompanyMatch =
      first &&
      first.$match &&
      first.$match[COMPANY_FIELD] !== undefined;
    if (!hasCompanyMatch) {
      this.pipeline().unshift({ $match: { [COMPANY_FIELD]: { $in: [scope.workspace, null] } } });
    }
  });

  // Only new documents with no explicit owner get stamped; existing shared
  // documents keep sharing no matter which workspace edits them.
  schema.pre('save', function () {
    const scope = getScope();
    if (
      scope &&
      !scope.crossCompany &&
      scope.workspace &&
      this.isNew &&
      this[COMPANY_FIELD] === undefined
    ) {
      this[COMPANY_FIELD] = scope.workspace;
    }
  });

  schema.pre('insertMany', function (next, docs) {
    const scope = getScope();
    if (scope && !scope.crossCompany && scope.workspace && Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc[COMPANY_FIELD] === undefined) {
          doc[COMPANY_FIELD] = scope.workspace;
        }
      }
    }
    next();
  });
}

workspaceChartScope(chartOfAccountsSchema);

// Validation: Ensure normalBalance matches type
chartOfAccountsSchema.pre('save', function(next) {
  const debitTypes = ['Asset', 'Expense'];
  const creditTypes = ['Liability', 'Equity', 'Income'];
  
  if (debitTypes.includes(this.type) && this.normalBalance !== 'debit') {
    return next(new Error(`${this.type} accounts must have debit normal balance`));
  }
  
  if (creditTypes.includes(this.type) && this.normalBalance !== 'credit') {
    return next(new Error(`${this.type} accounts must have credit normal balance`));
  }
  
  next();
});

export default mongoose.model('ChartOfAccounts', chartOfAccountsSchema);