import ocrService from './ocr.service.js';
import documentExtractor from './documentExtractor.service.js';
import bankStatementService from './bankStatement.service.js';
import expenseService from './expense.service.js';
import invoiceService from './invoice.service.js';
import companySettingsService from './companySettings.service.js';
import logger from '../config/logger.js';
import path from 'path';

/** Extensions handled as generic documents (content extraction only). */
const DOC_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.log',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.doc',
  '.docx',
  '.tsv',
]);

class SmartUploadService {
  detectDocumentType(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = file.originalname.toLowerCase();
    const mime = file.mimetype;

    if (['.csv', '.xls', '.xlsx'].includes(ext)) return 'bank_statement';
    if (name.includes('statement') || name.includes('passbook') || name.includes('txn')) return 'bank_statement';
    if (name.includes('invoice') || name.includes('inv-') || name.includes('inv_')) return 'bill';
    if (name.includes('bill') || name.includes('receipt') || name.includes('expense')) return 'receipt';
    if (mime.startsWith('image/')) return 'receipt';
    if (mime === 'application/pdf') return 'auto_detect_pdf';
    // Generic documents: extract content only, never create an expense.
    if (DOC_EXTENSIONS.has(ext)) return 'document';
    if (mime && mime.startsWith('text/')) return 'document';
    return 'receipt';
  }

  async refinePdfType(filePath, password) {
    try {
      const extraction = await ocrService.extractText(filePath, { password });
      const text = (extraction.text || '').toLowerCase();

      if (text.length < 10) return 'bill';

      const keywords = [
        'account statement', 'bank statement', 'transaction history',
        'opening balance', 'closing balance', 'passbook',
        'account number', 'account no', 'statement of account',
        'debit', 'credit', 'running balance',
      ];
      const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
      return score >= 3 ? 'bank_statement' : 'bill';
    } catch (err) {
      logger.warn(`PDF type detection failed: ${err.message}`);
      return 'bill';
    }
  }

  async processUpload(file, userId, metadata = {}) {
    // A file literally named "invoice"/"inv …" is a hint, not a command —
    // decisive GSTIN evidence still wins inside _isSalesInvoice.
    if (this._isInvoiceFilename(file.originalname)) {
      metadata = { ...metadata, _invoiceNameHint: true };
    }

    let docType = metadata.documentType || this.detectDocumentType(file);
    if (docType === 'auto_detect_pdf') docType = await this.refinePdfType(file.path, metadata.password);

    logger.info(`Smart upload: type=${docType}, file=${file.originalname}`);

    const result = {
      documentType: docType,
      fileName: file.originalname,
      fileSize: file.size,
      actions: [],
      summary: {},
    };

    switch (docType) {
      case 'bank_statement':
        return await this._processBankStatement(file, userId, metadata, result);
      case 'document':
        return await this._processDocument(file, userId, metadata, result);
      case 'invoice':
        return await this._processInvoice(file, userId, metadata, result);
      default:
        return await this._processReceipt(file, userId, metadata, result);
    }
  }

  /**
   * Generic documents (DOCX, TXT, JSON, HTML, ...) — extract and return the
   * content without creating an expense, since they are not receipts.
   */
  async _processDocument(file, userId, metadata, result) {
    try {
      const extraction = await documentExtractor.extract(file.path, {
        password: metadata.password,
      });

      const text = extraction.text || '';
      result.documentType = 'document';
      result.category = path.extname(file.originalname).toLowerCase().replace('.', '');
      result.pageCount = extraction.pages || 0;
      result.sectionCount = extraction.sections?.length || 0;
      result.extractedContent = text || null;
      result.extractionMethod = extraction.method;
      result.ocrFallback = Boolean(extraction.ocrFallback);

      if (extraction.error === 'unsupported_format') {
        result.actions.push({ type: 'unsupported_format', message: extraction.errorMessage });
        result.summary = { status: 'failed', message: extraction.errorMessage };
        return result;
      }

      if (extraction.error === 'extraction_failed') {
        result.actions.push({
          type: 'extraction_error',
          message: extraction.errorMessage || 'Failed to read document',
        });
        result.summary = { status: 'failed', message: extraction.errorMessage };
        return result;
      }

      if (extraction.ocrFallback) {
        result.actions.push({
          type: 'ocr_fallback',
          message: `Scanned content OCR'd at confidence ${extraction.ocrConfidence ?? 'n/a'}%`,
        });
      }

      if (text.length > 0) {
        result.actions.push({
          type: 'extraction_completed',
          message: `Extracted ${text.length} chars across ${extraction.pages || 1} page(s) via ${extraction.method}`,
        });
      } else {
        result.actions.push({ type: 'no_text_found', message: 'No readable text found in document' });
      }

      result.summary = {
        documentType: 'document',
        fileName: file.originalname,
        category: result.category,
        pages: extraction.pages || 0,
        sections: extraction.sections?.length || 0,
        charCount: text.length,
        method: extraction.method,
        status: text.length > 0 ? 'extracted' : 'empty',
        message:
          text.length > 0
            ? 'Content extracted. Review the text below.'
            : 'No readable text found in this document.',
      };

      return result;
    } catch (err) {
      logger.error('Smart upload document error:', err);
      result.actions.push({ type: 'error', message: `Processing failed: ${err.message}` });
      result.summary = { status: 'failed', message: err.message };
      return result;
    }
  }

  async _processBankStatement(file, userId, metadata, result) {
    try {
      const statementData = {
        accountNumber: metadata.accountNumber || 'Auto-detected',
        bankName: metadata.bankName || 'Auto-detected',
        accountHolderName: metadata.accountHolderName || 'Auto-detected',
        startDate: metadata.startDate ? new Date(metadata.startDate) : new Date(),
        endDate: metadata.endDate ? new Date(metadata.endDate) : new Date(),
        openingBalance: metadata.openingBalance || '0',
        closingBalance: metadata.closingBalance || '0',
      };

      const statement = await bankStatementService.uploadBankStatement(statementData, userId, file);

      result.actions.push({
        type: 'bank_statement_created',
        message: `Bank statement ${statement.statementNumber} created & processing started`,
        id: statement._id,
        statementNumber: statement.statementNumber,
      });
      result.summary = {
        statementId: statement._id,
        statementNumber: statement.statementNumber,
        status: 'processing',
        message: 'Statement uploaded. Auto-reconciliation running in background.',
      };
      return result;
    } catch (err) {
      logger.error('Smart upload bank statement error:', err);
      result.actions.push({ type: 'error', message: `Bank statement failed: ${err.message}` });
      result.summary = { status: 'failed', message: err.message };
      return result;
    }
  }

  /**
   * Single extraction call that reads the REAL file content,
   * then parses structured fields from it.
   */
  /**
   * Single extraction call that reads the REAL file content and pushes the
   * extraction-status actions onto `result`. Shared by the expense and the
   * sales-invoice path.
   */
  async _extractDoc(file, metadata, result) {
    const ocrOpts = {};
    if (metadata.password) ocrOpts.password = metadata.password;

    const ocrResult = await ocrService.processReceiptFile(file.path, ocrOpts);
    const ocrData = ocrResult.success ? ocrResult.data : null;
    const rawText = ocrData?.rawText || '';

    if (ocrData?.pdfError === 'password_required') {
      result.actions.push({
        type: 'password_required',
        message: 'PDF is password-protected. Re-upload with the PDF password to extract data.',
      });
      result.pdfError = 'password_required';
    } else if (ocrData?.pdfError) {
      result.actions.push({
        type: 'extraction_error',
        message: ocrData.pdfErrorMessage || 'Failed to read PDF',
      });
    } else if (ocrResult.success && rawText.length > 0) {
      result.actions.push({
        type: 'extraction_completed',
        message: `Extracted ${rawText.length} chars — vendor: ${ocrData.vendor}, amount: ₹${ocrData.amount}, date: ${ocrData.date}`,
        confidence: ocrData.confidence,
      });
    } else if (ocrResult.success && rawText.length === 0) {
      result.actions.push({
        type: 'no_text_found',
        message: 'No readable text found — PDF may be a scanned image or password-protected',
      });
    } else {
      result.actions.push({
        type: 'extraction_failed',
        message: ocrResult.error
          ? `Extraction error: ${ocrResult.error}`
          : 'Could not extract text from file',
      });
    }

    if (ocrData?.pages > 0) {
      result.pdfInfo = {
        pages: ocrData.pages,
        title: ocrData.pdfInfo?.title || null,
        author: ocrData.pdfInfo?.author || null,
        creator: ocrData.pdfInfo?.creator || null,
      };
    }

    if (ocrData?.items?.length) {
      result.actions.push({
        type: 'line_items_found',
        message: `Found ${ocrData.items.length} line item(s) in document`,
      });
    }

    return { ocrData, rawText, ocrResult };
  }

  /** Filename heuristic: "invoice.pdf", "inv m2620.pdf", "inv-2024-05.pdf". */
  _isInvoiceFilename(name = '') {
    const n = String(name).toLowerCase();
    return n.includes('invoice') || /^(?:.*[\\/])?inv[\\s\-_.]/.test(n);
  }

  /**
   * Is this a sales invoice WE issued (supplier is our own company), or a
   * purchase bill/receipt from somebody else?
   *
   * Priority: explicit caller override → supplier GSTIN vs ours → company
   * name vs extracted vendor → "invoice" filename hint. With no evidence at
   * all, a document stays an expense (you receive bills far more often than
   * you re-issue your own invoices).
   */
  async _isSalesInvoice(ocrData, metadata) {
    if (metadata.documentType === 'invoice') return true;
    if (metadata.documentType === 'receipt' || metadata.documentType === 'bill') return false;

    try {
      const settings = await companySettingsService.getSettings();
      const ownGstin = String(settings?.gstin || '').trim().toUpperCase();
      const docGstin = String(ocrData?.gstin || '').trim().toUpperCase();
      // Decisive: both GSTINs known — equal means we issued it.
      if (ownGstin && docGstin) return ownGstin === docGstin;

      const ownName = String(settings?.companyName || settings?.name || '').trim().toLowerCase();
      const vendor = String(ocrData?.vendor || '').trim().toLowerCase();
      // "My Company" is the settings default — never use it as an identity.
      if (ownName.length >= 4 && ownName !== 'my company' && vendor.length >= 4) {
        return vendor.includes(ownName) || ownName.includes(vendor);
      }
    } catch (err) {
      logger.warn(`Sales-invoice detection failed: ${err.message}`);
    }

    return Boolean(metadata._invoiceNameHint);
  }

  async _processReceipt(file, userId, metadata, result) {
    try {
      const { ocrData, rawText, ocrResult } = await this._extractDoc(file, metadata, result);

      // Never record junk for files we could not actually read: a
      // password-protected PDF or an extraction failure used to create a
      // ₹0 "Unknown Vendor" expense behind the password prompt.
      if (ocrData?.pdfError) {
        result.summary = {
          status: 'failed',
          message: ocrData.pdfErrorMessage || 'Could not read this PDF',
        };
        return result;
      }
      const hasExplicitAmount = parseFloat(metadata.amount) > 0;
      if (!ocrResult?.success && !hasExplicitAmount) {
        result.summary = {
          status: 'failed',
          message: `Extraction failed: ${ocrResult?.error || 'could not read the file'} — nothing was recorded.`,
        };
        return result;
      }
      if (ocrResult?.success && !rawText && !hasExplicitAmount) {
        result.summary = {
          status: 'failed',
          message: 'No readable text in this file — nothing was recorded. Try a clearer scan, or add the record manually.',
        };
        return result;
      }

      // A tax invoice we issued ourselves (supplier = our company) is a
      // sales invoice — record it under Invoices, not Expenses.
      if (await this._isSalesInvoice(ocrData, metadata)) {
        return await this._createInvoiceFromOcr(file, userId, metadata, result, ocrData, rawText);
      }

      const expenseData = {
        vendor: ocrData?.vendor || metadata.vendor || 'Unknown Vendor',
        description: ocrData?.description?.substring(0, 200) || metadata.description || `Auto-uploaded: ${file.originalname}`,
        category: metadata.category || 'other',
        date: ocrData?.date || metadata.date || new Date().toISOString().split('T')[0],
        amount: ocrData?.amount || metadata.amount || '0',
        taxAmount: ocrData?.taxAmount || metadata.taxAmount || '0',
        totalAmount: ocrData?.totalAmount || ocrData?.amount || metadata.amount || '0',
        // GSTIN state code lets `recordExpense` split tax into CGST/SGST vs
        // IGST even when the invoice carries mixed slabs (no single gstRate).
        supplierState: ocrData?.supplierState || metadata.supplierState || undefined,
        paymentMethod: metadata.paymentMethod || 'other',
        notes: `Auto-created via Smart Upload from: ${file.originalname}`,
      };

      const expense = await expenseService.createExpense(expenseData, userId, [file]);

      result.actions.push({
        type: 'expense_created',
        message: `Expense ${expense.expenseNumber} created: ₹${expenseData.totalAmount} — ${expenseData.vendor}`,
        id: expense._id,
        expenseNumber: expense.expenseNumber,
      });

      result.extractedContent = rawText || null;

      result.summary = {
        expenseId: expense._id,
        expenseNumber: expense.expenseNumber,
        vendor: expenseData.vendor,
        description: expenseData.description,
        category: expenseData.category,
        amount: expenseData.totalAmount,
        date: expenseData.date,
        taxAmount: expenseData.taxAmount,
        paymentMethod: expenseData.paymentMethod,
        invoiceNumber: ocrData?.invoiceNumber || null,
        lineItems: ocrData?.items || [],
        status: 'created',
        ocrConfidence: ocrData?.confidence ?? null,
        message: 'Expense auto-created. Review data below and approve.',
      };

      return result;
    } catch (err) {
      logger.error('Smart upload receipt error:', err);
      result.actions.push({ type: 'error', message: `Processing failed: ${err.message}` });
      result.summary = { status: 'failed', message: err.message };
      return result;
    }
  }

  /**
   * Explicit "this file is a sales invoice" route (documentType=invoice from
   * the uploader UI or the API).
   */
  async _processInvoice(file, userId, metadata, result) {
    try {
      const { ocrData, rawText, ocrResult } = await this._extractDoc(file, metadata, result);

      if (ocrData?.pdfError) {
        result.summary = {
          status: 'failed',
          message: ocrData.pdfErrorMessage || 'Could not read this PDF',
        };
        return result;
      }
      const hasExplicitAmount = parseFloat(metadata.amount) > 0;
      if ((!ocrResult?.success || !rawText) && !hasExplicitAmount) {
        result.summary = {
          status: 'failed',
          message: !ocrResult?.success
            ? `Extraction failed: ${ocrResult?.error || 'could not read the file'} — no invoice was created.`
            : 'No readable text in this file — no invoice was created. Try a clearer scan.',
        };
        return result;
      }

      return await this._createInvoiceFromOcr(file, userId, metadata, result, ocrData, rawText);
    } catch (err) {
      logger.error('Smart upload invoice error:', err);
      result.actions.push({ type: 'error', message: `Processing failed: ${err.message}` });
      result.summary = { status: 'failed', message: err.message };
      return result;
    }
  }

  /** Build a draft Invoice from extracted OCR fields. */
  async _createInvoiceFromOcr(file, userId, metadata, result, ocrData, rawText) {
    const text = String(rawText || '');
    const gstinList =
      text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g) || [];
    const supplierGstin = String(ocrData?.gstin || gstinList[0] || '').toUpperCase();
    const buyerGstin = gstinList.find((g) => g !== supplierGstin) || null;

    const items = (Array.isArray(ocrData?.items) ? ocrData.items : [])
      .filter((it) => it && it.description && parseFloat(it.amount) > 0)
      .map((it) => {
        const amount = parseFloat(it.amount) || 0;
        const quantity = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
        const rate = Number(it.rate) > 0 ? Number(it.rate) : amount / quantity;
        const line = {
          description: String(it.description).substring(0, 200),
          quantity,
          unitPrice: rate.toFixed(2),
          amount: amount.toFixed(2),
        };
        if (Number.isFinite(it.taxRate) && it.taxRate >= 0 && it.taxRate <= 100) {
          line.taxRate = it.taxRate;
        }
        if (it.hsn) line.hsnCode = String(it.hsn);
        return line;
      });

    let taxAmount = parseFloat(ocrData?.taxAmount) || 0;
    let totalAmount = parseFloat(ocrData?.totalAmount) || 0;
    let subtotal = parseFloat(ocrData?.amount) || 0;

    if (!items.length) {
      const base =
        subtotal > 0 ? subtotal : totalAmount > 0 ? totalAmount : parseFloat(metadata.amount) || 0;
      const fallbackName = ocrData?.vendor && ocrData.vendor !== 'Unknown Vendor'
        ? `${ocrData.vendor} — `
        : '';
      items.push({
        description: String(
          metadata.description || `${fallbackName}${file.originalname}`
        ).substring(0, 200),
        quantity: 1,
        unitPrice: (base || 0).toFixed(2),
        amount: (base || 0).toFixed(2),
      });
      if (!subtotal) subtotal = base || 0;
    } else if (!subtotal) {
      subtotal = items.reduce((s, i) => s + parseFloat(i.amount), 0);
    }

    if (!(totalAmount > 0)) totalAmount = Math.max(subtotal + taxAmount, 0);
    if (!(taxAmount > 0) && totalAmount > subtotal) taxAmount = totalAmount - subtotal;

    let invoiceDate = ocrData?.date ? new Date(ocrData.date) : new Date();
    if (isNaN(invoiceDate.getTime())) invoiceDate = new Date();
    const dueDate = new Date(invoiceDate.getTime());
    dueDate.setDate(dueDate.getDate() + 30);

    const customerName = String(
      ocrData?.buyer || metadata.customerName || 'Customer'
    ).substring(0, 120);

    const invoiceData = {
      customerName,
      invoiceDate,
      dueDate,
      items,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      taxRate: Number(ocrData?.gstRate) || 0,
      status: 'draft',
      source: 'upload',
      notes: `Auto-created via Smart Upload from: ${file.originalname}`,
    };
    if (buyerGstin && /^\d{2}[A-Z]{5}\d{4}[1-9A-Z]Z[0-9A-Z]$/.test(buyerGstin)) {
      invoiceData.customerGSTIN = buyerGstin;
    }

    const invoice = await invoiceService.createInvoice(invoiceData, userId);

    result.documentType = 'invoice';
    result.actions.push({
      type: 'invoice_created',
      message: `Invoice ${invoice.invoiceNumber} created as draft: ₹${totalAmount.toFixed(2)} — ${customerName}`,
      id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
    });
    result.extractedContent = text || null;
    result.summary = {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      customerName,
      amount: totalAmount.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      date: invoiceDate.toISOString().split('T')[0],
      status: 'draft',
      lineItems: ocrData?.items || [],
      ocrConfidence: ocrData?.confidence ?? null,
      message: 'Sales invoice created as draft — review it under Invoices.',
    };
    return result;
  }

  async processBatchUpload(files, userId, metadata = {}) {
    const results = [];
    for (const file of files) {
      try {
        results.push(await this.processUpload(file, userId, metadata));
      } catch (err) {
        results.push({
          documentType: 'unknown',
          fileName: file.originalname,
          fileSize: file.size,
          actions: [{ type: 'error', message: err.message }],
          summary: { status: 'failed', message: err.message },
        });
      }
    }
    return {
      totalFiles: files.length,
      processed: results.filter(r => r.summary?.status !== 'failed').length,
      failed: results.filter(r => r.summary?.status === 'failed').length,
      results,
    };
  }
}

export default new SmartUploadService();
