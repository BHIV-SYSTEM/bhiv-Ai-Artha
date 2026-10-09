import logger from '../config/logger.js';
import invoiceParser from './invoiceParser.service.js';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

/** Extensions handled directly by the OCR service; all others delegate. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
]);

class OCRService {
  /**
   * @param {string} filePath
   * @param {object} opts - { password?: string }
   */
  async extractText(filePath, opts = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    logger.info(`OCR extractText: ${filePath} (ext=${ext})`);

    if (ext === '.pdf') return await this._extractFromPdf(filePath, opts.password);
    if (IMAGE_EXTENSIONS.has(ext)) return await this._extractFromImage(filePath);

    // DOCX / TXT / JSON / XML / spreadsheets / everything else: delegate to
    // the universal extractor. Dynamic import keeps the module graph acyclic.
    try {
      const { default: documentExtractor } = await import('./documentExtractor.service.js');
      const result = await documentExtractor.extract(filePath, opts);
      return {
        text: result.text || '',
        pages: result.pages || 0,
        info: result.info || {},
        ocrConfidence: result.ocrConfidence ?? null,
        ...(result.error ? { error: result.error, errorMessage: result.errorMessage } : {}),
      };
    } catch (err) {
      logger.warn(`Universal extraction failed for ${ext}: ${err.message}`);
      return { text: '', pages: 0, info: {}, error: 'extraction_failed', errorMessage: err.message };
    }
  }

  /**
   * Try pdf-parse v2 first, fall back to pdfjs-dist directly.
   */
  async _extractFromPdf(filePath, password) {
    const buffer = await fsPromises.readFile(filePath);

    // --- Attempt 1: pdf-parse v2 wrapper ---
    try {
      const { PDFParse } = await import('pdf-parse');
      const opts = { data: new Uint8Array(buffer) };
      if (password) opts.password = password;

      const parser = new PDFParse(opts);
      const textResult = await parser.getText();
      let info = {};
      try {
        const ir = await parser.getInfo();
        info = { title: ir.info?.Title, author: ir.info?.Author, creator: ir.info?.Creator };
      } catch {}
      await parser.destroy().catch(() => {});

      const text = textResult.text || '';
      logger.info(`pdf-parse v2 OK: ${textResult.total} pages, ${text.length} chars`);
      return { text, pages: textResult.total || 0, info };
    } catch (err1) {
      const pwErr = /password/i.test(err1.message) || err1.name === 'PasswordException';
      if (pwErr) {
        logger.warn('PDF password-protected');
        return { text: '', pages: 0, info: {}, error: 'password_required',
          errorMessage: 'PDF is password-protected. Provide the password to extract data.' };
      }
      logger.warn(`pdf-parse v2 failed (${err1.message}), trying pdfjs-dist directly...`);
    }

    // --- Attempt 2: pdfjs-dist directly with proper worker ---
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

      const require = createRequire(import.meta.url);
      const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
      const workerPath = path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

      const loadOpts = { data: new Uint8Array(buffer) };
      if (password) loadOpts.password = password;

      const doc = await pdfjs.getDocument(loadOpts).promise;
      let allText = '';

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        allText += pageText + '\n\n';
        page.cleanup();
      }

      let info = {};
      try {
        const meta = await doc.getMetadata();
        info = { title: meta.info?.Title, author: meta.info?.Author, creator: meta.info?.Creator };
      } catch {}

      const pages = doc.numPages;
      await doc.destroy();

      logger.info(`pdfjs-dist direct OK: ${pages} pages, ${allText.length} chars`);
      return { text: allText, pages, info };
    } catch (err2) {
      const pwErr2 = /password/i.test(err2.message) || err2.name === 'PasswordException';
      if (pwErr2) {
        return { text: '', pages: 0, info: {}, error: 'password_required',
          errorMessage: 'PDF is password-protected. Provide the password to extract data.' };
      }
      logger.error(`pdfjs-dist direct also failed: ${err2.message}`);
      return { text: '', pages: 0, info: {}, error: 'extraction_failed',
        errorMessage: `PDF read failed: ${err2.message}` };
    }
  }

  async _extractFromImage(filePath) {
    try {
      const mod = await import('tesseract.js');
      // tesseract.js is CJS; Node surfaces only some named exports, so the
      // callable API lives on `default`.
      const Tesseract = mod.default || mod;
      if (typeof Tesseract.recognize !== 'function') {
        throw new Error('tesseract.js API unavailable (recognize not exported)');
      }
      // Language data host is configurable: the default jsdelivr CDN is not
      // reachable from all networks, projectnaptha's tessdata mirror is.
      const { data: { text, confidence } } = await Tesseract.recognize(filePath, 'eng', {
        langPath: process.env.TESSERACT_LANG_PATH || 'https://tessdata.projectnaptha.com/4.0.0',
      });
      logger.info(`Tesseract OCR: ${text.length} chars, confidence=${confidence}`);
      return { text, pages: 1, info: {}, ocrConfidence: confidence };
    } catch (err) {
      logger.warn(`Tesseract unavailable (${err.message})`);
      return { text: '', pages: 1, info: {}, ocrConfidence: 0 };
    }
  }

  parseText(rawText) {
    const invoice = invoiceParser.parse(rawText);
    const vendor = this._extractVendor(rawText);
    const date = this._extractDate(rawText);
    const invoiceNumber = this._extractInvoiceNumber(rawText);
    const taxAmount = invoice.taxAmount !== null
      ? invoice.taxAmount.toFixed(2)
      : this._extractTax(rawText);
    const grossAmount = invoice.total !== null
      ? invoice.total.toFixed(2)
      : this._extractAmount(rawText);
    const gstRate = this._extractGstRate(rawText);
    const gstin = this._extractGSTIN(rawText);
    const supplierState = this._deriveSupplierState(gstin);
    const buyer = this._extractBuyer(rawText);

    // `amount` is the TAXABLE (pre-tax) value: the ledger treats amount as the
    // base and recomputes GST as amount * gstRate. If the receipt only shows a
    // grand total, subtract the tax so we never double-count it.
    const tax = parseFloat(taxAmount) || 0;
    const gross = parseFloat(grossAmount) || 0;
    const taxableBase = invoice.subtotal !== null
      ? invoice.subtotal
      : this._extractTaxableBase(rawText);
    let amount = gross;
    if (taxableBase !== null && taxableBase > 0) {
      amount = taxableBase;
    } else if (tax > 0 && gross > tax) {
      amount = gross - tax;
    }

    const fields = {
      vendor,
      amount: amount.toFixed(2),
      date,
      invoiceNumber,
      taxAmount,
    };

    return {
      vendor,
      date,
      amount: amount.toFixed(2),
      totalAmount: gross > 0 ? gross.toFixed(2) : amount.toFixed(2),
      taxAmount,
      gstAmount: taxAmount,
      gstRate,
      gstin,
      supplierState,
      buyer,
      invoiceNumber,
      items: invoice.items.length
        ? invoice.items.map((it) => ({
          description: it.description,
          hsn: it.hsn || '',
          quantity: it.quantity,
          unit: it.unit || '',
          rate: it.rate,
          amount: typeof it.amount === 'number' ? it.amount.toFixed(2) : it.amount,
          taxRate: it.taxRate ?? null,
          taxAmount: it.taxAmount ?? null,
        }))
        : this._extractLineItems(rawText),
      description: rawText.trim().substring(0, 300),
      confidence: this._calcConfidence(rawText, fields),
    };
  }

  async processReceiptFile(filePath, opts = {}) {
    try {
      logger.info(`Processing receipt: ${filePath}`);
      const extraction = await this.extractText(filePath, opts);

      if (extraction.error === 'password_required') {
        return {
          success: true,
          data: {
            vendor: 'Unknown', date: new Date().toISOString().split('T')[0],
            amount: '0.00', taxAmount: '0.00', invoiceNumber: '', items: [],
            description: extraction.errorMessage, rawText: '', confidence: 0,
            pages: 0, pdfInfo: {}, pdfError: 'password_required',
            pdfErrorMessage: extraction.errorMessage,
            processedAt: new Date().toISOString(),
          },
        };
      }

      if (extraction.error) {
        return {
          success: true,
          data: {
            vendor: 'Unknown', date: new Date().toISOString().split('T')[0],
            amount: '0.00', taxAmount: '0.00', invoiceNumber: '', items: [],
            description: extraction.errorMessage || 'Failed to read document',
            rawText: '', confidence: 0, pages: 0, pdfInfo: {},
            pdfError: extraction.error, pdfErrorMessage: extraction.errorMessage,
            processedAt: new Date().toISOString(),
          },
        };
      }

      const rawText = extraction.text;
      if (!rawText || rawText.trim().length < 5) {
        return {
          success: true,
          data: {
            vendor: 'Unknown', date: new Date().toISOString().split('T')[0],
            amount: '0.00', taxAmount: '0.00', invoiceNumber: '', items: [],
            description: '(No readable text — may be a scanned image PDF)',
            rawText: '', confidence: 0, pages: extraction.pages,
            pdfInfo: extraction.info, processedAt: new Date().toISOString(),
          },
        };
      }

      const parsed = this.parseText(rawText);
      return {
        success: true,
        data: {
          ...parsed, rawText, pages: extraction.pages, pdfInfo: extraction.info,
          ocrConfidence: extraction.ocrConfidence || null,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('processReceiptFile error:', error);
      return { success: false, error: error.message, data: null };
    }
  }

  /* ── Extraction helpers ────────────────────────────── */

  _extractVendor(text) {
    const patterns = [
      /(?:from|vendor|merchant|seller|billed by|company|issued by|shop|store)[\s:]+([^\n,;]+)/i,
      /(?:M\/s\.?|Messrs\.?)[\s:]+([^\n,;]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const v = m[1].trim();
        if (v.length >= 2 && v.length <= 100 && !/^\d+$/.test(v)) return v;
      }
    }
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length >= 3);
    for (const line of lines.slice(0, 5)) {
      if (line.length >= 3 && line.length <= 80 && /[A-Za-z]/.test(line) && !/^\d/.test(line)) return line;
    }
    return 'Unknown Vendor';
  }

  /** Buyer/customer block — "Bill To", "Consignee (Ship to)", "Sold To", ... */
  _extractBuyer(text) {
    const marker =
      /(?:bill\s*to|sold\s*to|ship\s*to|deliver\s*to|invoice\s*to|consignee|consigntee|buyer|customer(?:\s*name)?|party(?:\s*name)?)\s*(?:\(\s*ship\s*to\s*\))?\s*[:\-]*\s*([^\n]{3,80})/i;
    const m = String(text).match(marker);
    if (!m?.[1]) return '';
    let v = m[1]
      .split(/\s+(?:gstin|uhn|pan|state\s*code|address|place\s*of\s*supply)/i)[0]
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (
      v.length < 3 || v.length > 80 ||
      !/[A-Za-z]{3}/.test(v) ||
      /^\d+$/.test(v) ||
      /^\d{2}[A-Z]{5}/.test(v) ||
      /^(?:details|address|name)$/i.test(v)
    ) return '';
    return v;
  }

  _extractDate(text) {
    const patterns = [
      /(?:date|invoice date|bill date|dated|dt)[\s.:]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i,
      /(?:date|invoice date|bill date|dated|dt)[\s.:]*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i,
      /(?:date|invoice date|bill date|dated|dt)[\s.:]*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]*\d{2,4})/i,
      /(\d{4}[/-]\d{1,2}[/-]\d{1,2})/,
      /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/,
      /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]*\d{2,4})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const d = this._toDate(m[1]);
        if (d) return d;
      }
    }
    return this._formatLocalDate(new Date());
  }

  /**
   * Parse a date string to YYYY-MM-DD. Handles ISO, day-first/month-first
   * numeric (Indian receipts are day-first), and month-name formats —
   * `new Date('15/08/2024')` is Invalid Date in JS, so never rely on it.
   */
  _formatLocalDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  _toDate(value) {
    const s = String(value).trim();
    const valid = (y, m, d) => {
      const date = new Date(y, m - 1, d);
      if (isNaN(date.getTime())) return null;
      if (date.getFullYear() < 2000 || date.getFullYear() > 2100) return null;
      if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
      return this._formatLocalDate(date);
    };

    let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (m) return valid(+m[1], +m[2], +m[3]);

    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) {
      const a = +m[1];
      const b = +m[2];
      let year = +m[3];
      if (year < 100) year += 2000;
      let day;
      let month;
      if (a > 12) {
        day = a;
        month = b;
      } else if (b > 12) {
        day = b;
        month = a;
      } else {
        day = a; // ambiguous → day-first (Indian receipts)
        month = b;
      }
      return valid(year, month, day);
    }

    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
    if (m) {
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const month = months[m[2].toLowerCase().slice(0, 3)];
      let year = +m[3];
      if (year < 100) year += 2000;
      if (month) return valid(year, month, +m[1]);
    }
    return null;
  }

  _extractAmount(text) {
    const totalPatterns = [
      /(?:grand\s*total|net\s*total|total\s*amount|total\s*due|total\s*payable|amount\s*due|balance\s*due)[\s:]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d{0,2})/i,
      /(?:total)[\s:]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d{0,2})/i,
      /(?:amount|bill\s*amount|invoice\s*amount)[\s:]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d{0,2})/i,
    ];
    for (const p of totalPatterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return val.toFixed(2);
      }
    }
    const amounts = [];
    for (const m of text.matchAll(/(?:rs\.?|₹|inr)\s*([0-9,]+\.?\d{0,2})/gi)) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) amounts.push(val);
    }
    if (amounts.length) return Math.max(...amounts).toFixed(2);
    return '0.00';
  }

  _extractTax(text) {
    const lines = String(text).split('\n');
    const amountOn = (line) => {
      // last money-looking number that is not a percentage
      const matches = [...line.matchAll(/(?:rs\.?|₹|inr)?\s*([0-9,]+\.\d{2})(?!\s*%)/gi)];
      if (!matches.length) return null;
      const val = parseFloat(matches[matches.length - 1][1].replace(/,/g, ''));
      return Number.isFinite(val) && val > 0 ? val : null;
    };

    // Prefer explicit CGST/SGST/IGST component lines (never double-count
    // a "Total Tax" line alongside them)
    let componentSum = 0;
    let componentFound = false;
    for (const line of lines) {
      if (/taxable|tax\s*(?:rate|exclusive|inclusive)/i.test(line)) continue;
      if (/\b(cgst|sgst|igst)\b/i.test(line)) {
        const val = amountOn(line);
        if (val !== null) {
          componentSum += val;
          componentFound = true;
        }
      }
    }
    if (componentFound && componentSum > 0) return componentSum.toFixed(2);

    // Explicit tax total
    const totalMatch = text.match(/(?:tax\s*amount|gst\s*amount|total\s*tax|vat\s*amount)[\s:]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d{0,2})/i);
    if (totalMatch?.[1]) {
      const v = parseFloat(totalMatch[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0) return v.toFixed(2);
    }

    // Last resort: GST/VAT lines with a trailing amount
    let total = 0;
    for (const line of lines) {
      if (/taxable/i.test(line)) continue;
      if (/\b(gst|vat)\b/i.test(line)) {
        const val = amountOn(line);
        if (val !== null) total += val;
      }
    }
    return total.toFixed(2);
  }

  /** Pre-tax value printed on the receipt, if any ("Taxable Value", "Sub Total"). */
  _extractTaxableBase(text) {
    const patterns = [
      /(?:taxable\s*(?:value|amount)|net\s*amount|sub\s*total|subtotal|amount\s*before\s*tax)[\s:]*(?:rs\.?|₹|inr)?\s*([0-9,]+\.?\d{0,2})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return val;
      }
    }
    return null;
  }

  /** GST rate printed on the receipt, snapped to a statutory slab (0/5/12/18/28). */
  _extractGstRate(text) {
    const ALLOWED = [0, 5, 12, 18, 28];
    const candidates = [];
    const igst = text.match(/igst\s*(?:@|:|rate)?\s*([\d.]+)\s*%/i);
    if (igst) candidates.push(parseFloat(igst[1]));
    const cgst = text.match(/cgst\s*(?:@|:|rate)?\s*([\d.]+)\s*%/i);
    const sgst = text.match(/sgst\s*(?:@|:|rate)?\s*([\d.]+)\s*%/i);
    if (cgst && sgst) candidates.push(parseFloat(cgst[1]) + parseFloat(sgst[1]));
    for (const m of text.matchAll(/(?:gst|tax)\s*(?:rate)?\s*(?:@|:|=|\()?\s*([\d.]+)\s*%/gi)) {
      candidates.push(parseFloat(m[1]));
    }
    for (const m of text.matchAll(/@\s*([\d.]+)\s*%/g)) {
      candidates.push(parseFloat(m[1]));
    }
    for (const rate of candidates) {
      if (!Number.isFinite(rate)) continue;
      const match = ALLOWED.find(a => Math.abs(a - rate) <= 0.6);
      if (match !== undefined) return match;
    }
    return null;
  }

  _extractGSTIN(text) {
    const m = String(text).toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/);
    return m ? m[0] : null;
  }

  /** Map a GSTIN's 2-digit state code to the supplier-state enum the app uses. */
  _deriveSupplierState(gstin) {
    if (!gstin) return null;
    const CODE_TO_STATE = {
      '01': 'OTHER', '02': 'OTHER', '03': 'PUNJAB', '04': 'OTHER', '05': 'OTHER',
      '06': 'OTHER', '07': 'DELHI', '08': 'RAJASTHAN', '09': 'UTTAR_PRADESH',
      '10': 'BIHAR', '11': 'OTHER', '12': 'OTHER', '13': 'OTHER', '14': 'OTHER',
      '15': 'OTHER', '16': 'OTHER', '17': 'OTHER', '18': 'ASSAM', '19': 'WEST_BENGAL',
      '20': 'JHARKHAND', '21': 'ODISHA', '22': 'CHHATTISGARH', '23': 'MADHYA_PRADESH',
      '24': 'GUJARAT', '26': 'OTHER', '27': 'MAHARASHTRA', '29': 'KARNATAKA',
      '30': 'GOA', '31': 'OTHER', '32': 'KERALA', '33': 'TAMIL_NADU', '34': 'OTHER',
      '35': 'OTHER', '36': 'TELANGANA', '37': 'ANDHRA_PRADESH', '38': 'OTHER',
    };
    return CODE_TO_STATE[gstin.substring(0, 2)] || null;
  }

  _extractInvoiceNumber(text) {
    const patterns = [
      /(?:invoice\s*(?:no|number|#|num)\.?)[\s:]*([A-Z0-9][\w\-\/]{2,30})/i,
      /(?:bill\s*(?:no|number|#)\.?)[\s:]*([A-Z0-9][\w\-\/]{2,30})/i,
      /(?:receipt\s*(?:no|number|#)\.?)[\s:]*([A-Z0-9][\w\-\/]{2,30})/i,
      /(?:reference\s*(?:no|number|#)\.?)[\s:]*([A-Z0-9][\w\-\/]{2,30})/i,
      /(?:inv|INV)[\s\-:#]*([A-Z0-9][\w\-\/]{2,30})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return '';
  }

  _extractLineItems(text) {
    const items = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.length < 5) continue;
      const m = t.match(/^(.+?)\s+[₹$]?\s?([0-9,]+\.?\d{0,2})\s*$/);
      if (m) {
        const desc = m[1].trim();
        const amt = parseFloat(m[2].replace(/,/g, ''));
        if (desc.length >= 2 && !isNaN(amt) && amt > 0) {
          const l = desc.toLowerCase();
          if (!l.includes('total') && !l.includes('balance') && !l.includes('subtotal'))
            items.push({ description: desc, amount: amt.toFixed(2) });
        }
      }
    }
    return items.slice(0, 50);
  }

  _calcConfidence(rawText, f) {
    let s = 30;
    if (rawText.length > 50) s += 10;
    if (rawText.length > 200) s += 10;
    if (f.vendor !== 'Unknown Vendor') s += 15;
    if (f.amount !== '0.00') s += 15;
    if (f.date !== new Date().toISOString().split('T')[0]) s += 10;
    if (f.invoiceNumber) s += 10;
    if (f.taxAmount !== '0.00') s += 5;
    return Math.min(Math.max(s, 0), 100);
  }
}

export default new OCRService();
