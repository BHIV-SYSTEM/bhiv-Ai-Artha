import gstService from '../services/gst.service.js';
import gstFilingService from '../services/gstFiling.service.js';
import logger from '../config/logger.js';

// @desc    Generate GSTR1
// @route   POST /api/v1/gst/gstr1/generate
// @access  Private (accountant, admin)
export const generateGSTR1 = async (req, res) => {
  try {
    const { month, year } = req.body;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Month and year are required',
      });
    }
    
    const gstr1 = await gstService.generateGSTR1(month, year);
    
    res.json({
      success: true,
      data: gstr1,
    });
  } catch (error) {
    logger.error('Generate GSTR1 error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Generate GSTR3B
// @route   POST /api/v1/gst/gstr3b/generate
// @access  Private (accountant, admin)
export const generateGSTR3B = async (req, res) => {
  try {
    const { month, year } = req.body;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Month and year are required',
      });
    }
    
    const gstr3b = await gstService.generateGSTR3B(month, year);
    
    res.json({
      success: true,
      data: gstr3b,
    });
  } catch (error) {
    logger.error('Generate GSTR3B error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get GST returns
// @route   GET /api/v1/gst/returns
// @access  Private
export const getGSTReturns = async (req, res) => {
  try {
    const sanitizeString = (val) => {
      if (typeof val !== 'string') return val;
      return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const filters = {
      returnType: sanitizeString(req.query.returnType),
      year: sanitizeString(req.query.year),
      month: sanitizeString(req.query.month),
      status: sanitizeString(req.query.status),
    };
    
    const returns = await gstService.getGSTReturns(filters);
    
    res.json({
      success: true,
      data: returns,
    });
  } catch (error) {
    logger.error('Get GST returns error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    File GST return
// @route   POST /api/v1/gst/returns/:id/file
// @access  Private (accountant, admin)
export const fileGSTReturn = async (req, res) => {
  try {
    const gstReturn = await gstService.fileGSTReturn(req.params.id, req.user._id, {
      acknowledgementNumber: req.body?.acknowledgementNumber,
      portalUrl: req.body?.portalUrl,
      filedVia: req.body?.filedVia || 'GST_PORTAL',
    });
    
    res.json({
      success: true,
      data: gstReturn,
    });
  } catch (error) {
    logger.error('File GST return error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Validate GSTIN
// @route   POST /api/v1/gst/validate-gstin
// @access  Private
export const validateGSTIN = async (req, res) => {
  try {
    const { gstin } = req.body;
    
    if (!gstin) {
      return res.status(400).json({
        success: false,
        message: 'GSTIN is required',
      });
    }
    
    const isValid = gstService.validateGSTIN(gstin);
    
    res.json({
      success: true,
      data: {
        gstin,
        isValid,
      },
    });
  } catch (error) {
    logger.error('Validate GSTIN error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get GST summary for dashboard
// @route   GET /api/v1/gst/summary
// @access  Private
export const getGSTSummary = async (req, res) => {
  try {
    const { period } = req.query;
    
    if (!period) {
      return res.status(400).json({
        success: false,
        message: 'Period is required (format: YYYY-MM)',
      });
    }
    
    const summary = await gstFilingService.getGSTSummary(period);
    
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error('Get GST summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};