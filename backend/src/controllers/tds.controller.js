import tdsService from '../services/tds.service.js';
import logger from '../config/logger.js';

// @desc    Create TDS entry
// @route   POST /api/v1/tds/entries
// @access  Private (accountant, admin)
export const createTDSEntry = async (req, res) => {
  try {
    const entry = await tdsService.createTDSEntry(req.body, req.user._id);
    
    res.status(201).json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Create TDS entry error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get TDS entries
// @route   GET /api/v1/tds/entries
// @access  Private
export const getTDSEntries = async (req, res) => {
  try {
    const sanitizeString = (val) => {
      if (typeof val !== 'string') return val;
      return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const filters = {
      status: sanitizeString(req.query.status),
      section: sanitizeString(req.query.section),
      quarter: sanitizeString(req.query.quarter),
      financialYear: sanitizeString(req.query.financialYear),
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      pan: sanitizeString(req.query.pan),
    };
    
    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      sortBy: req.query.sortBy || 'transactionDate',
      sortOrder: req.query.sortOrder || 'desc',
    };
    
    const result = await tdsService.getTDSEntries(filters, pagination);
    
    res.json({
      success: true,
      data: result.entries,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error('Get TDS entries error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Record TDS deduction
// @route   POST /api/v1/tds/entries/:id/deduct
// @access  Private (accountant, admin)
export const recordTDSDeduction = async (req, res) => {
  try {
    const entry = await tdsService.recordTDSDeduction(req.params.id, req.user._id);
    
    res.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Record TDS deduction error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Record challan deposit
// @route   POST /api/v1/tds/entries/:id/challan
// @access  Private (accountant, admin)
export const recordChallanDeposit = async (req, res) => {
  try {
    const entry = await tdsService.recordChallanDeposit(
      req.params.id,
      req.body,
      req.user._id
    );
    
    res.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Record challan deposit error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Record a government TDS filing (acknowledgement)
// @route   POST /api/v1/tds/entries/:id/file
// @access  Private (accountant, admin)
export const recordTDSFiling = async (req, res) => {
  try {
    const entry = await tdsService.recordTDSFiling(
      req.params.id,
      req.body,
      req.user._id
    );

    res.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Record TDS filing error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get TDS summary
// @route   GET /api/v1/tds/summary
// @access  Private
export const getTDSSummary = async (req, res) => {
  try {
    const { quarter, financialYear } = req.query;
    
    if (!quarter || !financialYear) {
      return res.status(400).json({
        success: false,
        message: 'Quarter and financial year are required',
      });
    }
    
    const summary = await tdsService.getTDSSummary(quarter, financialYear);
    
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Get TDS summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get TDS dashboard summary
// @route   GET /api/v1/tds/dashboard
// @access  Private
export const getTDSDashboard = async (req, res) => {
  try {
    const { quarter, financialYear } = req.query;
    
    if (!quarter || !financialYear) {
      return res.status(400).json({
        success: false,
        message: 'Quarter and financial year are required',
      });
    }
    
    const dashboard = await tdsService.getTDSDashboardSummary(quarter, financialYear);
    
    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    logger.error('Get TDS dashboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Generate Form 26Q
// @route   GET /api/v1/tds/form26q
// @access  Private (accountant, admin)
export const generateForm26Q = async (req, res) => {
  try {
    const { quarter, financialYear } = req.query;
    
    if (!quarter || !financialYear) {
      return res.status(400).json({
        success: false,
        message: 'Quarter and financial year are required',
      });
    }
    
    const form26Q = await tdsService.generateForm26Q(quarter, financialYear);
    
    res.json({
      success: true,
      data: form26Q,
    });
  } catch (error) {
    logger.error('Generate Form 26Q error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Calculate TDS
// @route   POST /api/v1/tds/calculate
// @access  Private
export const calculateTDS = async (req, res) => {
  try {
    const { amount, section, customRate } = req.body;
    
    if (!amount || !section) {
      return res.status(400).json({
        success: false,
        message: 'Amount and section are required',
      });
    }
    
    const result = tdsService.calculateTDS(amount, section, customRate);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Calculate TDS error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};