import express from 'express';
import { createNotificationRouter, connect, config } from './index.js';

/**
 * Standalone notification gateway process.
 * Run:  npm start        (listens on PORT, default 5100)
 *
 * This is the integration point for Gov-Ops / other products that prefer
 * a separate service over an in-process router mount.
 */
async function main() {
  await connect();

  const app = express();
  app.disable('x-powered-by');
  app.use('/api/v1', createNotificationRouter());

  app.listen(config.port, () => {
    console.log(`[notification-gateway] listening on :${config.port}`);
    console.log(`[notification-gateway] mounted at /api/v1  (health: GET /api/v1/health)`);
  });
}

main().catch((err) => {
  console.error('[notification-gateway] failed to start:', err);
  process.exit(1);
});
