import express from 'express';
import tallyConnectorController from '../controllers/tallyConnector.controller.js';
import { protect, authorize } from '../middleware/auth.js';

/**
 * Read-only Tally connector routes (additive — new capability under
 * ARTHA-LEDGER-001 in capability_route_map.json).
 * Mounted in server.js at /api/v1/tally-connect.
 */
const router = express.Router();

router.use(protect);

router.get('/config', tallyConnectorController.getConfig);
router.get('/manifest', tallyConnectorController.getManifest);
router.get('/health', tallyConnectorController.getHealth);
router.get('/readonly-proof', tallyConnectorController.readonlyProof);

// Per-account connector credentials (workspace-bound ingest keys)
router.get('/credentials', authorize('admin', 'sub_admin'), tallyConnectorController.getCredentials);
router.post('/credentials/rotate', authorize('admin', 'sub_admin'), tallyConnectorController.rotateCredentials);
router.post('/credentials/revoke', authorize('admin', 'sub_admin'), tallyConnectorController.revokeCredentials);

router.post('/sync', tallyConnectorController.runSync);
router.post('/sync/now', tallyConnectorController.syncNow);
router.get('/sync/status', tallyConnectorController.syncStatus);

router.get('/parties', tallyConnectorController.listParties);
router.get('/outstanding', tallyConnectorController.listOutstanding);
router.get('/vouchers', tallyConnectorController.listVouchers);

router.get('/dealer/:partyName', tallyConnectorController.dealerSummary);
router.post('/dealer/:partyName/setu', tallyConnectorController.dealerSetu);

router.get('/setu/mdu-export', tallyConnectorController.exportMdu);
router.get('/sync-runs', tallyConnectorController.listSyncRuns);

export default router;