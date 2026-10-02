import bankStatementService from '../services/bankStatement.service.js';
import logger from '../config/logger.js';
import fs from 'fs';

/**
 * Extract statement metadata from an uploaded file (pre-save preview).
 * Used to pre-fill the upload form; nothing is persisted.
 */
export const extractBankStatementDetails = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file',
      });
    }

    const details = await bankStatementService.extractDetailsFromFile(req.file);

    res.json({
      success: true,
      data: details,
      message: details.detectedFields?.length
        ? 'Details extracted from file'
        : 'No details detected — please fill the form manually',
    });
  } catch (error) {
    logger.error('Extract bank statement details error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
};

/**
 * Upload bank statement
 */
export const uploadBankStatement = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file',
      });
    }

    const { accountNumber, bankName, accountHolderName, startDate, endDate, openingBalance, closingBalance } = req.body;

    const statement = await bankStatementService.uploadBankStatement(
      {
        accountNumber,
        bankName,
        accountHolderName,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        openingBalance,
        closingBalance,
      },
      req.user._id,
      req.file
    );

    res.status(201).json({
      success: true,
      data: statement,
      message: 'Bank statement uploaded and processing started',
    });
  } catch (error) {
    logger.error('Upload bank statement error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all bank statements
 */
export const getBankStatements = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      accountNumber: req.query.accountNumber,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    };

    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      sortBy: req.query.sortBy || 'endDate',
      sortOrder: req.query.sortOrder || 'desc',
    };

    const result = await bankStatementService.getBankStatements(filters, pagination);

    res.json({
      success: true,
      ...result,
      data: result.statements,
    });
  } catch (error) {
    logger.error('Get bank statements error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get single bank statement
 */
export const getBankStatement = async (req, res) => {
  try {
    const statement = await bankStatementService.getBankStatementById(req.params.id);

    res.json({
      success: true,
      data: statement,
    });
  } catch (error) {
    logger.error('Get bank statement error:', error);
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Process bank statement manually (if auto-processing failed)
 */
export const processBankStatement = async (req, res) => {
  try {
    const statement = await bankStatementService.processStatementFile(req.params.id, req.user._id);

    res.json({
      success: true,
      data: statement,
      message: 'Bank statement processed and auto-reconciled successfully',
    });
  } catch (error) {
    logger.error('Process bank statement error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Match transactions with expenses
 */
export const matchTransactions = async (req, res) => {
  try {
    const result = await bankStatementService.matchTransactions(req.params.id);

    res.json({
      success: true,
      data: result,
      message: `Matched ${result.matched} of ${result.total} transactions`,
    });
  } catch (error) {
    logger.error('Match transactions error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Create expenses from selected transactions
 */
export const createExpensesFromTransactions = async (req, res) => {
  try {
    const { transactionIds } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds)) {
      return res.status(400).json({
        success: false,
        message: 'Transaction IDs array is required',
      });
    }

    const expenses = await bankStatementService.createExpensesFromTransactions(
      req.params.id,
      req.user._id,
      transactionIds
    );

    res.status(201).json({
      success: true,
      data: expenses,
      message: `Created ${expenses.length} expenses from transactions`,
    });
  } catch (error) {
    logger.error('Create expenses from transactions error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Permanently delete bank statement
 */
export const deleteBankStatement = async (req, res) => {
  try {
    const result = await bankStatementService.deleteBankStatement(req.params.id, req.user);

    res.json({
      success: true,
      data: result,
      message: 'Bank statement deleted permanently',
    });
  } catch (error) {
    logger.error('Delete bank statement error:', error);
    const statusCode =
      error.message === 'Bank statement not found'
        ? 404
        : error.message === 'Not authorized to delete this bank statement'
          ? 403
          : 400;

    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};
