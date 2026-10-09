import mongoose from 'mongoose';

const dealerSchema = new mongoose.Schema({
  dealerCode: {
    type: String,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    index: true,
  },
  displayName: {
    type: String,
    default: '',
  },
  contactPerson: {
    type: String,
    default: '',
  },
  phone: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  city: {
    type: String,
    default: '',
    index: true,
  },
  state: {
    type: String,
    default: '',
  },
  pincode: {
    type: String,
    default: '',
  },
  latitude: {
    type: Number,
    default: null,
  },
  longitude: {
    type: Number,
    default: null,
  },
  region: {
    type: String,
    default: '',
    index: true,
  },
  area: {
    type: String,
    default: '',
  },
  group: {
    type: String,
    default: 'Sundry Debtors',
  },
  parent: {
    type: String,
    default: 'Sundry Debtors',
  },
  gstin: {
    type: String,
    default: '',
  },
  pan: {
    type: String,
    default: '',
  },
  creditLimit: {
    type: Number,
    default: 0,
  },
  outstandingBalance: {
    type: Number,
    default: 0,
  },
  overdueAmount: {
    type: Number,
    default: 0,
  },
  lastBillingDate: {
    type: Date,
    default: null,
  },
  lastPaymentDate: {
    type: Date,
    default: null,
  },
  lastPaymentAmount: {
    type: Number,
    default: 0,
  },
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesAgent',
    default: null,
    index: true,
  },
  tallyPartyId: {
    type: String,
    default: '',
    index: true,
  },
  setuCustomerId: {
    type: String,
    default: '',
    index: true,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  tags: [{
    type: String,
  }],
  notes: {
    type: String,
    default: '',
  },
  visits: {
    type: Number,
    default: 0,
  },
  lastVisitDate: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

dealerSchema.index({ name: 'text', displayName: 'text', city: 'text' });
dealerSchema.index({ outstandingBalance: -1 });
dealerSchema.index({ overdueAmount: -1 });

dealerSchema.set('toJSON', { virtuals: true });

dealerSchema.virtual('isOverdue').get(function () {
  return this.overdueAmount > 0;
});

dealerSchema.virtual('creditAvailable').get(function () {
  return this.creditLimit - this.outstandingBalance;
});

export default mongoose.model('Dealer', dealerSchema);
