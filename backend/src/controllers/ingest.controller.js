import ingestService from '../services/ingest.service.js';
import logger from '../config/logger.js';

/**
 * @desc    Ingest any supported file (PDF/image/DOCX/spreadsheet/text) and
 *          return its extracted content
 * @route   POST /api/v1/ingest
 * @access  Private
 */
export const ingestFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file',
      });
    }

    const metadata = {
      password: req.body.password,
      title: req.body.title,
      category: req.body.category,
      persistContent: req.body.persistContent !== 'false',
      ocr: req.body.ocr !== 'false',
    };
    if (req.body.tags) {
      metadata.tags = String(req.body.tags)
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    }

    const result = await ingestService.ingestFile(req.file, req.user._id, metadata);

    const failed = result.status === 'failed';
    res.status(failed ? 422 : 201).json({
      success: !failed,
      message: failed
        ? result.extraction.errorMessage || 'Could not extract content from file'
        : `Ingested ${result.fileName} — ${result.extraction.charCount} characters via ${result.extraction.method}`,
      data: result,
    });
  } catch (error) {
    logger.error('Ingest error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * @desc    List previously ingested documents
 * @route   GET /api/v1/ingest
 * @access  Private
 */
export const listDocuments = async (req, res) => {
  try {
    const data = await ingestService.listDocuments(req.query, req.user._id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Ingest list error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Fetch one ingested document including full extracted content
 * @route   GET /api/v1/ingest/:documentId
 * @access  Private
 */
export const getDocument = async (req, res) => {
  try {
    const data = await ingestService.getDocument(req.params.documentId, req.user._id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Delete an ingested document
 * @route   DELETE /api/v1/ingest/:documentId
 * @access  Private
 */
export const deleteDocument = async (req, res) => {
  try {
    const data = await ingestService.deleteDocument(req.params.documentId, req.user._id);
    res.status(200).json({ success: true, message: 'Document deleted', data });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Report which file types/engines this build can ingest
 * @route   GET /api/v1/ingest/capabilities
 * @access  Private
 */
export const getCapabilities = async (req, res) => {
  try {
    const data = await ingestService.getCapabilities();
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('Ingest capabilities error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
