import express from 'express';
import {
  getSettings,
  updateSettings,
  getCurrentFinancialYear,
} from '../controllers/companySettings.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { auditLogger } from '../middleware/security.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Routes
router
  .route('/')
  .get(getSettings)
  .put(
    authorize('admin'),
    auditLogger('settings.updated', 'CompanySettings'),
    updateSettings
  );

// The frontend settings tab calls /settings/company — keep it as an alias.
router
  .route('/company')
  .get(getSettings)
  .put(
    authorize('admin'),
    auditLogger('settings.updated', 'CompanySettings'),
    updateSettings
  );

router.route('/financial-year').get(getCurrentFinancialYear);

export default router;