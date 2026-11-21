import webpush from 'web-push';
import { config } from '../config.js';

let configured = false;

export function isWebPushAvailable() {
  return configured;
}

export function configure() {
  try {
    if (!config.vapid.publicKey || !config.vapid.privateKey) return false;
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

/**
 * Send to a stored Web Push subscription.
 * Resolves { ok, status, error }; 410 means the subscription is gone and
 * the caller should deactivate the row.
 */
export async function send(subscription, payload) {
  if (!configured) return { ok: false, status: 0, error: 'web-push not configured (VAPID keys missing)' };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, status: 201, error: null };
  } catch (err) {
    const status = err?.statusCode || 0;
    return {
      ok: false,
      status,
      error: err?.body || err?.message || 'web push failed',
      gone: status === 410 || status === 404,
    };
  }
}

export default { configure, isWebPushAvailable, send };
