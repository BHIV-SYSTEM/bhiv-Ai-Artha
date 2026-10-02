import companySettingsService from '../services/companySettings.service.js';
import logger from '../config/logger.js';

// @desc    Get company settings
// @route   GET /api/v1/settings
// @access  Private
export const getSettings = async (req, res) => {
  try {
    const settings = await companySettingsService.getSettings();
    
    res.json({
      success: true,
      data: companySettingsService.toClientShape(settings),
    });
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update company settings
// @route   PUT /api/v1/settings
// @access  Private (admin)
export const updateSettings = async (req, res) => {
  try {
    const settings = await companySettingsService.updateSettings(req.body);
    
    res.json({
      success: true,
      data: companySettingsService.toClientShape(settings),
    });
  } catch (error) {
    logger.error('Update settings error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get current financial year
// @route   GET /api/v1/settings/financial-year
// @access  Private
export const getCurrentFinancialYear = async (req, res) => {
  try {
    const fy = companySettingsService.getCurrentFinancialYear();
    
    res.json({
      success: true,
      data: fy,
    });
  } catch (error) {
    logger.error('Get financial year error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};