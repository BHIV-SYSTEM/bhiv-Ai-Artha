import mongoose from 'mongoose';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

const auditEventSchema = new mongoose.Schema({
  eventId: {
    type: String,
    unique: true,
    default: () => `AUD-${randomUUID()}`,
    immutable: true,
    index: true,
  },
  eventType: {
    type: String,
    enum: [
      'USER_ACTION', 'APPROVAL', 'REJECTION', 'ROLE_CHANGE', 'CONFIG_CHANGE',
      'CORRECTION', 'REVERSAL', 'DELETION', 'EXPORT', 'IMPORT', 'FILING',
      'RECONCILIATION', 'SETU_DISPATCH', 'SYSTEM_EVENT', 'LOGIN', 'LOGOUT',
      // Financial / compliance / assistant event types sent by domain services
      'INVOICE_CREATED', 'INVOICE_SENT', 'INVOICE_PAYMENT_RECORDED', 'INVOICE_CANCELLED',
      'EXPENSE_CREATED', 'EXPENSE_APPROVED', 'EXPENSE_RECORDED',
      'JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_VALIDATED', 'JOURNAL_ENTRY_POSTED',
      'GSTR1_GENERATED', 'GSTR3B_GENERATED', 'GSTR1_FILING_GENERATED', 'GSTR3B_FILING_GENERATED',
      'FORM24Q_GENERATED', 'FORM26Q_GENERATED', 'GST_RETURN_FILED',
      'TDS_ENTRY_CREATED', 'TDS_DEDUCTION_RECORDED', 'TDS_CHALLAN_DEPOSITED',
      'BALANCE_SHEET_GENERATED', 'CASH_FLOW_GENERATED', 'PROFIT_LOSS_GENERATED', 'TRIAL_BALANCE_GENERATED',
      'MITRA_CHAT', 'MITRA_ANALYZE', 'MITRA_INSIGHTS', 'MITRA_STATEMENT_ANALYSIS',
    ],
    required: true,
    index: true,
  },
  category: {
    type: String,
    enum: ['financial', 'compliance', 'admin', 'system', 'security'],
    required: true,
    index: true,
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info',
  },
  entityType: {
    type: String,
    required: true,
    index: true,
  },
  entityId: {
    type: String,
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },

  // Actor
  actor: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: String,
    name: String,
    role: String,
    ip: String,
    userAgent: String,
  },

  // State change
  before: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  after: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Financial impact
  financialImpact: {
    amount: String,
    currency: { type: String, default: 'INR' },
    debitAccount: String,
    creditAccount: String,
  },

  // Traceability
  traceId: {
    type: String,
  },
  parentEventId: {
    type: String,
  },
  correlationId: {
    type: String,
  },

  // Immutability
  hash: {
    type: String,
    required: true,
    immutable: true,
  },
  previousHash: {
    type: String,
    default: '0',
    immutable: true,
  },
  chainPosition: {
    type: Number,
    required: true,
    immutable: true,
  },

  // Compliance
  regulatoryRequired: {
    type: Boolean,
    default: false,
  },
  retentionDays: {
    type: Number,
    default: 2555, // ~7 years for Indian accounting
  },
}, {
  timestamps: true,
  strict: true,
});

auditEventSchema.index({ eventType: 1, createdAt: -1 });
auditEventSchema.index({ category: 1, createdAt: -1 });
auditEventSchema.index({ 'actor.userId': 1, createdAt: -1 });
auditEventSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditEventSchema.index({ traceId: 1 });
auditEventSchema.index({ chainPosition: 1 });
auditEventSchema.index({ hash: 1 });
auditEventSchema.index({ correlationId: 1 });

auditEventSchema.statics.computeHash = function(data, previousHash = '0') {
  const payload = JSON.stringify({
    eventId: data.eventId,
    eventType: data.eventType,
    entityType: data.entityType,
    entityId: data.entityId,
    action: data.action,
    actorId: data.actor?.userId?.toString(),
    timestamp: data.createdAt?.toISOString?.() || new Date().toISOString(),
    previousHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
};

auditEventSchema.statics.generateEventId = function() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const uuid = randomUUID().slice(0, 8);
  return `AUD-${date}-${uuid}`;
};

export default mongoose.model('AuditEvent', auditEventSchema);
