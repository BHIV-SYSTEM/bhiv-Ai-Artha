import mongoose from 'mongoose';

/**
 * One registered endpoint for push delivery.
 * Every device is scoped to exactly one (tenant_id, user_id) pair so the
 * gateway can never fan out across tenants.
 */
const DeviceTokenSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true, index: true },

    // 'web' | 'android' | 'ios'
    platform: { type: String, required: true, enum: ['web', 'android', 'ios'] },
    // Delivery channel: 'webpush' | 'fcm' | 'apns'
    provider: { type: String, required: true, enum: ['webpush', 'fcm', 'apns'] },

    // FCM/APNs device token (native platforms).
    token: { type: String, default: null },
    // Full Web Push subscription { endpoint, keys: { p256dh, auth } } (web).
    subscription: { type: mongoose.Schema.Types.Mixed, default: null },

    device_id: { type: String, default: null },
    user_agent: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    is_active: { type: Boolean, default: true, index: true },
    last_used_at: { type: Date, default: Date.now },
    deactivated_reason: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

DeviceTokenSchema.index(
  { tenant_id: 1, user_id: 1, platform: 1, token: 1, 'subscription.endpoint': 1 },
  { unique: true }
);

export default mongoose.model('DeviceToken', DeviceTokenSchema);
