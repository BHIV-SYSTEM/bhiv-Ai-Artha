import smartUploadService from '../services/smartUpload.service.js';
import logger from '../config/logger.js';

/**
 * @desc    Smart upload — single file, auto-detect type and process
 * @route   POST /api/v1/upload
 * @access  Private
 */
export const smartUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file',
      });
    }

    const metadata = {
      documentType: req.body.documentType,
      password: req.body.password,
      vendor: req.body.vendor,
      customerName: req.body.customerName,
      description: req.body.description,
      category: req.body.category,
      amount: req.body.amount,
      taxAmount: req.body.taxAmount,
      date: req.body.date,
      paymentMethod: req.body.paymentMethod,
      accountNumber: req.body.accountNumber,
      bankName: req.body.bankName,
      accountHolderName: req.body.accountHolderName,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      openingBalance: req.body.openingBalance,
      closingBalance: req.body.closingBalance,
    };

    const result = await smartUploadService.processUpload(
      req.file,
      req.user._id,
      metadata
    );

    res.status(201).json({
      success: true,
      message: `Document processed as ${result.documentType}`,
      data: result,
    });
  } catch (error) {
    logger.error('Smart upload error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    Smart upload — multiple files, auto-detect and process each
 * @route   POST /api/v1/upload/batch
 * @access  Private
 */
export const smartUploadBatch = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please upload at least one file',
      });
    }

    const metadata = {
      documentType: req.body.documentType,
      category: req.body.category,
    };

    const result = await smartUploadService.processBatchUpload(
      req.files,
      req.user._id,
      metadata
    );

    res.status(201).json({
      success: true,
      message: `Processed ${result.processed} of ${result.totalFiles} files`,
      data: result,
    });
  } catch (error) {
    logger.error('Smart batch upload error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
