# Integration Guide

How to plug the notification gateway into any product, and how to configure
each delivery channel.

## 1. Run the gateway

```bash
npm install
cp .env.example .env
npm run gen-vapid          # paste VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY into .env
npm start                  # → http://localhost:5100/api/v1
```

Required env before first run:

| Var | Purpose |
|---|---|
| `MONGODB_URI` | device + delivery-log store |
| `NOTIFICATION_API_KEY` | shared secret for server-to-server calls |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push signing |

Everything else (FCM, APNs, JWT) is optional — `GET /push/status` reports which
senders are live.

## 2. Integration mode A — standalone gateway (recommended for Gov-Ops)

1. Deploy this repo as its own process/service.
2. From the host product's backend, call:

```js
await fetch('https://notify.example.com/api/v1/push/send', {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.NOTIFICATION_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    tenant_id: workspaceId,
    user_ids: [officerId],
    notification: {
      title: 'SLA overdue',
      body: `Case #${caseId} is past SLA`,
      priority: 'high',
      link: `/cases/${caseId}`,
      category: 'sla',
    },
  }),
});
```

Any event source (SETU webhook, cron, queue consumer) triggers the same call —
the gateway never learns or cares where the event originated.

## 3. Integration mode B — mount in-process

```js
import { createNotificationRouter, connect } from '@artha/notification-gateway';

await connect(process.env.MONGODB_URI);
app.use('/api/v1', createNotificationRouter());
```

The host product then serves `/api/v1/push/*` and `/api/v1/devices/*` itself.

## 4. Registering devices from the host product

**Recommended: backend-proxied** — the browser talks only to your backend, which
holds the API key and forwards to the gateway:

```
Browser ──(session JWT)──▶ Host backend ──(X-API-Key)──▶ Gateway POST /devices/register
```

**Direct browser mode** — set `NOTIFICATION_JWT_SECRET`, issue a token with claims
`{ sub: userId, tenant_id, exp }`, and pass it as `Authorization: Bearer` from the
frontend hook (`authHeader={{ Authorization: 'Bearer ' + jwt }}`).

### Frontend (React)

1. Copy `client/sw.js` into the app's `public/` folder.
2. `npm i` nothing — the hook uses native `fetch` + Push API.

```jsx
import usePushNotifications from '@artha/notification-gateway/usePushNotifications';

const push = usePushNotifications({
  apiBaseUrl: '/api/v1',            // or full gateway URL
  userId: user.id,
  tenantId: tenant.id,
  authHeader: { 'X-API-Key': import.meta.env.VITE_PUSH_KEY }, // proxy mode may pass a JWT instead
  swUrl: '/sw.js',
});

<button onClick={push.requestPermission} disabled={!push.isSupported}>
  Enable notifications
</button>
```

The hook: registers the service worker → fetches the VAPID key → creates the
Push subscription → `POST /devices/register` linked to `(userId, tenantId)`.

## 5. FCM setup (Android + iOS-via-FCM)

1. Create a Firebase project → **Project settings → Service accounts →
   Generate new private key** (JSON file).
2. Env:
   ```
   FCM_PROJECT_ID=<your-project-id>
   FCM_SERVICE_ACCOUNT_KEY=./serviceAccount.json   # or paste JSON inline
   ```
3. In the mobile app, obtain the device token from the Firebase SDK and register:
   `POST /devices/register { platform: "android", token: <fcm-token>, ... }`.

## 6. APNs setup (iOS, native token)

1. Apple Developer → **Certificates, Identifiers & Profiles → Keys** → create a
   key with **Apple Push Notifications service (APNs)** enabled → download `.p8`.
2. Env:
   ```
   APNS_KEY_ID=<key-id>
   APNS_TEAM_ID=<team-id>
   APNS_BUNDLE_ID=com.example.app
   APNS_KEY_PATH=./AuthKey_<key-id>.p8
   APNS_ENV=production        # or sandbox
   ```
3. The app registers its APNs device token with `provider: "apns"`.

Note: if your iOS app uses the Firebase SDK, its token is an FCM token — register
it with the default provider (`fcm`) instead; no APNs keys needed in that case
(Firebase holds the APNs credentials).

## 7. Web Push setup

- `npm run gen-vapid` → paste both keys into `.env`.
- Serve `sw.js` from the app root (hook registers it with `scope: '/'`).
- Safari ≥ 16.4 supports Web Push on macOS; iOS Safari requires the site to be
  added to the Home Screen.

## 8. Verifying capability (Gov-Ops acceptance)

```bash
# 1. senders configured?
curl -H "X-API-Key: $KEY" http://localhost:5100/api/v1/push/status

# 2. register a device, then send to it
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:5100/api/v1/devices/register -d '{ ... }'

curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  http://localhost:5100/api/v1/push/send -d '{ "tenant_id": "...", "user_ids": ["..."], "notification": { "title": "Test", "body": "Ping" } }'

# 3. confirm the receipt in Mongo
db.deliverylogs.find({ tenant_id: "...", status: "sent" }).sort({ created_at: -1 }).limit(5)
```

## 9. What this gateway does NOT do

- In-app notification centre / read-unread state (host product's concern)
- Email, SMS or websocket channels
- Scheduling/cron for SLA evaluation (the host triggers `POST /push/send`)
- Any SETU-specific coupling — SETU (or any source) integrates by plain HTTP call
