import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import pushRoutes from './routes/push.routes.js';
import deviceRoutes from './routes/devices.routes.js';
import { configureSenders } from './services/push.service.js';
import { config } from './config.js';

export { default as pushService } from './services/push.service.js';
export { default as DeviceToken } from './models/DeviceToken.js';
export { default as DeliveryLog } from './models/DeliveryLog.js';
export { config } from './config.js';

/**
 * Connect MongoDB (required for both standalone and mounted modes).
 */
export async function connect(uri = config.mongoUri) {
  await mongoose.connect(uri);
  return mongoose.connection;
}

/**
 * Pluggable Express router — mount it into ANY existing product:
 *
 *   import { createNotificationRouter } from '@artha/notification-gateway';
 *   app.use('/api/v1', createNotificationRouter());
 *
 * Exposes:
 *   GET   /push/vapid-key     (public)
 *   GET   /push/status        (auth)
 *   POST  /push/send          (auth)
 *   POST  /devices/register   (auth)
 *   POST  /devices/unregister (auth)
 *   GET   /devices            (auth)
 *   GET   /health             (public)
 */
export function createNotificationRouter() {
  const router = express.Router();
  router.use(cors());
  router.use(express.json({ limit: '256kb' }));

  router.get('/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', senders: configureSenders() } });
  });

  router.use('/push', pushRoutes);
  router.use('/devices', deviceRoutes);

  router.use((req, res) => {
    res.status(404).json({ success: false, error: 'not_found' });
  });

  return router;
}

export default createNotificationRouter;
