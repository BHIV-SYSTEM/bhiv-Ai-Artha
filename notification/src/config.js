import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader (no dependency). Existing process.env wins. */
function loadDotEnv() {
  const p = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv();

const env = (k, fallback = '') => process.env[k] ?? fallback;

export const config = {
  mongoUri: env('MONGODB_URI', 'mongodb://localhost:27017/notification'),
  port: Number(env('PORT', 5100)),

  apiKey: env('NOTIFICATION_API_KEY'),
  jwtSecret: env('NOTIFICATION_JWT_SECRET'),

  vapid: {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT', 'mailto:ops@example.com'),
  },

  fcm: {
    projectId: env('FCM_PROJECT_ID'),
    // Path to a service-account JSON file, or the raw JSON string.
    serviceAccountKey: env('FCM_SERVICE_ACCOUNT_KEY'),
  },

  apns: {
    keyId: env('APNS_KEY_ID'),
    teamId: env('APNS_TEAM_ID'),
    bundleId: env('APNS_BUNDLE_ID'),
    keyPath: env('APNS_KEY_PATH'),
    env: env('APNS_ENV', 'production') === 'sandbox' ? 'sandbox' : 'production',
  },
};

export default config;
