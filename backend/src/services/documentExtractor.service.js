import logger from '../config/logger.js';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import ocrService from './ocr.service.js';

/**
 * Universal document extraction.
 *
 * Capability flags are resolved lazily and cached so a missing optional
 * dependency degrades into an actionable message instead of a crash —
 * the same contract the reference implementation used.
 */
const capabilities = {
  loaded: false,
  pdfjs: null,
  tesseract: null,
  mammoth: null,
  canvas: null,
  xlsx: null,
  errors: {},
};

async function importOptional(name, flag) {
  try {
    const mod = await import(name);
    // tesseract.js ships as CJS; Node's interop only surfaces a subset of the
    // named exports, so the real API lives on `default`.
    return mod.default && typeof mod.default.recognize === 'function' ? mod.default : mod;
  } catch (err) {
    capabilities.errors[flag] = err.message;
    logger.warn(`DocumentExtractor: optional dependency "${name}" unavailable (${err.message})`);
    return null;
  }
}

async function loadCapabilities() {
  if (capabilities.loaded) return capabilities;

  capabilities.pdfjs = await importOptional('pdfjs-dist/legacy/build/pdf.mjs', 'PDF_SUPPORT');
  capabilities.tesseract = await importOptional('tesseract.js', 'OCR_SUPPORT');
  capabilities.mammoth = await importOptional('mammoth', 'DOCX_SUPPORT');
  capabilities.canvas = await importOptional('@napi-rs/canvas', 'PDF2IMAGE_SUPPORT');
  capabilities.xlsx = await importOptional('xlsx', 'XLSX_SUPPORT');
  capabilities.loaded = true;

  logger.info(
    `DocumentExtractor capabilities: pdf=${Boolean(capabilities.pdfjs)} ` +
      `ocr=${Boolean(capabilities.tesseract)} docx=${Boolean(capabilities.mammoth)} ` +
      `render=${Boolean(capabilities.canvas)} xlsx=${Boolean(capabilities.xlsx)}`
  );
  return capabilities;
}

/** Characters a PDF page must yield before we treat it as real text. */
const PAGE_TEXT_THRESHOLD = 10;

export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.txt',
  '.md',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
];

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'text/xml',
  'text/html',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Reject anything outside the allowlist with an actionable message.
 * Mirrors the reference project's per-type validation contract.
 * @param {{ originalname?: string, mimetype?: string, size?: number }} file
 * @throws {Error}
 */
export function validateUpload(file) {
  if (!file || !file.originalname) {
    throw new Error('File is required');
  }

  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Unsupported file type "${ext || '(none)'}". Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
    );
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new Error(`Content type not allowed: ${file.mimetype}`);
  }

  if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  if (ext === '.doc') {
    throw new Error('Old .doc format not supported. Please convert to .docx');
  }

  return ext;
}

class DocumentExtractorService {
  /**
   * Extract readable content from any supported file type.
   *
   * @param {string} filePath
   * @param {object} opts - { password?: string, dpi?: number, ocr?: boolean }
   * @returns {Promise<{
   *   text: string, pages: number, sections: string[], info: object,
   *   method: string, ocrFallback: boolean, ocrConfidence: number|null,
   *   error?: string, errorMessage?: string
   * }>}
   */
  async extract(filePath, opts = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    logger.info(`DocumentExtractor: ${filePath} (ext=${ext})`);

    switch (ext) {
      case '.pdf':
        return await this._extractPdf(filePath, opts);
      case '.docx':
        return await this._extractDocx(filePath);
      case '.doc':
        return this._unsupported('Old .doc format not supported. Please convert to .docx');
      case '.xls':
      case '.xlsx':
        return await this._extractSpreadsheet(filePath);
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.gif':
      case '.webp':
      case '.bmp':
      case '.tif':
      case '.tiff':
        return await this._extractImage(filePath);
      default:
        return await this._extractPlainText(filePath);
    }
  }

  _unsupported(message) {
    return {
      text: '',
      pages: 0,
      sections: [],
      info: {},
      method: 'unsupported',
      ocrFallback: false,
      ocrConfidence: null,
      error: 'unsupported_format',
      errorMessage: message,
    };
  }

  /* ── PDF (text first, OCR fallback for scanned pages) ──────────── */

  async _extractPdf(filePath, opts = {}) {
    const caps = await loadCapabilities();
    if (!caps.pdfjs) {
      return this._unsupported(
        'PDF support not available. Install: npm install pdfjs-dist'
      );
    }

    const buffer = await fsPromises.readFile(filePath);

    if (opts.password) {
      const passwordCheck = await ocrService.extractText(filePath, {
        password: opts.password,
      });
      if (passwordCheck.error === 'password_required') {
        return this._unsupported(
          'PDF is password-protected. Provide the password to extract data.'
        );
      }
    }

    let doc;
    try {
      const require = createRequire(import.meta.url);
      const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
      const workerPath = path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
      caps.pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

      const loadOpts = { data: new Uint8Array(buffer) };
      if (opts.password) loadOpts.password = opts.password;
      doc = await caps.pdfjs.getDocument(loadOpts).promise;
    } catch (err) {
      if (/password/i.test(err.message) || err.name === 'PasswordException') {
        return this._unsupported(
          'PDF is password-protected. Provide the password to extract data.'
        );
      }
      return this._unsupported(`PDF read failed: ${err.message}`);
    }

    const rawPages = [];
    let info = {};
    try {
      const meta = await doc.getMetadata();
      info = {
        title: meta.info?.Title || null,
        author: meta.info?.Author || null,
        creator: meta.info?.Creator || null,
      };
    } catch {
      /* metadata is optional */
    }

    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map(item => ('str' in item ? item.str : item.chars || ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        rawPages.push(pageText.length > PAGE_TEXT_THRESHOLD ? pageText : null);
        page.cleanup();
      } catch (err) {
        logger.warn(`PDF page ${i} text extraction failed: ${err.message}`);
        rawPages.push(null);
      }
    }

    const pages = doc.numPages;
    await doc.destroy();

    // Nothing usable → the PDF is scanned/image-based, so rasterise + OCR.
    const needsOcr = rawPages.some(p => p === null) && opts.ocr !== false;
    if (needsOcr) {
      const ocrResult = await this._ocrPdfPages(buffer, rawPages);
      if (ocrResult.supported) {
        return {
          text: this._joinPdfPages(ocrResult.pages),
          pages,
          sections: ocrResult.pages.filter(Boolean),
          info,
          method: 'pdfjs+ocr',
          ocrFallback: true,
          ocrConfidence: ocrResult.confidence,
        };
      }
      if (rawPages.every(p => p === null)) {
        return this._unsupported(
          'PDF appears to be scanned (image-based). OCR support required. ' +
            'Install: npm install tesseract.js @napi-rs/canvas'
        );
      }
    }

    const text = this._joinPdfPages(rawPages);
    return {
      text,
      pages,
      sections: rawPages.filter(Boolean),
      info,
      method: 'pdfjs',
      ocrFallback: false,
      ocrConfidence: null,
    };
  }

  /**
   * OCR the raster images embedded in each page of a scanned PDF.
   *
   * Deliberately avoids `page.render()`: pdfjs-dist v5 + @napi-rs/canvas
   * faults natively there. Extracting the page's own image XObjects gives the
   * same pixels without touching the renderer.
   *
   * Returns `{ supported: false }` when no renderer/OCR engine is installed.
   */
  async _ocrPdfPages(buffer, rawPages) {
    const caps = await loadCapabilities();
    if (!caps.pdfjs || !caps.canvas || !this._hasTesseract(caps.tesseract)) {
      logger.warn(
        'DocumentExtractor: scanned-PDF OCR unavailable ' +
          `(pdfjs=${Boolean(caps.pdfjs)}, canvas=${Boolean(caps.canvas)}, ` +
          `tesseract=${this._hasTesseract(caps.tesseract)})`
      );
      return { supported: false, pages: rawPages, confidence: null };
    }

    let doc;
    try {
      const require = createRequire(import.meta.url);
      const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
      const workerPath = path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs');
      caps.pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      doc = await caps.pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    } catch (err) {
      logger.warn(`DocumentExtractor: cannot reopen PDF for OCR: ${err.message}`);
      return { supported: false, pages: rawPages, confidence: null };
    }

    const { OPS } = caps.pdfjs;
    const IMAGE_OPS = new Set([
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
    ]);

    const ocrPages = [];
    const confidences = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const existing = rawPages[i - 1];
      if (existing !== null && existing !== undefined) {
        ocrPages.push(existing);
        continue;
      }

      try {
        const page = await doc.getPage(i);
        const ops = await page.getOperatorList();

        const imageIds = [];
        for (let j = 0; j < ops.fnArray.length; j++) {
          if (IMAGE_OPS.has(ops.fnArray[j])) {
            const id = ops.argsArray[j]?.[0];
            if (typeof id === 'string') imageIds.push(id);
          }
        }

        const pageTexts = [];
        for (const id of imageIds) {
          const imageData = await this._resolvePdfObject(page.objs, id);
          if (!imageData?.data || !imageData.width || !imageData.height) continue;

          const png = this._rgbaToPng(caps.canvas, imageData);
          if (!png) continue;

          const { data } = await caps.tesseract.recognize(png, 'eng', {
            langPath:
              process.env.TESSERACT_LANG_PATH ||
              'https://tessdata.projectnaptha.com/4.0.0',
          });
          const text = (data.text || '').replace(/\s+/g, ' ').trim();
          if (text.length > PAGE_TEXT_THRESHOLD) pageTexts.push(text);
          if (typeof data.confidence === 'number') confidences.push(data.confidence);
        }

        const joined = pageTexts.join(' ');
        ocrPages.push(joined.length > PAGE_TEXT_THRESHOLD ? joined : null);
        page.cleanup();
      } catch (err) {
        logger.warn(`PDF page ${i} OCR failed: ${err.message}`);
        ocrPages.push(null);
      }
    }

    await doc.destroy();

    const confidence = confidences.length
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : null;

    return { supported: true, pages: ocrPages, confidence };
  }

  _hasTesseract(tesseract) {
    return Boolean(tesseract) && typeof tesseract.recognize === 'function';
  }

  /** Resolve a pdfjs object via its callback API (sync value or async). */
  _resolvePdfObject(objs, id, timeoutMs = 20000) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        const immediate = objs.get(id, finish);
        if (immediate) finish(immediate);
      } catch (err) {
        finish(null);
      }
    });
  }

  /** Paint decoded RGBA pixels onto a canvas and export PNG bytes. */
  _rgbaToPng(canvasModule, imageData) {
    try {
      const { createCanvas } = canvasModule;
      const canvas = createCanvas(imageData.width, imageData.height);
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(imageData.width, imageData.height);
      img.data.set(imageData.data.subarray(0, img.data.length));
      ctx.putImageData(img, 0, 0);
      return canvas.toBuffer('image/png');
    } catch (err) {
      logger.warn(`Rasterising PDF image failed: ${err.message}`);
      return null;
    }
  }

  _joinPdfPages(pages) {
    return pages
      .map((text, i) => (text ? `[Page ${i + 1}]\n${text}` : null))
      .filter(Boolean)
      .join('\n\n');
  }

  /* ── Images (OCR) ──────────────────────────────────────────────── */

  async _extractImage(filePath) {
    const caps = await loadCapabilities();
    if (!this._hasTesseract(caps.tesseract)) {
      return this._unsupported('OCR support not available. Install: npm install tesseract.js');
    }

    try {
      const { data } = await caps.tesseract.recognize(filePath, 'eng', {
        langPath:
          process.env.TESSERACT_LANG_PATH ||
          'https://tessdata.projectnaptha.com/4.0.0',
      });
      const text = (data.text || '').trim();
      logger.info(`Image OCR: ${text.length} chars, confidence=${data.confidence}`);

      return {
        text,
        pages: 1,
        sections: text ? [text] : [],
        info: {},
        method: 'tesseract',
        ocrFallback: false,
        ocrConfidence: typeof data.confidence === 'number' ? data.confidence : null,
        ...(text
          ? {}
          : {
              error: 'no_text_found',
              errorMessage: 'No readable text found in image',
            }),
      };
    } catch (err) {
      logger.error(`Image OCR failed: ${err.message}`);
      return {
        text: '',
        pages: 1,
        sections: [],
        info: {},
        method: 'tesseract',
        ocrFallback: false,
        ocrConfidence: null,
        error: 'extraction_failed',
        errorMessage: `Error extracting text from image: ${err.message}`,
      };
    }
  }

  /* ── DOCX (sections split on headings + tables) ────────────────── */

  async _extractDocx(filePath) {
    const caps = await loadCapabilities();
    if (!caps.mammoth) {
      return this._unsupported('DOCX support not available. Install: npm install mammoth');
    }

    try {
      const htmlResult = await caps.mammoth.convertToHtml({ path: filePath });
      const sections = this._splitDocxSections(htmlResult.value);

      let text = sections.join('\n\n');
      if (!text.trim()) {
        const raw = await caps.mammoth.extractRawText({ path: filePath });
        text = raw.value;
      }

      logger.info(`DOCX extracted: ${sections.length} sections, ${text.length} chars`);
      return {
        text: text.trim(),
        pages: sections.length || 1,
        sections,
        info: {},
        method: 'mammoth',
        ocrFallback: false,
        ocrConfidence: null,
      };
    } catch (err) {
      logger.error(`DOCX extraction failed: ${err.message}`);
      return {
        text: '',
        pages: 0,
        sections: [],
        info: {},
        method: 'mammoth',
        ocrFallback: false,
        ocrConfidence: null,
        error: 'extraction_failed',
        errorMessage: `Error extracting text from DOCX: ${err.message}`,
      };
    }
  }

  /**
   * Port of the reference project's sectioning heuristic: a heading starts a
   * new section, and every table becomes its own section (cells joined by " | ").
   *
   * Blocks are collected with a nesting-aware tag scan so a table's inner
   * paragraphs cannot split the table itself apart.
   */
  _splitDocxSections(html) {
    if (!html) return [];

    const BLOCK_TAGS = /^(h[1-6]|p|table|ul|ol|blockquote)$/;
    const OPEN = /^<\s*([A-Za-z0-9]+)(\s[^>]*)?>$/;
    const CLOSE = /^<\s*\/\s*([A-Za-z0-9]+)/;

    const tokens = html.replace(/\r/g, '').match(/<[^>]+>|[^<]+/g) || [];
    const blocks = [];
    let i = 0;

    while (i < tokens.length) {
      const open = tokens[i].match(OPEN);
      if (!open || !BLOCK_TAGS.test(open[1])) {
        i++;
        continue;
      }

      const tag = open[1].toLowerCase();
      let depth = 1;
      let raw = tokens[i];
      i++;

      while (i < tokens.length && depth > 0) {
        const token = tokens[i];
        const nested = token.match(OPEN);
        const closing = token.match(CLOSE);
        if (nested && nested[1].toLowerCase() === tag) depth++;
        else if (closing && closing[1].toLowerCase() === tag) depth--;
        raw += token;
        i++;
      }

      blocks.push({ tag, raw });
    }

    const sections = [];
    let current = [];

    for (const { tag, raw } of blocks) {
      const content = this._htmlToText(raw);
      if (!content) continue;

      if (tag === 'table') {
        if (current.length) {
          sections.push(current.join('\n'));
          current = [];
        }
        const tableText = this._tableToText(raw);
        if (tableText) sections.push(tableText);
        continue;
      }

      if (/^h[1-6]$/.test(tag) && current.length) {
        sections.push(current.join('\n'));
        current = [content];
      } else {
        current.push(content);
      }
    }

    if (current.length) sections.push(current.join('\n'));

    return sections.filter(s => s.trim().length > 0);
  }

  /** Flatten a `<table>` into one line per row with " | " between cells. */
  _tableToText(tableHtml) {
    const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const lines = [];

    for (const row of rows) {
      const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
      const texts = cells.map(cell => this._htmlToText(cell)).filter(Boolean);
      if (texts.length) lines.push(texts.join(' | '));
    }

    if (lines.length) return lines.join('\n');
    return this._htmlToText(tableHtml);
  }

  _htmlToText(html) {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|h[1-6]|li|tr|blockquote|table)>/gi, '\n')
      .replace(/<t[dh][^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .split('\n')
      .map(line => line.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim())
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  /* ── Spreadsheets ──────────────────────────────────────────────── */

  async _extractSpreadsheet(filePath) {
    const caps = await loadCapabilities();
    if (!caps.xlsx) {
      return this._unsupported('Spreadsheet support not available. Install: npm install xlsx');
    }

    try {
      const buffer = await fsPromises.readFile(filePath);
      const workbook = caps.xlsx.read(buffer, { type: 'buffer' });
      const sections = [];
      const pageTexts = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = caps.xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false });
        if (!rows.length) continue;

        const body = rows
          .map(row => row.map(cell => (cell ?? '').toString().trim()).join(' | '))
          .filter(line => line.replace(/\|/g, '').trim().length > 0);

        if (!body.length) continue;

        sections.push(`[Sheet: ${sheetName}]\n${body.join('\n')}`);
        pageTexts.push(body.join('\n'));
      }

      const text = sections.join('\n\n');
      logger.info(
        `Spreadsheet extracted: ${workbook.SheetNames.length} sheet(s), ${text.length} chars`
      );

      return {
        text,
        pages: sections.length || 1,
        sections,
        info: { sheets: workbook.SheetNames },
        method: 'xlsx',
        ocrFallback: false,
        ocrConfidence: null,
        ...(text.trim()
          ? {}
          : { error: 'no_text_found', errorMessage: 'Spreadsheet contains no readable rows' }),
      };
    } catch (err) {
      logger.error(`Spreadsheet extraction failed: ${err.message}`);
      return {
        text: '',
        pages: 0,
        sections: [],
        info: {},
        method: 'xlsx',
        ocrFallback: false,
        ocrConfidence: null,
        error: 'extraction_failed',
        errorMessage: `Error extracting spreadsheet: ${err.message}`,
      };
    }
  }

  /* ── Plain text formats ────────────────────────────────────────── */

  async _extractPlainText(filePath) {
    try {
      const buffer = await fsPromises.readFile(filePath);
      const isBinary = buffer.length > 0 && buffer.includes(0);
      if (isBinary) {
        return this._unsupported('Binary file type is not supported as plain text');
      }

      const text = buffer.toString('utf8').trim();
      const lines = text ? text.split(/\r?\n/) : [];

      return {
        text,
        pages: 1,
        sections: text ? [text] : [],
        info: { lines: lines.length },
        method: 'utf8',
        ocrFallback: false,
        ocrConfidence: null,
        ...(text
          ? {}
          : { error: 'no_text_found', errorMessage: 'File is empty' }),
      };
    } catch (err) {
      return {
        text: '',
        pages: 0,
        sections: [],
        info: {},
        method: 'utf8',
        ocrFallback: false,
        ocrConfidence: null,
        error: 'extraction_failed',
        errorMessage: `Error reading file: ${err.message}`,
      };
    }
  }

  /** Human-readable summary of which file types this build supports. */
  async capabilities() {
    const caps = await loadCapabilities();
    return {
      extensions: ALLOWED_EXTENSIONS,
      mimeTypes: ALLOWED_MIME_TYPES,
      maxSizeBytes: MAX_FILE_SIZE,
      engines: {
        pdf: Boolean(caps.pdfjs),
        pdfOcrFallback: Boolean(caps.pdfjs && caps.canvas && caps.tesseract),
        imageOcr: Boolean(caps.tesseract),
        docx: Boolean(caps.mammoth),
        spreadsheet: Boolean(caps.xlsx),
        plainText: true,
      },
      missing: capabilities.errors,
    };
  }
}

export default new DocumentExtractorService();
