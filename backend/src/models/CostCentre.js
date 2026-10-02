import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import companyScope from '../utils/companyScope.js';

const validateDecimal = {
  validator: (v) => v === '' || v === null || v === undefined || (!isNaN(Number(v)) && isFinite(Number(v))),
  message: '{VALUE} is not a valid decimal amount',
};

const costCentreSchema = new mongoose.Schema({
  centreId: {
    type: String,
    unique: true,
    default: () => `CC-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['cost_centre', 'profit_centre', 'branch', 'department'],
    required: true,
    index: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true,
  },
  parentCentre: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CostCentre',
    default: null,
  },
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  description: String,
  isActive: {
    type: Boolean,
    default: true,
  },
  budget: {
    allocated: { type: String, default: '0', validate: validateDecimal },
    spent: { type: String, default: '0', validate: validateDecimal },
    variance: { type: String, default: '0', validate: validateDecimal },
  },
  // Link to accounts
  linkedAccounts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

costCentreSchema.index({ companyId: 1, type: 1 });
costCentreSchema.index({ code: 1, companyId: 1 });

costCentreSchema.plugin(companyScope);

export default mongoose.model('CostCentre', costCentreSchema);
