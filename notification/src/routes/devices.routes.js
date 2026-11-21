import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as push from '../services/push.service.js';
import DeviceToken from '../models/DeviceToken.js';

const router = Router();

/**
 * POST /devices/register  — link a device endpoint to user_id + tenant_id.
 *
 * body: {
 *   tenant_id: string,   user_id: string,
 *   platform: 'web' | 'android' | 'ios',
 *   // android/ios (FCM SDK token, or provider:'apns' for native APNs token):
 *   token?: string,  provider?: 'fcm' | 'apns',  device_id?: string,
 *   // web (Push API subscription):
 *   subscription?: { endpoint, keys: { p256dh, auth } },
 *   meta?: object
 * }
 */
router.post('/register', requireAuth, async (req, res) => {
  try {
    const device = await push.registerDevice({
      ...req.body,
      user_agent: req.get('user-agent') || null,
    });
    res.status(201).json({
      success: true,
      data: {
        id: device._id,
        tenant_id: device.tenant_id,
        user_id: device.user_id,
        platform: device.platform,
        provider: device.provider,
        device_id: device.device_id,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * POST /devices/unregister — body: { tenant_id?, user_id?, token | endpoint }
 * (endpoint = web push subscription endpoint; token = FCM/APNs token)
 */
router.post('/unregister', requireAuth, async (req, res) => {
  try {
    const { tenant_id, user_id, token, endpoint } = req.body || {};
    const out = await push.unregisterDevice({ tenant_id, user_id, token, endpoint });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/** GET /devices?tenant_id=&user_id= — list active device endpoints (diagnostics). */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { tenant_id, user_id } = req.query;
    const match = { is_active: true };
    if (tenant_id) match.tenant_id = tenant_id;
    if (user_id) match.user_id = user_id;
    const devices = await DeviceToken.find(match)
      .select('tenant_id user_id platform provider device_id last_used_at created_at')
      .limit(200)
      .lean();
    res.json({ success: true, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
