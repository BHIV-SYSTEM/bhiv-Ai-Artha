import express from 'express';
import caWorkflowController from '../controllers/caWorkflow.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/action-items', authorize('admin', 'accountant', 'viewer'), caWorkflowController.getActionItems);

router.get('/periods', authorize('admin', 'accountant', 'viewer'), caWorkflowController.getPeriods);
router.post('/periods', authorize('admin'), caWorkflowController.getOrCreatePeriod);
router.post('/periods/:periodId/month-close', authorize('admin'), caWorkflowController.monthClose);
router.post('/periods/:periodId/quarter-close', authorize('admin'), caWorkflowController.quarterClose);
router.post('/periods/:periodId/annual-close', authorize('admin'), caWorkflowController.annualClose);
router.get('/periods/:periodId/trial-balance', authorize('admin', 'accountant', 'viewer'), caWorkflowController.generateTrialBalance);

export default router;
