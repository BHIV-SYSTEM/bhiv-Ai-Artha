import mongoose from 'mongoose';

/**
 * Delivery receipt — lets integrators verify end-to-end that a notification
 * reached a device (the Gov-Ops "verify this capability" requirement).
 * Pruned after 30 days via TTL index.
 */
const DeliveryLogSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], required: true },
    provider: { type: String, enum: ['webpush', 'fcm', 'apns'], required: true },

    title: { type: String, default: '' },
    category: { type: String, default: 'general' },
    priority: { type: String, default: 'normal' },

    // 'sent' | 'failed' | 'deactivated'
    status: { type: String, required: true },
    error: { type: String, default: null },
    // Provider message id (FCM) when available.
    provider_message_id: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at' } }
);

DeliveryLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model('DeliveryLog', DeliveryLogSchema);
