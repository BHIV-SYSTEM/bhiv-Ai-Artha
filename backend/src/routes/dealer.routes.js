import express from 'express';
import {
  createDealer,
  getDealers,
  getDealerById,
  updateDealer,
  deleteDealer,
  getDealerSummary,
  syncFromTally,
  syncSetu,
  syncOutstanding,
  getDealerStats,
  getRegions,
  getCities,
  updateDealerLocation,
  bulkUpdateLocations,
} from '../controllers/dealer.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/stats', getDealerStats);
router.get('/regions', getRegions);
router.get('/cities', getCities);
router.post('/sync-tally', authorize('admin'), syncFromTally);
router.post('/sync-setu', authorize('admin'), syncSetu);
router.post('/sync-outstanding', authorize('admin'), syncOutstanding);
router.post('/locations/bulk', authorize('admin', 'accountant'), bulkUpdateLocations);
router.get('/', getDealers);
router.post('/', authorize('admin', 'accountant'), createDealer);
router.get('/:id', getDealerById);
router.put('/:id', authorize('admin', 'accountant'), updateDealer);
router.put('/:id/location', authorize('admin', 'accountant'), updateDealerLocation);
router.delete('/:id', authorize('admin'), deleteDealer);
router.get('/:id/summary', getDealerSummary);

export default router;
