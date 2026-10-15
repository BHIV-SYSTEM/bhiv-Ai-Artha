import fsPromises from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import logger from '../config/logger.js';
import ReceivableReport from '../models/ReceivableReport.js';
import { parseReceivables } from './receivablesParser.js';

/**
 * Receivables service — layout extraction (pdfjs / text files) + persistence.
 * The parsing itself is pure and lives in `receivablesParser.js`.
 */

/* ── layout extraction ──────────────────────────────────────────── */

/**
 * Extract layout rows — arrays of {x, s} clustered by y — from a PDF.
 * Falls back to line-based rows for plain-text/CSV files so the same parser
 * serves both.
 */
export async function extractLayoutRows(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const require = createRequire(import.meta.url);
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(pkgDir, 'legacy', 'build', 'pdf.worker.mjs')
    ).href;

    const buffer = await fsPromises.readFile(filePath);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const rows = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const items = tc.items.filter((it) => 'str' in it && it.str.trim().length);
        items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
        const lineRuns = [];
        for (const it of items) {
          const l = lineRuns[lineRuns.length - 1];
          if (l && Math.abs(l.y - it.transform[5]) <= 2.5) l.c.push(it);
          else lineRuns.push({ y: it.transform[5], c: [it] });
        }
        for (const r of lineRuns) {
          rows.push(
            r.c
              .sort((a, b) => a.transform[4] - b.transform[4])
              .map((c) => ({ x: Math.round(c.transform[4]), s: c.str }))
          );
        }
        page.cleanup();
      }
    } finally {
      await doc.destroy();
    }
    return rows;
  }

  // Text-ish files: split into lines; columns split on 2+ spaces or tabs.
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length)
    .map((line) => {
      const parts = line.split(/\t| {2,}/).map((s) => s.trim()).filter(Boolean);
      return parts.map((s, i) => ({ x: i * 100, s }));
    });
}

/* ── service ────────────────────────────────────────────────────── */

class ReceivablesService {
  /**
   * Parse a file (PDF/text) into a receivables report and persist it.
   * Returns the saved report document, or null when the file does not
   * contain a recognizable receivables table.
   *
   * @param {string} filePath
   * @param {object} meta - { fileName, uploadedBy, source }
   */
  async ingestFile(filePath, meta = {}) {
    const rows = await extractLayoutRows(filePath);
    const parsed = parseReceivables(rows);
    if (!parsed) return null;

    const report = await ReceivableReport.create({
      fileName: meta.fileName || path.basename(filePath),
      uploadedBy: meta.uploadedBy || null,
      source: meta.source || 'smart-upload',
      title: parsed.title,
      group: parsed.group || '',
      asOfDate: parsed.asOfDate,
      declared: parsed.declared,
      summary: {
        customerCount: parsed.customers.length,
        billCount: parsed.integrity.billCount,
        totalAmount: parsed.integrity.computedTotal,
        aging: parsed.aging,
      },
      integrity: parsed.integrity,
      customers: parsed.customers.map((c) => ({
        name: c.name,
        group: c.group || '',
        statedTotal: c.statedTotal,
        computedTotal: Math.round(c.computedTotal * 100) / 100,
        aging: Object.fromEntries(
          Object.entries(c.aging).map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
        bills: c.bills.map((b) => ({
          date: b.date,
          ref: b.ref,
          amount: b.amount,
          dueDate: b.dueDate,
          daysOverdue: b.daysOverdue,
          bucket: b.bucket,
        })),
      })),
    });

    logger.info(
      `Receivables report ${report.reportId}: ${report.summary.customerCount} customers, ` +
        `${report.summary.billCount} bills, ₹${report.summary.totalAmount} ` +
        `(integrity: customers=${report.integrity.customersMatch}, total=${report.integrity.totalMatches})`
    );
    return report;
  }

  /** Latest reports (summaries only). */
  async listReports({ limit = 20, page = 1 } = {}) {
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const [items, total] = await Promise.all([
      ReceivableReport.find()
        .select(
          'reportId fileName title group asOfDate declared summary integrity createdAt uploadedBy'
        )
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim)
        .lean(),
      ReceivableReport.countDocuments(),
    ]);
    return { items, pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) || 1 } };
  }

  /** Full report including customers + bills. */
  async getReport(reportId) {
    const doc = await ReceivableReport.findOne({ reportId }).lean();
    if (!doc) {
      const err = new Error('Receivable report not found');
      err.statusCode = 404;
      throw err;
    }
    return doc;
  }

  async getLatestReport() {
    return ReceivableReport.findOne().sort({ createdAt: -1 }).lean();
  }
}

export default new ReceivablesService();
