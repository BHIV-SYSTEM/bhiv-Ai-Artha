import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import connectDB from './config/database.js';
import { connectRedis } from './config/redis.js';
import logger from './config/logger.js';
import './models/Counter.js';
import './models/FinancialEvent.js';
import './models/LedgerLock.js';
import './models/ReportSnapshot.js';
import healthService from './services/health.service.js';
import { validateEnvironment } from './config/validation.js';
import { buildAllowedOrigins } from './config/cors.js';
import { getResolvedUrls } from './config/urls.js';
import {
  protect,
  clearBlackholeCookie,
} from './middleware/auth.js';
import { login, logout } from './controllers/auth.controller.js';

import {
  helmetConfig,
  limiter,
  sanitizeInput,
  watermark,
  authPasswordLimiter,
  authSignupLimiter,
} from './middleware/security.js';

import {
  requestLogger,
  performanceMonitor,
  errorTracker,
} from './middleware/monitoring.js';

import { memoryMonitor, stopMemoryMonitor } from './middleware/performance.js';
import { authorityEnforcement } from './middleware/authorityBoundary.js';
import { tracePropagation } from './middleware/tracePropagation.js';

// ─── BHIV Ecosystem Integration Services ────────────────────────────────
import capabilityRegistry from './services/capabilityRegistry.service.js';
import provenanceChain from './services/provenanceChain.service.js';
import deterministicReplay from './services/deterministicReplay.service.js';
import circuitBreaker from './services/circuitBreaker.service.js';
import deploymentEvidence from './services/deploymentEvidence.service.js';
import { policyEnforcement } from './middleware/policyEngine.js';

// ─── BHIV Runtime Bridge Services ──────────────────────────────────────
import bhivRuntimeBridge from './services/bhivRuntimeBridge.service.js';
import runtimeRegistration from './services/runtimeRegistration.service.js';
import insightFlow from './services/insightflow.service.js';

import ledgerRoutes from './routes/ledger.routes.js';
import accountsRoutes from './routes/accounts.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import expenseRoutes from './routes/expense.routes.js';
import insightflowRoutes from './routes/insightflow.routes.js';
import gstRoutes from './routes/gst.routes.js';
import tdsRoutes from './routes/tds.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import performanceRoutes from './routes/performance.routes.js';
import databaseRoutes from './routes/database.routes.js';
import healthRoutes from './routes/health.routes.js';
import usersRoutes from './routes/users.routes.js';
import bankStatementRoutes from './routes/bankStatement.routes.js';
import smartUploadRoutes from './routes/smartUpload.routes.js';
import signalRoutes from './routes/signal.routes.js';
import complianceRoutes from './routes/compliance.routes.js';
import runtimeRoutes from './routes/runtime.routes.js';
import traceRoutes from './routes/trace.routes.js';
import bankingRoutes from './routes/banking.routes.js';
import auditRoutes from './routes/audit.routes.js';
import caWorkflowRoutes from './routes/caWorkflow.routes.js';
import tallyRoutes from './routes/tally.routes.js';
import tallyConnectorRoutes from './routes/tallyConnector.routes.js';
import tallyIngestRoutes from './routes/tallyIngest.routes.js';
import tallySyncScheduler from './services/tallySyncScheduler.service.js';
import multiCompanyRoutes from './routes/multiCompany.routes.js';
import tantraRoutes from './routes/tantra.routes.js';
import governanceRoutes from './routes/governance.routes.js';
import financialRuntimeRoutes from './routes/financialRuntime.routes.js';
import mitraRoutes from './routes/mitra.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import dealerRoutes from './routes/dealer.routes.js';
import salesAgentRoutes from './routes/salesAgent.routes.js';
import observabilityService from './services/observability.service.js';
import bankingService from './services/banking.service.js';
import auditService from './services/audit.service.js';
import caWorkflowService from './services/caWorkflow.service.js';
import setuDispatch from './services/setuDispatch.service.js';
import decisionLedger from './services/decisionLedger.service.js';
import tantraExecutionChain from './services/tantraExecutionChain.service.js';
import financialIntegration from './services/financialIntegration.service.js';
import bucketProvenance from './services/bucketProvenance.service.js';
import replayValidationSuite from './services/replayValidationSuite.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Reconfigure services that depend on env vars loaded after module imports
const pushNotificationService = (await import('./services/pushNotification.service.js')).default;
await pushNotificationService.reconfigure();

const { SPA_URL, API_PUBLIC_URL } = getResolvedUrls();

if (process.env.NODE_ENV === 'production') {
  validateEnvironment();
}

connectDB();

(async () => {
  try {
    await connectRedis();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn('Redis unavailable, continuing without cache');
  }
})();

// Initialize services
(async () => {
  try {
    await auditService.init();
    await bankingService.init();
    await caWorkflowService.init();
    await observabilityService.getSystemHealth();

    // Initialize BHIV ecosystem services
    capabilityRegistry.loadContracts();
    await provenanceChain.initialize();
    await decisionLedger.initialize();
    deterministicReplay.initialize();
    deploymentEvidence.initialize({ version: '0.1.0' });
    setuDispatch.initialize();
    tantraExecutionChain.initialize();

    // Initialize Financial Runtime integration
    await financialIntegration.initialize();
    bucketProvenance.initialize();
    replayValidationSuite.initialize();

    // Initialize BHIV Runtime Bridge services
    insightFlow.initialize();
    await bhivRuntimeBridge.initialize();
    await runtimeRegistration.register({
      appId: process.env.APP_ID || process.env.BHIV_APP_ID || 'ARTHA',
      version: '0.1.0',
    });

    // Automatic Tally → ARTHA sync (new Tally data flows in without manual steps)
    tallySyncScheduler.start();

    logger.info('All services initialized (including BHIV Runtime Bridge)');
  } catch (err) {
    logger.warn('Some services failed to initialize:', err.message);
  }
})();

const app = express();

// Render / reverse proxies: required so rate limits and req.ip use the real client (X-Forwarded-For).
app.set('trust proxy', process.env.TRUST_PROXY === '0' || process.env.TRUST_PROXY === 'false' ? false : 1);

const ALLOWED_ORIGINS = buildAllowedOrigins({
  frontendUrl: SPA_URL,
  appUrl: API_PUBLIC_URL,
  corsOrigin: process.env.CORS_ORIGIN,
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS,
  authServerUrl: '',
  // Default on: local Vite (localhost:5173) can call prod API without extra Render env.
  // Set ALLOW_LOCALHOST_CORS=false to disable.
  allowLocalhostCors: process.env.NODE_ENV !== 'production' && process.env.ALLOW_LOCALHOST_CORS !== 'false',
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.header('Access-Control-Allow-Origin', SPA_URL);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trace-Id, X-Request-Id, X-API-Key, X-Signature, X-Content-Hash');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(helmetConfig);
app.use(limiter);
app.use(watermark);

if (process.env.NODE_ENV === 'production') {
  app.use(requestLogger);
  app.use(performanceMonitor);
  memoryMonitor();
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(sanitizeInput);

// ─── TRACE PROPAGATION ────────────────────────────────────────────────
// Ensures trace_id flows through the entire BHIV execution chain.
// Must run AFTER body parsing (needs headers) but BEFORE authority enforcement.
app.use(tracePropagation);
// ────────────────────────────────────────────────────────────────────────

app.use('/uploads', protect, express.static('uploads'));

// ─── MANDATORY AUTHORITY ENFORCEMENT ────────────────────────────
// This middleware intercepts ALL requests and validates capability scope.
// It loads authority definitions from contracts/capability_contracts/*.json.
// It is NOT optional — it runs on every request before any route handler.
app.use(authorityEnforcement);
// ────────────────────────────────────────────────────────────────

// ─── POLICY ENGINE ENFORCEMENT ────────────────────────────────
// Runtime policy engine — enforces capability boundaries with deterministic
// policy decisions and audit recording. Runs AFTER authority enforcement.
app.use(policyEnforcement);
// ────────────────────────────────────────────────────────────────

app.use('/', healthRoutes);

/** Root: send browsers to the SPA (when someone opens the API host in a browser). */
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    return res.redirect(`${SPA_URL}/`);
  }
  res.json({ success: true, service: 'artha-api', docs: 'Use /api/v1/*' });
});

function redirectToSpaPath(req, res, pathName) {
  try {
    const target = new URL(`${SPA_URL}${pathName}`);
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    // Prevent accidental redirect loops when API and SPA are configured to the same origin+path.
    if (target.origin === requestOrigin && target.pathname === req.path) {
      return res.status(404).json({ success: false, message: 'Route not found' });
    }
    return res.redirect(target.toString());
  } catch {
    return res.redirect(`${SPA_URL}${pathName}`);
  }
}

app.get(['/login', '/signup', '/dashboard'], (req, res) => {
  return redirectToSpaPath(req, res, req.path);
});

app.get('/api/health', async (req, res) => {
  try {
    const health = await healthService.getSystemHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json({
      success: health.status === 'healthy',
      message: `ARTHA API is ${health.status}`,
      data: health,
    });
  } catch (err) {
    res.status(503).json({ success: false, message: 'Health check failed' });
  }
});

app.get('/test', (req, res) => {
  res.json({ success: true, message: 'Server running' });
});

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API accessible', origin: req.headers.origin });
});

app.get('/api/v1/auth/test', (req, res) => {
  res.json({ success: true, message: 'Auth routes working' });
});

/** Local password login — returns JWT for `Authorization: Bearer`. */
app.post('/api/v1/auth/login', authPasswordLimiter, login);
/**
 * Public signup is disabled: accounts are created by an admin (or sub-admin)
 * via POST /api/v1/users. Kept as an explicit 403 so stale clients get a
 * clear message instead of a 404.
 */
app.post('/api/v1/auth/signup', authSignupLimiter, (_req, res) => {
  res.status(403).json({
    success: false,
    message: 'Registration is closed. Contact your administrator for an account.',
  });
});
app.post('/api/v1/auth/logout', protect, logout);

app.get('/api/v1/auth/me', protect, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      roles: req.user.roles,
      allowedApps: req.user.allowedApps,
    },
  });
});

/** Clear legacy session cookie and send user to SPA login (client clears Bearer token). */
app.get('/logout', (req, res) => {
  clearBlackholeCookie(res);
  return res.redirect(`${SPA_URL}/login`);
});

/** Public push subscription endpoint — no auth required (service worker registers before auth). */
app.post('/api/v1/push/subscribe', async (req, res) => {
  try {
    const { subscription, userAgent } = req.body;
    if (!subscription) {
      return res.status(400).json({ success: false, message: 'Missing subscription' });
    }
    const pushNotificationService = (await import('./services/pushNotification.service.js')).default;
    const device = await pushNotificationService.registerWebPushSubscription(subscription, userAgent);
    res.json({ success: true, data: { deviceId: device._id } });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    res.status(500).json({ success: false, message: 'Subscription failed' });
  }
});

app.post('/api/v1/push/unsubscribe', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Missing token' });
    }
    const pushNotificationService = (await import('./services/pushNotification.service.js')).default;
    await pushNotificationService.removeDeviceToken(token);
    res.json({ success: true, message: 'Unsubscribed' });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    res.status(500).json({ success: false, message: 'Unsubscribe failed' });
  }
});

app.get('/api/v1/push/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.json({ success: true, data: { publicKey: key } });
});

/** Push diagnostic status — check if push pipeline is healthy */
app.get('/api/v1/push/status', async (req, res) => {
  try {
    const pushNotificationService = (await import('./services/pushNotification.service.js')).default;
    const DeviceToken = (await import('./models/DeviceToken.js')).default;
    const Notification = (await import('./models/Notification.js')).default;

    const totalTokens = await DeviceToken.countDocuments({ isActive: true, platform: 'web' });
    const totalNotifications = await Notification.countDocuments();
    const pushedNotifications = await Notification.countDocuments({ isPushed: true });

    res.json({
      success: true,
      data: {
        webPushAvailable: pushNotificationService.webPushAvailable,
        vapidPublicKeySet: !!process.env.VAPID_PUBLIC_KEY,
        vapidPrivateKeySet: !!process.env.VAPID_PRIVATE_KEY,
        activeWebSubscriptions: totalTokens,
        totalNotifications,
        pushedNotifications,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/** Test push notification — sends a test notification to all subscribers */
app.post('/api/v1/push/test', async (req, res) => {
  try {
    const pushNotificationService = (await import('./services/pushNotification.service.js')).default;

    if (!pushNotificationService.webPushAvailable) {
      return res.json({
        success: false,
        message: 'web-push not available. Check VAPID keys in .env',
        webPushAvailable: false,
        vapidPublicKey: !!process.env.VAPID_PUBLIC_KEY,
        vapidPrivateKey: !!process.env.VAPID_PRIVATE_KEY,
      });
    }

    const notification = await pushNotificationService.sendNotification({
      title: 'Test Notification',
      body: 'Push notifications are working! You will receive alerts for invoices, payments, and more.',
      type: 'system',
      category: 'system',
      priority: 'normal',
    });

    res.json({
      success: true,
      message: 'Test notification sent',
      notificationId: notification._id,
      isPushed: notification.isPushed,
      pushError: notification.pushError,
    });
  } catch (err) {
    logger.error('Push test error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/accounts', accountsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/insightflow', insightflowRoutes);
app.use('/api/v1/gst', gstRoutes);
app.use('/api/v1/tds', tdsRoutes);
app.use('/api/v1/compliance', complianceRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/performance', performanceRoutes);
app.use('/api/v1/database', databaseRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/statements', bankStatementRoutes);
app.use('/api/v1/upload', smartUploadRoutes);
app.use('/api/v1/signals', signalRoutes);
app.use('/api/v1/runtime', runtimeRoutes);
app.use('/api/v1/trace', traceRoutes);
app.use('/api/v1/banking', bankingRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/ca-workflow', caWorkflowRoutes);
app.use('/api/v1/tally', tallyRoutes);
app.use('/api/v1/tally-connect', tallyIngestRoutes);
app.use('/api/v1/tally-connect', tallyConnectorRoutes);
app.use('/api/v1/multi-company', multiCompanyRoutes);
app.use('/api/v1/tantra', tantraRoutes);
app.use('/api/v1/governance', governanceRoutes);
app.use('/api/v1/financial-runtime', financialRuntimeRoutes);
app.use('/api/v1/mitra', mitraRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/dealers', dealerRoutes);
app.use('/api/v1/sales-agents', salesAgentRoutes);

// SETU callback webhook endpoint (delegated to setuDispatch service)
// Protected by HMAC signature verification for external webhook security
app.post('/api/v1/setu/callback', async (req, res) => {
  try {
    const hmacSecret = process.env.SETU_HMAC_SECRET || process.env.HMAC_SECRET;
    if (!hmacSecret) {
      logger.error('SETU callback rejected: HMAC_SECRET not configured');
      return res.status(503).json({ success: false, message: 'Webhook security not configured' });
    }

    const signature = req.headers['x-setu-signature'] || req.headers['x-hmac-signature'];
    if (!signature) {
      logger.warn('SETU callback missing signature');
      return res.status(401).json({ success: false, message: 'Missing webhook signature' });
    }

    const crypto = await import('crypto');
    const expectedSig = crypto.createHmac('sha256', hmacSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.warn('SETU callback invalid signature');
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const result = await setuDispatch.processAcknowledgement(req.body);
    if (result.success) {
      res.json({ success: true, message: 'Callback processed' });
    } else {
      res.status(result.message === 'Dispatch not found' ? 404 : 400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (err) {
    logger.error(`SETU callback error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// SETU dispatch endpoint
app.post('/api/v1/setu/dispatch', protect, async (req, res) => {
  try {
    const result = await setuDispatch.dispatchSignal(req.body.signal, req.body.options);
    if (result.success) {
      res.json({ success: true, data: result });
    } else {
      res.status(400).json({ success: false, error: result.error, stage: result.stage });
    }
  } catch (err) {
    logger.error(`SETU dispatch error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// SETU dispatch stats
app.get('/api/v1/setu/stats', protect, async (req, res) => {
  try {
    const stats = await setuDispatch.getDispatchStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error(`SETU stats error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use(errorTracker);

app.use((err, req, res, _next) => {
  logger.error(err);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.statusCode || 500).json({
    success: false,
    message: isProduction ? 'Internal server error' : (err.message || 'Server error'),
  });
});

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`SPA (public app): ${SPA_URL}`);
    logger.info(`API public URL: ${API_PUBLIC_URL}`);

    // Log governance status
    const registryMetadata = capabilityRegistry.getRegistryMetadata();
    logger.info(`Capability Registry: ${registryMetadata.capability_count} capabilities, ${registryMetadata.route_count} routes`);
    logger.info(`Registration ID: ${registryMetadata.registration_id}`);
    logger.info(`Provenance Chain: initialized`);
    logger.info(`Circuit Breakers: ${Object.keys(circuitBreaker.getStatus()).length} registered`);
    logger.info(`Governance Routes: GET /api/v1/governance/status`);

    const enforcedAppId = process.env.APP_ID || process.env.BHIV_APP_ID;
    if (enforcedAppId) {
      logger.info(`allowedApps enforced for APP_ID: ${enforcedAppId}`);
    }

    // Record deployment evidence
    deploymentEvidence.recordEvidence({
      type: 'SERVER_STARTED',
      category: 'startup',
      details: {
        port: PORT,
        spa_url: SPA_URL,
        api_url: API_PUBLIC_URL,
        capabilities_loaded: registryMetadata.capability_count,
        routes_registered: registryMetadata.route_count,
      },
    });

    provenanceChain.recordDeployment({
      action: 'START',
      version: '0.1.0',
      environment: process.env.NODE_ENV || 'development',
      details: { port: PORT },
    }).catch(() => {});
  });
}

// ─── Graceful Shutdown ─────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  logger.info(`[SHUTDOWN] ${signal} received, starting graceful shutdown...`);

  stopMemoryMonitor();

  try {
    await runtimeRegistration.deregister();
    logger.info('[SHUTDOWN] Deregistered from BHIV Core');
  } catch (err) {
    logger.warn(`[SHUTDOWN] Deregistration failed: ${err.message}`);
  }

  try {
    const mongoose = await import('mongoose');
    await mongoose.default.connection.close(false);
    logger.info('[SHUTDOWN] MongoDB connection closed');
  } catch (err) {
    logger.warn(`[SHUTDOWN] MongoDB close failed: ${err.message}`);
  }

  try {
    const { disconnectRedis } = await import('./config/redis.js');
    await disconnectRedis();
    logger.info('[SHUTDOWN] Redis connection closed');
  } catch (err) {
    logger.warn(`[SHUTDOWN] Redis close failed: ${err.message}`);
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Keep the process alive on async failures: log them (winston -> logs/error.log)
// instead of letting Node's default behaviour kill the server.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(`Unhandled promise rejection (kept alive): ${err.message}`, { stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception (kept alive): ${err.message}`, { stack: err.stack });
});

export default app;
