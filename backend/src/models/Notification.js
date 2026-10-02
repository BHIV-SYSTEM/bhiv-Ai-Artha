import mongoose from 'mongoose';
import companyScope from '../utils/companyScope.js';

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['info', 'warning', 'success', 'error', 'location', 'visit', 'payment', 'overdue', 'system'],
    default: 'info',
    index: true,
  },
  category: {
    type: String,
    enum: ['crm', 'finance', 'compliance', 'system', 'tally'],
    default: 'system',
    index: true,
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesAgent',
    default: null,
    index: true,
  },
  recipientRole: {
    type: String,
    enum: ['admin', 'accountant', 'viewer', 'agent', 'all'],
    default: 'all',
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  readAt: {
    type: Date,
    default: null,
  },
  isPushed: {
    type: Boolean,
    default: false,
  },
  pushedAt: {
    type: Date,
    default: null,
  },
  pushError: {
    type: String,
    default: '',
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  link: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

notificationSchema.index({ recipientId: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });

notificationSchema.add({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true,
  },
});
notificationSchema.plugin(companyScope);

notificationSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Notification', notificationSchema);
