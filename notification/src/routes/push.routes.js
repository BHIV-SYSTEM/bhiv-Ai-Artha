import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as push from '../services/push.service.js';
import { config } from '../config.js';
import { isWebPushAvailable } from '../services/webpush.service.js';

const router = Router();

/**
 * GET /push/vapid-key  (public — browser bootstrap)
 * Returns the VAPID public key used to create a Web Push subscription.
 */
router.get('/vapid-key', (req, res) => {
  res.json({
    success: true,
    data: { publicKey: config.vapid.publicKey || null, configured: isWebPushAvailable() },
  });
});

/** GET /push/status  — capability + health diagnostics. */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await push.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /push/send  — deliver a notification to one or more users
 * within a single tenant.
 *
 * body: {
 *   tenant_id: string,            // required
 *   user_ids: string[],           // required, at least one
 *   notification: {               // required
 *     title, body,
 *     data?, link?, category?, priority?   // priority: low|normal|high|urgent
 *   }
 * }
 */
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { tenant_id, user_ids, notification } = req.body || {};
    const summary = await push.sendToUsers({ tenant_id, user_ids, notification });
    res.status(summary.sent > 0 ? 200 : 207).json({ success: true, data: summary });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

export default router;
