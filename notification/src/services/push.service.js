import DeviceToken from '../models/DeviceToken.js';
import DeliveryLog from '../models/DeliveryLog.js';
import * as webpush from './webpush.service.js';
import * as fcm from './fcm.service.js';
import * as apns from './apns.service.js';

const PROVIDER_FOR_PLATFORM = {
  web: 'webpush',
  android: 'fcm',
  ios: 'fcm', // overridden to 'apns' when an APNs token is supplied
};

export function configureSenders() {
  return {
    webpush: webpush.configure(),
    fcm: fcm.isFcmAvailable(),
    apns: apns.isApnsAvailable(),
  };
}

/** Register (or refresh) one device endpoint for a user in a tenant. */
export async function registerDevice({
  tenant_id,
  user_id,
  platform,
  provider,
  token = null,
  subscription = null,
  device_id = null,
  user_agent = null,
  meta = {},
}) {
  if (!tenant_id || !user_id) throw Object.assign(new Error('tenant_id and user_id are required'), { status: 400 });
  if (!['web', 'android', 'ios'].includes(platform)) {
    throw Object.assign(new Error('platform must be web | android | ios'), { status: 400 });
  }

  let resolvedProvider = provider;
  if (!resolvedProvider) {
    if (platform === 'web') resolvedProvider = 'webpush';
    else resolvedProvider = token && token.length === 64 ? 'apns' : PROVIDER_FOR_PLATFORM[platform];
  }
  if (platform === 'web' && !subscription) {
    throw Object.assign(new Error('subscription is required for web platform'), { status: 400 });
  }
  if (platform !== 'web' && !token) {
    throw Object.assign(new Error(`token is required for ${platform} platform`), { status: 400 });
  }

  const match = {
    tenant_id,
    user_id,
    platform,
    ...(platform === 'web'
      ? { 'subscription.endpoint': subscription.endpoint }
      : { token }),
  };

  const doc = await DeviceToken.findOneAndUpdate(
    match,
    {
      $set: {
        provider: resolvedProvider,
        subscription: platform === 'web' ? subscription : null,
        token: platform === 'web' ? null : token,
        device_id,
        user_agent,
        meta,
        is_active: true,
        deactivated_reason: null,
        last_used_at: new Date(),
      },
      $setOnInsert: { tenant_id, user_id, platform },
    },
    { new: true, upsert: true }
  );

  return doc;
}

/** Deactivate a device by token/endpoint (idempotent). */
export async function unregisterDevice({ tenant_id, user_id, token = null, endpoint = null }) {
  const match = { is_active: true };
  if (tenant_id) match.tenant_id = tenant_id;
  if (user_id) match.user_id = user_id;
  if (endpoint) match['subscription.endpoint'] = endpoint;
  else if (token) {
    match.$or = [{ token }, { 'subscription.endpoint': token }];
  } else {
    throw Object.assign(new Error('token or endpoint is required'), { status: 400 });
  }
  const res = await DeviceToken.updateMany(match, {
    $set: { is_active: false, deactivated_reason: 'client-unsubscribe' },
  });
  return { removed: res.modifiedCount };
}

async function deactivate(doc, reason) {
  await DeviceToken.updateOne({ _id: doc._id }, { $set: { is_active: false, deactivated_reason: reason } });
}

async function deliverOne(doc, notification) {
  const payload = {
    title: notification.title,
    body: notification.body,
    data: notification.data || {},
    category: notification.category || 'general',
    priority: notification.priority || 'normal',
    link: notification.link || null,
  };

  let result;
  if (doc.provider === 'webpush') {
    result = await webpush.send(doc.subscription, payload);
  } else if (doc.provider === 'apns') {
    result = await apns.send({
      token: doc.token,
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, link: payload.link || '' },
      priority: payload.priority,
    });
  } else {
    result = await fcm.send({
      token: doc.token,
      title: payload.title,
      body: payload.body,
      data: { ...payload.data, link: payload.link || '' },
      platform: doc.platform,
      priority: payload.priority,
    });
  }

  const status = result.ok ? 'sent' : result.gone ? 'deactivated' : 'failed';
  if (result.gone) await deactivate(doc, result.error || 'stale-token');

  await DeliveryLog.create({
    tenant_id: doc.tenant_id,
    user_id: doc.user_id,
    platform: doc.platform,
    provider: doc.provider,
    title: payload.title,
    category: payload.category,
    priority: payload.priority,
    status,
    error: result.error,
    provider_message_id: result.messageId || null,
  });

  return { user_id: doc.user_id, platform: doc.platform, provider: doc.provider, status, error: result.error };
}

/**
 * Fan out one notification to every active device of the given
 * (tenant_id, user_id) or a list of user_ids within ONE tenant.
 * Tenant isolation is enforced: results never cross tenant_id.
 */
export async function sendToUsers({ tenant_id, user_ids, notification }) {
  if (!tenant_id) throw Object.assign(new Error('tenant_id is required'), { status: 400 });
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    throw Object.assign(new Error('user_ids must be a non-empty array'), { status: 400 });
  }
  if (!notification?.title || !notification?.body) {
    throw Object.assign(new Error('notification.title and notification.body are required'), { status: 400 });
  }

  const devices = await DeviceToken.find({
    tenant_id,
    user_id: { $in: user_ids },
    is_active: true,
  });

  const results = await Promise.all(devices.map((d) => deliverOne(d, notification)));

  return {
    targeted_users: user_ids.length,
    targeted_devices: devices.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    deactivated: results.filter((r) => r.status === 'deactivated').length,
    results,
  };
}

export async function getStatus() {
  const [active, byPlatform] = await Promise.all([
    DeviceToken.countDocuments({ is_active: true }),
    DeviceToken.aggregate([
      { $match: { is_active: true } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
    ]),
  ]);
  return {
    senders: configureSenders(),
    active_devices: active,
    by_platform: Object.fromEntries(byPlatform.map((r) => [r._id, r.count])),
  };
}

export default {
  configureSenders,
  registerDevice,
  unregisterDevice,
  sendToUsers,
  getStatus,
};
