import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import receivablesService from '../services/receivables.service.js';
import logger from '../config/logger.js';

const router = express.Router();

router.use(protect);

// @route   GET /api/v1/receivables/reports
// @desc    List parsed receivables reports (summaries)
// @access  Private
router.get('/reports', authorize('admin', 'sub_admin', 'accountant', 'viewer'), async (req, res) => {
  try {
    const data = await receivablesService.listReports({
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    logger.error('List receivable reports error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/v1/receivables/reports/latest
// @desc    Most recent parsed report with customers + bills
// @access  Private
router.get('/reports/latest', authorize('admin', 'sub_admin', 'accountant', 'viewer'), async (req, res) => {
  try {
    const doc = await receivablesService.getLatestReport();
    if (!doc) return res.status(404).json({ success: false, message: 'No receivables reports yet' });
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('Get latest receivable report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/v1/receivables/reports/:reportId
// @desc    Full parsed report with customers + bills
// @access  Private
router.get('/reports/:reportId', authorize('admin', 'sub_admin', 'accountant', 'viewer'), async (req, res) => {
  try {
    const doc = await receivablesService.getReport(req.params.reportId);
    res.json({ success: true, data: doc });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status !== 500) logger.warn(`Get receivable report ${req.params.reportId}: ${error.message}`);
    else logger.error('Get receivable report error:', error);
    res.status(status).json({ success: false, message: error.message });
  }
});

export default router;
