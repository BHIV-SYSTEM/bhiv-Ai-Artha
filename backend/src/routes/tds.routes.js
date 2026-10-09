
import express from 'express';
import { body } from 'express-validator';
import {
  createTDSEntry,
  getTDSEntries,
  recordTDSDeduction,
  recordChallanDeposit,
  recordTDSFiling,
  getTDSSummary,
  getTDSDashboard,
  generateForm26Q,
  calculateTDS,
} from '../controllers/tds.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, auditLogger } from '../middleware/security.js';

const router = express.Router();

// Validation rules
const tdsEntryValidation = [
  body('deductee.name').trim().notEmpty().withMessage('Deductee name is required'),
  body('deductee.pan')
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .withMessage('Invalid PAN format'),
  body('section').notEmpty().withMessage('TDS section is required'),
  body('paymentAmount').isNumeric().withMessage('Payment amount is required'),
];

// All routes require authentication
router.use(protect);

// Routes
router.route('/calculate').post(calculateTDS);

router.route('/summary').get(getTDSSummary);

router.route('/dashboard').get(getTDSDashboard);

router.route('/form26q').get(authorize('accountant', 'admin', 'viewer'), generateForm26Q);

router
  .route('/entries')
  .get(getTDSEntries)
  .post(
    authorize('accountant', 'admin'),
    tdsEntryValidation,
    validate,
    auditLogger('tds.entry_created', 'TDSEntry'),
    createTDSEntry
  );

router
  .route('/entries/:id/deduct')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('tds.deduction_recorded', 'TDSEntry'),
    recordTDSDeduction
  );

router
  .route('/entries/:id/challan')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('tds.challan_recorded', 'TDSEntry'),
    recordChallanDeposit
  );

router
  .route('/entries/:id/file')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('tds.filing_recorded', 'TDSEntry'),
    recordTDSFiling
  );

export default router;