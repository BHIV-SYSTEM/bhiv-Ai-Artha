# notification — Standalone Push Notification Gateway

A self-contained, multi-tenant push notification service you can **plug into any product**.
It does exactly one job: register device/browser endpoints against `user_id` + `tenant_id`,
and deliver notifications to them — **critical alerts, overdue SLA notices, and officer
task assignments**.

- **Web Push** (VAPID + service worker) — Chrome, Edge, Firefox, Safari
- **FCM HTTP v1** — Android (and iOS devices using the Firebase SDK)
- **APNs HTTP/2** — iOS with native APNs device tokens

No in-app notification centre, no business logic, no coupling to SETU or any other
subsystem — just registration, delivery, and delivery receipts.

---

## Answers to the Gov-Ops integration questions

### 1. Repository reference & technical documentation

| Item | Location |
|---|---|
| This repository | `notification/` (standalone git repo) |
| API contract | [`API.md`](./API.md) |
| Integration guide (env, FCM/APNs setup, mounting) | [`docs/INTEGRATION.md`](./docs/INTEGRATION.md) |
| Service entry point | `src/server.js` (standalone) / `src/index.js` (mountable router) |
| Sender implementations | `src/services/{webpush,fcm,apns}.service.js` |
| Device registration storage | `src/models/DeviceToken.js` |
| Delivery receipts | `src/models/DeliveryLog.js` |
| Browser integration | `client/sw.js` (service worker) + `client/usePushNotifications.js` (React hook) |

### 2. API contract for device & browser registration

Full contract in [`API.md`](./API.md). Summary:

```
POST /api/v1/devices/register
X-API-Key: <NOTIFICATION_API_KEY>
{
  "tenant_id": "gov-ops-bhiv",
  "user_id": "officer-4821",
  "platform": "web" | "android" | "ios",
  // android/ios → FCM SDK token (or provider:"apns" for native APNs token):
  "token": "<FCM or APNs device token>",
  // web → Push API subscription:
  "subscription": { "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." } },
  "device_id": "optional-stable-device-id"
}
→ 201 { success, data: { id, tenant_id, user_id, platform, provider } }

POST /api/v1/devices/unregister   { tenant_id, user_id, token | endpoint }
GET  /api/v1/push/vapid-key       (public — browser bootstrap for Web Push)
POST /api/v1/push/send            { tenant_id, user_ids: [...], notification: { title, body, ... } }
GET  /api/v1/push/status          capability/health diagnostics
GET  /api/v1/health               (public)
```

Every device row is keyed by **`(tenant_id, user_id, platform, token/endpoint)`** —
delivery is always scoped to one tenant; there is no cross-tenant fan-out path.

### 3. Currently supported platforms

| Platform | Channel | Status |
|---|---|---|
| **Web** (Chrome, Edge, Firefox, Safari ≥ 16.4) | Web Push / VAPID + service worker (`client/sw.js`) | ✅ Supported |
| **Android** | FCM HTTP v1 (device token from Firebase SDK) | ✅ Supported |
| **iOS** | FCM HTTP v1 **or** direct APNs HTTP/2 (`.p8` provider token) | ✅ Supported |

Priority mapping: `low | normal | high | urgent` → Web Push `requireInteraction` for
high/urgent, FCM `android.priority=high` + APNs `interruption-level: time-sensitive`.

### 4. Behind SETU, or a standalone gateway?

**Standalone gateway.** The service has zero dependency on SETU (or any other
subsystem of your products). Two integration modes:

- **A. Standalone process** — run `npm start`, Gov-Ops (or any backend) calls
  `POST https://<host>:5100/api/v1/push/send` with an `X-API-Key`.
- **B. Mounted router** — import `createNotificationRouter()` and mount it inside
  any existing Express app: `app.use('/api/v1', createNotificationRouter())`.

SETU events (or any other product's events) simply trigger an HTTP call to
`POST /push/send` — the gateway never needs to know where the event came from.

---

## Quick start

```bash
cd notification
npm install
cp .env.example .env         # fill in MONGODB_URI, NOTIFICATION_API_KEY, VAPID keys
npm run gen-vapid            # → paste into .env
npm start                    # gateway on :5100
```

Health check:

```bash
curl http://localhost:5100/api/v1/health
```

Send a test alert:

```bash
curl -X POST http://localhost:5100/api/v1/push/send \
  -H "X-API-Key: $NOTIFICATION_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "gov-ops",
    "user_ids": ["officer-4821"],
    "notification": { "title": "SLA overdue", "body": "Grievance #8821 is 4h past SLA", "priority": "high", "link": "/cases/8821" }
  }'
```

## Plug it into a product

**Backend (in-process):**

```js
import { createNotificationRouter, connect } from '@artha/notification-gateway';

await connect(process.env.MONGODB_URI);
app.use('/api/v1', createNotificationRouter());
```

**Frontend (React):**

```jsx
import usePushNotifications from '@artha/notification-gateway/usePushNotifications';

const push = usePushNotifications({
  apiBaseUrl: '/api/v1',
  userId: user.id,
  tenantId: tenant.id,
  authHeader: { 'X-API-Key': import.meta.env.VITE_PUSH_KEY }, // or Bearer JWT
});
// push.requestPermission() → shows browser prompt, registers SW, links to user+tenant
```

Copy `client/sw.js` into your app's `public/` folder.

## Environment

See [`.env.example`](./.env.example) — MongoDB URI, API key, optional JWT secret,
VAPID pair, `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_KEY`, and
`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`/`APNS_KEY_PATH`. Any sender you
don't configure is simply reported as unavailable in `GET /push/status` —
registration for that platform still works.

## Security notes

- `X-API-Key` (or a host-issued HS256 JWT with `sub` + `tenant_id` claims) is
  required for every route except `GET /push/vapid-key` and `GET /health`.
- Browsers never hold secrets when the host backend proxies registration, which
  is the recommended pattern; direct browser registration can use the JWT mode.
- VAPID private key, FCM service-account JSON, and APNs `.p8` key stay server-side.
