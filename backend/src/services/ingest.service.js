import documentExtractor, {
  validateUpload,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
} from './documentExtractor.service.js';
import IngestDocument from '../models/IngestDocument.js';
import logger from '../config/logger.js';
import path from 'path';

/** Maps a file extension onto the coarse content category used for filtering. */
const CATEGORY_BY_EXT = {
  '.pdf': 'pdf',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.doc': 'document',
  '.docx': 'document',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.csv': 'spreadsheet',
  '.tsv': 'spreadsheet',
  '.txt': 'text',
  '.md': 'text',
  '.log': 'text',
  '.json': 'text',
  '.xml': 'text',
  '.html': 'text',
  '.htm': 'text',
};

class IngestService {
  /**
   * Accept any supported file, extract its content, and persist the result.
   *
   * @param {object} file - multer file (path, originalname, mimetype, size)
   * @param {string} userId
   * @param {object} metadata - { password?, title?, tags?, persistContent? }
   * @returns {Promise<object>} API response payload
   */
  async ingestFile(file, userId, metadata = {}) {
    const startedAt = Date.now();
    const ext = validateUpload(file);
    const category = CATEGORY_BY_EXT[ext] || 'text';

    logger.info(`Ingest: ${file.originalname} (${ext}, ${file.size} bytes)`);

    let extraction;
    try {
      extraction = await documentExtractor.extract(file.path, {
        password: metadata.password,
        ocr: metadata.ocr !== false,
      });
    } catch (err) {
      logger.error('Ingest extraction error:', err);
      extraction = {
        text: '',
        pages: 0,
        sections: [],
        info: {},
        method: 'unknown',
        ocrFallback: false,
        ocrConfidence: null,
        error: 'extraction_failed',
        errorMessage: err.message,
      };
    }

    const durationMs = Date.now() - startedAt;
    const hasText = Boolean(extraction.text && extraction.text.trim().length > 0);
    const status = extraction.error
      ? hasText
        ? 'partial'
        : 'failed'
      : hasText || extraction.sections.length
        ? 'completed'
        : 'partial';

    const persistContent = metadata.persistContent !== false;
    const content = persistContent ? extraction.text : '';

    let record = null;
    try {
      record = await IngestDocument.create({
        originalName: file.originalname,
        extension: ext,
        category,
        file: {
          filename: file.filename || path.basename(file.path),
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
        },
        uploadedBy: userId,
        status,
        extraction: {
          method: extraction.method,
          pages: extraction.pages || 0,
          sections: extraction.sections?.length || 0,
          charCount: extraction.text?.length || 0,
          ocrFallback: Boolean(extraction.ocrFallback),
          ocrConfidence: extraction.ocrConfidence ?? null,
          pdfInfo: extraction.info || {},
          error: extraction.error || null,
          errorMessage: extraction.errorMessage || null,
          durationMs,
        },
        content,
        sectionList: extraction.sections || [],
        metadata: {
          title: metadata.title || file.originalname,
          tags: metadata.tags || [],
          ...metadata,
          password: undefined,
        },
      });
    } catch (err) {
      logger.error('Ingest persist error:', err);
    }

    const data = {
      documentId: record?.documentId || null,
      documentType: category,
      category,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      extension: ext,
      status,
      extraction: {
        method: extraction.method,
        pages: extraction.pages || 0,
        sections: extraction.sections?.length || 0,
        charCount: extraction.text?.length || 0,
        ocrFallback: Boolean(extraction.ocrFallback),
        ocrConfidence: extraction.ocrConfidence ?? null,
        pdfInfo: extraction.info || {},
        durationMs,
        error: extraction.error || null,
        errorMessage: extraction.errorMessage || null,
      },
      content: extraction.text || '',
      sections: extraction.sections || [],
      actions: this._buildActions(extraction, status),
      summary: {
        documentId: record?.documentId || null,
        fileName: file.originalname,
        category,
        charCount: extraction.text?.length || 0,
        pages: extraction.pages || 0,
        method: extraction.method,
        status,
        message: extraction.errorMessage || `Extracted ${extraction.text?.length || 0} characters`,
      },
      supportedExtensions: ALLOWED_EXTENSIONS,
      maxFileSizeBytes: MAX_FILE_SIZE,
      processedAt: new Date().toISOString(),
    };

    return data;
  }

  _buildActions(extraction, status) {
    const actions = [];

    if (extraction.error === 'unsupported_format') {
      actions.push({ type: 'unsupported_format', message: extraction.errorMessage });
      return actions;
    }

    if (extraction.error === 'password_required') {
      actions.push({
        type: 'password_required',
        message: extraction.errorMessage || 'File is password-protected. Provide the password.',
      });
      return actions;
    }

    if (extraction.error === 'extraction_failed') {
      actions.push({
        type: 'extraction_failed',
        message: extraction.errorMessage || 'Could not extract text from file',
      });
      return actions;
    }

    if (extraction.ocrFallback) {
      actions.push({
        type: 'ocr_fallback',
        message: `Scanned pages rasterised and OCR'd at confidence ${
          extraction.ocrConfidence ?? 'n/a'
        }%`,
        confidence: extraction.ocrConfidence ?? null,
      });
    }

    if (extraction.text && extraction.text.trim().length > 0) {
      actions.push({
        type: 'extraction_completed',
        message: `Extracted ${extraction.text.length} chars across ${
          extraction.pages || 1
        } page(s) via ${extraction.method}`,
        charCount: extraction.text.length,
        method: extraction.method,
      });
    } else if (status !== 'failed') {
      actions.push({ type: 'no_text_found', message: 'No readable text found in file' });
    }

    return actions;
  }

  /**
   * @param {object} query - { page, limit, category, status, search }
   * @param {string} userId
   */
  async listDocuments(query = {}, userId) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));

    const filter = { uploadedBy: userId };
    if (query.category) filter.category = query.category;
    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.originalName = { $regex: String(query.search).trim(), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      IngestDocument.find(filter)
        .select(
          'documentId originalName extension category file status extraction createdAt updatedAt'
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      IngestDocument.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /** @param {string} documentId @param {string} userId */
  async getDocument(documentId, userId) {
    const doc = await IngestDocument.findOne({ documentId, uploadedBy: userId }).lean();
    if (!doc) {
      const err = new Error('Document not found');
      err.statusCode = 404;
      throw err;
    }
    return doc;
  }

  /** @param {string} documentId @param {string} userId */
  async deleteDocument(documentId, userId) {
    const doc = await IngestDocument.findOneAndDelete({ documentId, uploadedBy: userId });
    if (!doc) {
      const err = new Error('Document not found');
      err.statusCode = 404;
      throw err;
    }
    return { documentId: doc.documentId, deleted: true };
  }

  /** Capability probe so the UI can explain what it accepts. */
  async getCapabilities() {
    return documentExtractor.capabilities();
  }
}

export default new IngestService();
