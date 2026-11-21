import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { config } from '../config.js';

let auth = null;
let accessToken = null;
let tokenExpiresAt = 0;
let available = false;

const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];

function init() {
  if (available || auth) return available;
  try {
    const raw = config.fcm.serviceAccountKey;
    if (!raw || !config.fcm.projectId) return (available = false);
    const creds = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
    auth = new GoogleAuth({ credentials: creds, scopes: SCOPES });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function isFcmAvailable() {
  return init();
}

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  accessToken = typeof res === 'string' ? res : res?.token;
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
  return accessToken;
}

/**
 * FCM HTTP v1 send. Works for Android and iOS tokens registered through
 * the Firebase SDK.
 *
 * Returns { ok, status, error, messageId, gone } — `gone` signals the
 * token should be deactivated (UNREGISTERED / INVALID_ARGUMENT).
 */
export async function send({ token, title, body, data = {}, platform = 'android', priority = 'normal' }) {
  if (!init()) return { ok: false, status: 0, error: 'FCM not configured', gone: false };

  const message = {
    token,
    notification: { title, body },
    data: stringifyData(data),
    android: {
      priority: priority === 'high' || priority === 'urgent' ? 'high' : 'normal',
      notification: { channel_id: 'alerts' },
    },
    apns: {
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          ...(priority === 'high' || priority === 'urgent' ? { 'interruption-level': 'time-sensitive' } : {}),
        },
      },
    },
  };
  if (platform === 'ios') delete message.android;

  try {
    const tokenValue = await getAccessToken();
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${config.fcm.projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      return { ok: true, status: res.status, error: null, messageId: json?.name || null, gone: false };
    }

    const errCode =
      json?.error?.details?.find((d) => d?.errorCode)?.errorCode || json?.error?.status || 'UNKNOWN';
    const gone = ['UNREGISTERED', 'NOT_FOUND', 'INVALID_ARGUMENT'].includes(errCode) &&
      /unregistered|not found|invalid.*token/i.test(JSON.stringify(json?.error || {}));
    return {
      ok: false,
      status: res.status,
      error: `${errCode}: ${json?.error?.message || 'FCM send failed'}`,
      messageId: null,
      gone: gone || errCode === 'UNREGISTERED',
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, messageId: null, gone: false };
  }
}

function stringifyData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

export default { isFcmAvailable, send };
