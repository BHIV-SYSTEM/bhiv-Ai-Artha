import invoiceService from '../services/invoice.service.js';
import pdfService from '../services/pdf.service.js';
import logger from '../config/logger.js';
import financialEventEmitter from '../services/financialEventEmitter.service.js';
import financialIntegration from '../services/financialIntegration.service.js';

// @desc    Create invoice
// @route   POST /api/v1/invoices
// @access  Private (accountant, admin)
export const createInvoice = async (req, res) => {
  try {
    // Map lines to items for backward compatibility
    if (req.body.lines && !req.body.items) {
      req.body.items = req.body.lines;
    }
    
    const invoice = await invoiceService.createInvoice(req.body, req.user._id);
    
    // Emit immutable financial event
    await financialEventEmitter.emitInvoiceCreated(invoice, req.user._id);

    // Financial integration hooks
    await financialIntegration.onInvoiceCreated(invoice, req.user._id);

    res.status(201).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Create invoice error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get invoices
// @route   GET /api/v1/invoices
// @access  Private
export const getInvoices = async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      customerName: req.query.customerName,
      search: req.query.search,
    };
    
    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      sortBy: req.query.sortBy || 'invoiceDate',
      sortOrder: req.query.sortOrder || 'desc',
    };
    
    const result = await invoiceService.getInvoices(filters, pagination);
    
    res.json({
      success: true,
      data: result.invoices,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error('Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/v1/invoices/:id
// @access  Private
export const getInvoice = async (req, res) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id);
    
    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Get invoice error:', error);
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get invoice shared with the requester (matched by customer email or GST)
// @route   GET /api/v1/invoices/:id/shared
// @access  Private
export const getSharedInvoice = async (req, res) => {
  try {
    const invoice = await invoiceService.getSharedInvoice(req.params.id, req.user);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.json({ success: true, data: invoice });
  } catch (error) {
    logger.error('Get shared invoice error:', error);
    res.status(500).json({ success: false, message: 'Could not load invoice' });
  }
};

// @desc    List invoices addressed to the requester (shared from other workspaces)
// @route   GET /api/v1/invoices/shared
// @access  Private
export const getSharedInvoices = async (req, res) => {
  try {
    const invoices = await invoiceService.getSharedInvoices(req.user);
    res.json({ success: true, data: invoices });
  } catch (error) {
    logger.error('Get shared invoices error:', error);
    res.status(500).json({ success: false, message: 'Could not load shared invoices' });
  }
};

// @desc    Update invoice
// @route   PUT /api/v1/invoices/:id
// @access  Private (accountant, admin)
export const updateInvoice = async (req, res) => {
  try {
    const invoice = await invoiceService.updateInvoice(req.params.id, req.body);
    
    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Update invoice error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Send invoice
// @route   POST /api/v1/invoices/:id/send
// @access  Private (accountant, admin)
export const sendInvoice = async (req, res) => {
  try {
    const invoice = await invoiceService.sendInvoice(req.params.id, req.user._id);
    
    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Send invoice error:', error);
    const payload = {
      success: false,
      message: error.message,
    };
    if (error.code) payload.code = error.code;
    if (error.details) payload.details = error.details;
    res.status(400).json(payload);
  }
};

// @desc    Record payment
// @route   POST /api/v1/invoices/:id/payment
// @access  Private (accountant, admin)
export const recordPayment = async (req, res) => {
  try {
    const invoice = await invoiceService.recordPayment(
      req.params.id,
      req.body,
      req.user._id
    );
    
    // Emit immutable financial event
    await financialEventEmitter.emitInvoicePaid(invoice, req.body, req.user._id);

    // Financial integration hooks
    await financialIntegration.onInvoicePaid(invoice, req.body, req.user._id);

    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Record payment error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Cancel invoice
// @route   POST /api/v1/invoices/:id/cancel
// @access  Private (accountant, admin)
export const cancelInvoice = async (req, res) => {
  try {
    const { reason } = req.body;
    
    // Use default reason if not provided
    const cancellationReason = reason || 'Cancelled by user';
    
    const invoice = await invoiceService.cancelInvoice(
      req.params.id,
      cancellationReason,
      req.user._id
    );
    
    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    logger.error('Cancel invoice error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get invoice stats
// @route   GET /api/v1/invoices/stats
// @access  Private
export const getInvoiceStats = async (req, res) => {
  try {
    const stats = await invoiceService.getInvoiceStats(
      req.query.dateFrom,
      req.query.dateTo
    );
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get invoice stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Download invoice as PDF
// @route   GET /api/v1/invoices/:id/pdf
// @access  Private
export const downloadInvoicePDF = async (req, res) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }
    
    // Get company info (could be from settings service)
    const companyInfo = {
      name: process.env.COMPANY_NAME || 'ARTHA Finance',
      address: process.env.COMPANY_ADDRESS || '',
      gstin: process.env.COMPANY_GSTIN || '',
      phone: process.env.COMPANY_PHONE || '',
    };
    
    const pdfDoc = await pdfService.generateInvoicePDF(invoice, companyInfo);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`
    );
    
    pdfDoc.pipe(res);
    
    logger.info(`Invoice PDF downloaded: ${invoice.invoiceNumber}`);
  } catch (error) {
    logger.error('Download invoice PDF error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};