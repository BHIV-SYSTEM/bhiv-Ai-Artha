import express from 'express';
import { body } from 'express-validator';
import {
  createExpense,
  getExpenses,
  getExpense,
  updateExpense,
  approveExpense,
  rejectExpense,
  recordExpense,
  deleteReceipt,
  getExpenseStats,
} from '../controllers/expense.controller.js';
import { processReceiptOCR, getOCRStatus } from '../controllers/ocr.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate, auditLogger } from '../middleware/security.js';
import { uploadReceipts, handleUploadError } from '../middleware/upload.js';
import { cacheMiddleware } from '../middleware/cache.js';

const router = express.Router();

// Validation rules
const expenseValidation = [
  body('category')
    .isIn([
      'travel',
      'meals',
      'supplies',
      'utilities',
      'rent',
      'insurance',
      'marketing',
      'professional_services',
      'equipment',
      'software',
      'other',
    ])
    .withMessage('Valid category required'),
  body('vendor').trim().notEmpty().withMessage('Vendor is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('amount').custom(value => {
    const num = parseFloat(value);
    return !isNaN(num) && num > 0;
  }).withMessage('Amount must be a positive number'),
  body('gstRate').optional().custom(value => {
    const allowedRates = [0, 5, 12, 18, 28];
    const rateNum = Number(value);
    return !isNaN(rateNum) && allowedRates.includes(rateNum);
  }).withMessage('GST rate must be one of 0, 5, 12, 18, 28'),
  body('gstRate').custom((value, { req }) => {
    const taxAmount = parseFloat(req.body.taxAmount || 0);
    const rateValue = value === undefined || value === null || value === '' ? null : Number(value);

    if (taxAmount > 0 && (rateValue === null || isNaN(rateValue))) {
      throw new Error('GST rate is required when tax amount is provided');
    }
    return true;
  }),
  body('supplierState').custom((value, { req }) => {
    const taxAmount = parseFloat(req.body.taxAmount || 0);
    const rateValue = req.body.gstRate === undefined || req.body.gstRate === null || req.body.gstRate === ''
      ? null
      : Number(req.body.gstRate);

    if ((taxAmount > 0 || (rateValue !== null && rateValue > 0)) && !value) {
      throw new Error('Supplier state is required for GST');
    }
    return true;
  }),
  body('paymentMethod')
    .isIn(['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'other'])
    .withMessage('Valid payment method required'),
];

// All routes require authentication
router.use(protect);

// OCR Routes
router.route('/ocr/status').get(getOCRStatus);
router
  .route('/ocr')
  .post(
    uploadReceipts.single('receipt'),
    handleUploadError,
    processReceiptOCR
  );

// Routes
router.route('/stats').get(cacheMiddleware(900), getExpenseStats);

router
  .route('/')
  .get(cacheMiddleware(300), getExpenses)
  .post(
    authorize('admin', 'accountant'),
    uploadReceipts.array('receipts', 5),
    handleUploadError,
    expenseValidation,
    validate,
    auditLogger('expense.created', 'Expense'),
    createExpense
  );

router
  .route('/:id')
  .get(cacheMiddleware(600), getExpense)
  .put(
    authorize('admin', 'accountant'),
    uploadReceipts.array('receipts', 5),
    handleUploadError,
    validate,
    auditLogger('expense.updated', 'Expense'),
    updateExpense
  );

router
  .route('/:id/approve')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('expense.approved', 'Expense'),
    approveExpense
  );

router
  .route('/:id/reject')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('expense.rejected', 'Expense'),
    rejectExpense
  );

router
  .route('/:id/record')
  .post(
    authorize('accountant', 'admin'),
    auditLogger('expense.recorded', 'Expense'),
    recordExpense
  );

router
  .route('/:id/receipts/:receiptId')
  .delete(authorize('admin', 'accountant'), deleteReceipt);

export default router;