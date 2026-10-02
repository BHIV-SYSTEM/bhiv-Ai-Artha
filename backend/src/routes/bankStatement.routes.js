import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { uploadFile, handleUploadError } from '../middleware/upload.js';
import {
  extractBankStatementDetails,
  uploadBankStatement,
  getBankStatements,
  getBankStatement,
  processBankStatement,
  matchTransactions,
  createExpensesFromTransactions,
  deleteBankStatement,
} from '../controllers/bankStatement.controller.js';

const router = express.Router();

router.use(protect);

router.post(
  '/extract',
  authorize('admin', 'accountant'),
  uploadFile.single('statement'),
  handleUploadError,
  extractBankStatementDetails
);

router.post(
  '/upload',
  authorize('admin', 'accountant'),
  uploadFile.single('statement'),
  handleUploadError,
  uploadBankStatement
);

router.get('/', authorize('admin', 'accountant', 'viewer'), getBankStatements);
router.get('/:id', authorize('admin', 'accountant', 'viewer'), getBankStatement);
router.delete('/:id', authorize('admin'), deleteBankStatement);
router.post('/:id/process', authorize('admin', 'accountant'), processBankStatement);
router.post('/:id/match', authorize('admin', 'accountant'), matchTransactions);
router.post('/:id/create-expenses', authorize('admin', 'accountant'), createExpensesFromTransactions);

export default router;
