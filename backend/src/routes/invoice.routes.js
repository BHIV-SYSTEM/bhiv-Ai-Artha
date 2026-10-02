import express from 'express';
import { body } from 'express-validator';
import {
  createInvoice,
  getInvoices,
  getInvoice,
  getSharedInvoice,
  getSharedInvoices,
  updateInvoice,
  sendInvoice,
  recordPayment,
  cancelInvoice,
  getInvoiceStats,
  downloadInvoicePDF,
} from '../controllers/invoice.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, auditLogger } from '../middleware/security.js';
import { cacheMiddleware } from '../middleware/cache.js';

const router = express.Router();

// Validation rules with support for both items and lines
const invoiceValidation = [
  body('customerName').trim().notEmpty().withMessage('Customer name is required'),
  body('customerEmail').isEmail().withMessage('Valid email required'),
  body('invoiceDate').custom(value => {
    return !isNaN(Date.parse(value));
  }).withMessage('Valid invoice date required'),
  body('dueDate').custom(value => {
    return !isNaN(Date.parse(value));
  }).withMessage('Valid due date required'),
  body().custom((value, { req }) => {
    const hasItems = req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0;
    const hasLines = req.body.lines && Array.isArray(req.body.lines) && req.body.lines.length > 0;
    
    if (!hasItems && !hasLines) {
      throw new Error('At least 1 line item required');
    }
    return true;
  }),
];

const paymentValidation = [
  body('amount').isNumeric().withMessage('Payment amount is required'),
  body('paymentMethod')
    .isIn(['cash', 'bank_transfer', 'check', 'card', 'upi', 'other'])
    .withMessage('Valid payment method required'),
];

// All routes require authentication
router.use(protect);

// Routes
router.route('/stats').get(cacheMiddleware(900), getInvoiceStats);

router.route('/shared').get(getSharedInvoices);
router.route('/:id/shared').get(getSharedInvoice);

router
  .route('/')
  .get(cacheMiddleware(300), getInvoices)
  .post(
    authorize('accountant', 'admin'),
    invoiceValidation,
    validate,
    auditLogger('invoice.created', 'Invoice'),
    createInvoice
  );

router
  .route('/:id')
  .get(cacheMiddleware(600), getInvoice)
  .put(
    authorize('accountant', 'admin'),
    validate,
    auditLogger('invoice.updated', 'Invoice'),
    updateInvoice
  );

router
  .route('/:id/send')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('invoice.sent', 'Invoice'),
    sendInvoice
  );

router
  .route('/:id/payment')
  .post(
    authorize('accountant', 'admin'),
    paymentValidation,
    validate,
    auditLogger('invoice.payment_recorded', 'Invoice'),
    recordPayment
  );

router
  .route('/:id/cancel')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('invoice.cancelled', 'Invoice'),
    cancelInvoice
  );

router
  .route('/:id/pdf')
  .get(downloadInvoicePDF);

export default router;