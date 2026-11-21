import http2 from 'node:http2';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

let session = null;
let providerToken = null;
let providerTokenExp = 0;
let keyPem = null;

export function isApnsAvailable() {
  const c = config.apns;
  if (!(c.keyId && c.teamId && c.bundleId && c.keyPath)) return false;
  try {
    getKeyPem();
    return true;
  } catch {
    return false;
  }
}

function getKeyPem() {
  if (keyPem) return keyPem;
  const p = path.isAbsolute(config.apns.keyPath)
    ? config.apns.keyPath
    : path.resolve(process.cwd(), config.apns.keyPath);
  keyPem = fs.readFileSync(p, 'utf8');
  return keyPem;
}

/** ES256 provider token (p8 key) — regenerated hourly. */
function getProviderToken() {
  if (providerToken && Date.now() < providerTokenExp) return providerToken;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.apns.keyId }));
  const payload = b64url(JSON.stringify({ iss: config.apns.teamId, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: getKeyPem(),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  providerToken = `${signingInput}.${sig}`;
  providerTokenExp = (now + 3500) * 1000;
  return providerToken;
}

function getSession() {
  if (session && !session.closed && !session.destroyed) return session;
  session = http2.connect(HOSTS[config.apns.env]);
  session.on('error', () => {
    session = null;
  });
  return session;
}

function b64url(s) {
  return Buffer.from(s).toString('base64url');
}

/**
 * Direct APNs HTTP/2 send for iOS devices registered with a native
 * APNs device token (no FCM involved).
 *
 * Returns { ok, status, error, gone } — `gone` (410 Unregistered) means
 * the token should be deactivated.
 */
export async function send({ token, title, body, data = {}, priority = 'normal' }) {
  if (!isApnsAvailable()) return { ok: false, status: 0, error: 'APNs not configured', gone: false };

  const payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      ...(priority === 'high' || priority === 'urgent'
        ? { 'interruption-level': 'time-sensitive', 'content-available': 1 }
        : {}),
    },
    ...data,
  };

  try {
    const ses = getSession();
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${getProviderToken()}`,
      'apns-topic': config.apns.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': priority === 'low' ? '5' : '10',
      'content-type': 'application/json',
    };

    const result = await new Promise((resolve) => {
      const req = ses.request(headers);
      let status = 0;
      let raw = '';
      req.on('response', (h) => {
        status = h[':status'];
      });
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => resolve({ status, raw }));
      req.on('error', (e) => resolve({ status: 0, raw: e.message }));
      req.end(JSON.stringify(payload));
    });

    if (result.status === 200) {
      return { ok: true, status: 200, error: null, gone: false };
    }
    let reason = `APNs ${result.status}`;
    try {
      const j = JSON.parse(result.raw);
      if (j.reason) reason = `APNs ${result.status}: ${j.reason}`;
    } catch {
      /* keep generic reason */
    }
    return {
      ok: false,
      status: result.status,
      error: reason,
      gone: result.status === 410 || /Unregistered/.test(reason),
    };
  } catch (err) {
    session = null;
    return { ok: false, status: 0, error: err.message, gone: false };
  }
}

export default { isApnsAvailable, send };
