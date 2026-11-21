# API Contract — Notification Gateway

Base URL (standalone): `http://localhost:5100/api/v1`
When mounted into a host product: `https://<host>/api/v1` (or any prefix you choose).

## Conventions

- All request/response bodies are JSON (`Content-Type: application/json`).
- Success responses: `{ "success": true, "data": ... }`
- Error responses: `{ "success": false, "error": "<message>" }` with status `400 | 401 | 404 | 413 | 500`
- **Authentication** (all endpoints except `GET /push/vapid-key` and `GET /health`):

  | Mode | Header | When |
  |---|---|---|
  | API key (server-to-server) | `X-API-Key: <NOTIFICATION_API_KEY>` | host product backend → gateway |
  | JWT (optional) | `Authorization: Bearer <HS256 JWT>` | direct browser calls, when `NOTIFICATION_JWT_SECRET` is set. Claims: `sub` = user_id, `tenant_id`, optional `exp` |

- **Tenancy rule:** every mutating call carries `tenant_id`. Delivery queries are
  always filtered by `tenant_id`; there is no endpoint that can reach another tenant.

---

## 1. Device & browser registration

### `POST /devices/register`

Register (or refresh) one push endpoint for a user in a tenant. Idempotent —
re-registering the same endpoint updates `last_used_at` and reactivates it.

**Body (common):**

| Field | Type | Required | Description |
|---|---|---|---|
| `tenant_id` | string | ✅ | Tenant/workspace identifier |
| `user_id` | string | ✅ | Officer/user the device belongs to |
| `platform` | `"web" \| "android" \| "ios"` | ✅ | Device platform |
| `device_id` | string | ⬜ | Stable app-generated device id |
| `meta` | object | ⬜ | Free-form (app version, model, …) |

**Android / iOS (FCM SDK token):**

```json
{
  "tenant_id": "gov-ops-bhiv",
  "user_id": "officer-4821",
  "platform": "android",
  "token": "eXaMpLeFcmToKeN...",
  "device_id": "pixel-7-aa11"
}
```

**iOS with a native APNs token** (64-hex token; provider auto-detected as `apns`,
or set explicitly):

```json
{
  "tenant_id": "gov-ops-bhiv",
  "user_id": "officer-4821",
  "platform": "ios",
  "provider": "apns",
  "token": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}
```

**Web Push subscription** (from `pushManager.subscribe()`):

```json
{
  "tenant_id": "gov-ops-bhiv",
  "user_id": "officer-4821",
  "platform": "web",
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/…",
    "keys": { "p256dh": "…", "auth": "…" }
  },
  "user_agent": "Mozilla/5.0 …"
}
```

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "665f0c…",
    "tenant_id": "gov-ops-bhiv",
    "user_id": "officer-4821",
    "platform": "web",
    "provider": "webpush",
    "device_id": null
  }
}
```

**Errors:** `400` missing/invalid fields · `401` bad credentials.

---

### `POST /devices/unregister`

Deactivate a device (idempotent, soft-delete — row kept for audit).

```json
{ "tenant_id": "gov-ops-bhiv", "user_id": "officer-4821", "token": "<FCM/APNs token>" }
```

or for web:

```json
{ "tenant_id": "gov-ops-bhiv", "user_id": "officer-4821", "endpoint": "https://…/fcm/send/…" }
```

**Response `200`:** `{ "success": true, "data": { "removed": 1 } }`

---

### `GET /devices?tenant_id=<tid>&user_id=<uid>`

List active device endpoints (diagnostics; both filters optional, capped at 200 rows).

```json
{
  "success": true,
  "data": [
    { "tenant_id": "gov-ops-bhiv", "user_id": "officer-4821", "platform": "android",
      "provider": "fcm", "device_id": "pixel-7-aa11",
      "last_used_at": "2026-11-21T09:12:44.000Z", "created_at": "…" }
  ]
}
```

---

## 2. Delivery

### `POST /push/send`

Deliver one notification to one or more users **within a single tenant**.

**Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `tenant_id` | string | ✅ | Delivery is scoped to this tenant only |
| `user_ids` | string[] | ✅ | Target users (≥ 1) |
| `notification.title` | string | ✅ | |
| `notification.body` | string | ✅ | |
| `notification.link` | string | ⬜ | URL opened on notification click |
| `notification.data` | object | ⬜ | Extra payload (stringified for providers) |
| `notification.category` | string | ⬜ | e.g. `alert`, `sla`, `task` |
| `notification.priority` | `"low\|normal\|high\|urgent"` | ⬜ | default `normal` |

```json
{
  "tenant_id": "gov-ops-bhiv",
  "user_ids": ["officer-4821", "officer-1190"],
  "notification": {
    "title": "SLA overdue",
    "body": "Grievance #8821 is 4h past the 48h SLA",
    "priority": "high",
    "link": "/cases/8821",
    "category": "sla"
  }
}
```

**Response `200` (at least one delivery sent) / `207` (nothing sent):**

```json
{
  "success": true,
  "data": {
    "targeted_users": 2,
    "targeted_devices": 3,
    "sent": 3,
    "failed": 0,
    "deactivated": 0,
    "results": [
      { "user_id": "officer-4821", "platform": "android", "provider": "fcm", "status": "sent", "error": null },
      { "user_id": "officer-4821", "platform": "web", "provider": "webpush", "status": "sent", "error": null },
      { "user_id": "officer-1190", "platform": "ios", "provider": "apns", "status": "sent", "error": null }
    ]
  }
}
```

`status` per device: `sent` | `failed` | `deactivated` (stale token auto-removed on
`410 Gone` / `UNREGISTERED`). Every attempt is written to the delivery log.

---

### `GET /push/vapid-key` *(public)*

Browser bootstrap for Web Push — fetched by the client before
`pushManager.subscribe()`.

```json
{ "success": true, "data": { "publicKey": "B…", "configured": true } }
```

---

### `GET /push/status`

Capability + health diagnostics (use this to "verify the capability").

```json
{
  "success": true,
  "data": {
    "senders": { "webpush": true, "fcm": true, "apns": false },
    "active_devices": 42,
    "by_platform": { "web": 30, "android": 8, "ios": 4 }
  }
}
```

---

### `GET /health` *(public)*

```json
{ "success": true, "data": { "status": "ok", "senders": { "webpush": true, "fcm": true, "apns": true } } }
```

---

## 3. Delivery receipts

Every send attempt creates a `DeliveryLog` record (retention: 30 days):

| Field | Description |
|---|---|
| `tenant_id`, `user_id`, `platform`, `provider` | Routing context |
| `title`, `category`, `priority` | Notification snapshot |
| `status` | `sent` \| `failed` \| `deactivated` |
| `error` | Provider error (if any) |
| `provider_message_id` | FCM message name when returned |

Query it directly from MongoDB (`DeliveryLog` collection: `deliverylogs`) for
audit/verification, e.g. confirm an SLA alert reached an officer's device.
