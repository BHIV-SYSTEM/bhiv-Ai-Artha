import { parse } from 'csv-parse/sync';
import { randomUUID } from 'crypto';
import BankStatement from '../models/BankStatement.js';
import Expense from '../models/Expense.js';
import Invoice from '../models/Invoice.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import ledgerService from './ledger.service.js';
import cacheService from './cache.service.js';
import ocrService from './ocr.service.js';
import notificationEvent from './notificationEvent.service.js';
import logger from '../config/logger.js';
import fs from 'fs/promises';

class BankStatementService {
  /**
   * Upload and parse bank statement — triggers full auto-processing pipeline
   */
  async uploadBankStatement(statementData, userId, file) {
    try {
      const data = { ...statementData };
      const blank = (v) =>
        v === undefined || v === null || v === '' ||
        (v instanceof Date && Number.isNaN(v.getTime()));

      // Optional form fields: derive whatever the user left empty straight
      // from the statement file so the model's required fields always hold.
      const needsMeta = ['accountHolderName', 'startDate', 'endDate', 'openingBalance', 'closingBalance']
        .some((k) => blank(data[k]));
      if (needsMeta) {
        let meta = null;
        try {
          meta = await this.extractDetailsFromFile(file);
        } catch (err) {
          logger.warn(`Statement metadata fallback skipped (${err.message})`);
        }
        if (blank(data.accountHolderName)) data.accountHolderName = meta?.accountHolderName || 'Not specified';
        if (blank(data.openingBalance)) data.openingBalance = meta?.openingBalance || '0';
        if (blank(data.closingBalance)) data.closingBalance = meta?.closingBalance || '0';
        if (blank(data.startDate)) data.startDate = meta?.startDate || null;
        if (blank(data.endDate)) data.endDate = meta?.endDate || null;
        if (blank(data.startDate) || blank(data.endDate)) {
          const today = new Date().toISOString().slice(0, 10);
          if (blank(data.startDate)) data.startDate = today;
          if (blank(data.endDate)) data.endDate = today;
        }
      }

      const statement = new BankStatement({
        ...data,
        file: {
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
        },
        uploadedBy: userId,
        status: 'processing',
      });

      await statement.save();
      logger.info(`Bank statement uploaded: ${statement.statementNumber}`);

      this.processStatementFile(statement._id, userId).catch(err => {
        logger.error('Background statement processing error:', err);
      });

      return statement;
    } catch (error) {
      logger.error('Upload bank statement error:', error);
      throw error;
    }
  }

  /**
   * Full processing pipeline: parse → match expenses → match invoices → create expenses → post ledger
   */
  async processStatementFile(statementId, userId) {
    try {
      const statement = await BankStatement.findById(statementId);

      if (!statement) {
        throw new Error('Bank statement not found');
      }

      statement.status = 'processing';
      await statement.save();

      let transactions = [];
      const fileExtension = statement.file.mimetype.split('/').pop().toLowerCase();

      if (fileExtension === 'csv' || statement.file.path.endsWith('.csv')) {
        transactions = await this.parseCSV(statement.file.path);
      } else if (
        fileExtension.includes('excel') ||
        fileExtension.includes('spreadsheet') ||
        statement.file.path.endsWith('.xlsx') ||
        statement.file.path.endsWith('.xls')
      ) {
        transactions = await this.parseExcel(statement.file.path);
      } else if (fileExtension === 'pdf' || statement.file.path.endsWith('.pdf')) {
        transactions = await this.parsePDF(statement.file.path);
      } else {
        throw new Error('Unsupported file format. Please upload CSV, Excel, or PDF.');
      }

      const totalDebits = transactions
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.debit), 0);

      const totalCredits = transactions
        .filter(t => t.type === 'credit')
        .reduce((sum, t) => sum + parseFloat(t.credit), 0);

      statement.transactions = transactions;
      statement.totalDebits = totalDebits.toFixed(2);
      statement.totalCredits = totalCredits.toFixed(2);
      statement.transactionCount = transactions.length;
      statement.status = 'completed';
      statement.processedAt = new Date();

      await statement.save();

      logger.info(`Bank statement parsed: ${statement.statementNumber} (${transactions.length} transactions)`);

      // --- AUTO-RECONCILIATION PIPELINE ---
      const reconciliation = await this.autoReconcile(statement._id, userId || statement.uploadedBy);

      logger.info(`Bank statement fully processed: ${statement.statementNumber}`, reconciliation);

      return await BankStatement.findById(statementId);
    } catch (error) {
      const statement = await BankStatement.findById(statementId);
      if (statement) {
        statement.status = 'failed';
        statement.processingError = error.message;
        await statement.save();
      }

      logger.error('Process statement error:', error);
      throw error;
    }
  }

  /**
   * Auto-reconciliation: match existing expenses, match invoices to credits,
   * auto-create expenses from unmatched debits, and post journal entries.
   */
  async autoReconcile(statementId, userId) {
    const statement = await BankStatement.findById(statementId);
    if (!statement || statement.status !== 'completed') {
      throw new Error('Statement must be completed before reconciliation');
    }

    let matchedExpenses = 0;
    let matchedInvoices = 0;
    let autoCreatedExpenses = 0;
    let journalEntriesCreated = 0;

    // 1. Match debit transactions to existing expenses
    for (const transaction of statement.transactions) {
      if (transaction.type === 'debit' && !transaction.matched) {
        const expense = await Expense.findOne({
          date: {
            $gte: new Date(new Date(transaction.date).setDate(new Date(transaction.date).getDate() - 3)),
            $lte: new Date(new Date(transaction.date).setDate(new Date(transaction.date).getDate() + 3)),
          },
          totalAmount: transaction.debit,
          status: { $in: ['approved', 'recorded', 'pending'] },
        });

        if (expense) {
          transaction.matched = true;
          transaction.matchedExpenseId = expense._id;
          matchedExpenses++;
        }
      }
    }

    // 2. Match credit transactions to outstanding invoices
    for (const transaction of statement.transactions) {
      if (transaction.type === 'credit' && !transaction.matched) {
        const invoice = await Invoice.findOne({
          status: { $in: ['sent', 'partial', 'overdue'] },
          $expr: {
            $lte: [
              { $abs: { $subtract: [{ $toDouble: '$totalAmount' }, { $toDouble: transaction.credit }] } },
              0.01,
            ],
          },
          invoiceDate: {
            $lte: new Date(new Date(transaction.date).setDate(new Date(transaction.date).getDate() + 30)),
          },
        });

        if (invoice) {
          transaction.matched = true;
          transaction.matchedInvoiceId = invoice._id;
          matchedInvoices++;

          try {
            await this._autoRecordInvoicePayment(invoice, transaction, userId);
            journalEntriesCreated++;
          } catch (err) {
            logger.warn(`Auto invoice payment failed for ${invoice.invoiceNumber}: ${err.message}`);
          }
        }
      }
    }

    // 3. Auto-create expenses from unmatched debit transactions
    for (const transaction of statement.transactions) {
      if (transaction.type === 'debit' && !transaction.matched) {
        try {
          const expense = new Expense({
            date: transaction.date,
            vendor: transaction.payee || transaction.description.split(/[,-]/)[0].trim(),
            description: transaction.description,
            category: this._mapCategoryToExpenseCategory(transaction.category, transaction.description),
            amount: transaction.debit,
            taxAmount: '0',
            totalAmount: transaction.debit,
            paymentMethod: 'bank_transfer',
            status: 'pending',
            submittedBy: userId,
            notes: `Auto-created from bank statement: ${statement.statementNumber}`,
          });

          await expense.save();

          transaction.matched = true;
          transaction.matchedExpenseId = expense._id;
          transaction.autoCreated = true;
          autoCreatedExpenses++;
        } catch (err) {
          logger.warn(`Auto expense creation failed for transaction: ${err.message}`);
        }
      }
    }

    // 4. Auto-create journal entries for bank-recorded transactions (fee, interest, etc.)
    for (const transaction of statement.transactions) {
      if (transaction.matched && !transaction.journalEntryId) {
        try {
          const journalEntry = await this._autoCreateJournalEntry(transaction, statement, userId);
          if (journalEntry) {
            transaction.journalEntryId = journalEntry._id;
            journalEntriesCreated++;
          }
        } catch (err) {
          logger.warn(`Auto journal entry failed: ${err.message}`);
        }
      }
    }

    statement.reconciliation = {
      matchedExpenses,
      matchedInvoices,
      autoCreatedExpenses,
      journalEntriesCreated,
      reconciledAt: new Date(),
    };

    await statement.save();

    const unmatchedCount = statement.transactions.filter((t) => !t.matched).length;
    if (unmatchedCount > 0) {
      notificationEvent.reconciliationException({
        statementNumber: statement.statementNumber || String(statement._id),
        unmatched: unmatchedCount,
        matched: statement.transactions.length - unmatchedCount,
      }).catch(() => {});
    }

    try {
      await cacheService.invalidateExpenseCaches();
      await cacheService.invalidateInvoiceCaches();
      await cacheService.invalidateLedgerCaches();
    } catch (err) {
      logger.warn('Cache invalidation failed:', err.message);
    }

    return statement.reconciliation;
  }

  /**
   * Auto-record a payment on an invoice from a bank credit transaction
   */
  async _autoRecordInvoicePayment(invoice, transaction, userId) {
    let cashAccount = await ChartOfAccounts.findOne({ code: '1010' });
    let arAccount = await ChartOfAccounts.findOne({ code: '1100' });

    if (!cashAccount) {
      cashAccount = (await ChartOfAccounts.create([{ code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' }]))[0];
    }
    if (!arAccount) {
      arAccount = (await ChartOfAccounts.create([{ code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' }]))[0];
    }

    const { default: Decimal } = await import('decimal.js');
    const paymentAmount = new Decimal(transaction.credit || 0);
    const amountDue = new Decimal(invoice.totalAmount || 0).minus(new Decimal(invoice.amountPaid || 0));

    if (paymentAmount.greaterThan(amountDue)) {
      throw new Error('Auto-payment exceeds outstanding amount');
    }

    const journalEntry = await ledgerService.createJournalEntry(
      {
        date: transaction.date,
        description: `Auto-payment received for invoice ${invoice.invoiceNumber} (bank statement)`,
        lines: [
          {
            account: cashAccount._id,
            debit: paymentAmount,
            credit: '0',
            description: `Bank deposit - ${transaction.description}`,
          },
          {
            account: arAccount._id,
            debit: '0',
            credit: paymentAmount,
            description: `Reduce AR for ${invoice.customerName}`,
          },
        ],
        reference: `${invoice.invoiceNumber}-AUTO`,
        tags: ['invoice-payment', 'auto-reconciled', invoice.invoiceNumber],
        source: 'SYSTEM',
        trace_id: randomUUID(),
        auditAction: 'AUTO_PAYMENT_RECORDED',
      },
      userId
    );

    // No silent posting: auto-created journals stay in draft until an
    // authorized accountant validates and posts them via the ledger workflow.

    invoice.payments.push({
      amount: paymentAmount.toString(),
      paymentDate: transaction.date,
      paymentMethod: 'bank_transfer',
      reference: transaction.reference || `Auto-matched from bank statement`,
      journalEntryId: journalEntry._id,
      notes: `Auto-reconciled from bank statement`,
    });

    const currentPaid = new Decimal(invoice.amountPaid || 0);
    invoice.amountPaid = currentPaid.plus(paymentAmount).toString();

    await invoice.save();
    return journalEntry;
  }

  /**
   * Auto-create a journal entry for a bank transaction (fees, interest, etc.)
   */
  async _autoCreateJournalEntry(transaction, statement, userId) {
    if (transaction.matchedExpenseId) {
      const expense = await Expense.findById(transaction.matchedExpenseId);
      if (expense && expense.status === 'recorded' && expense.journalEntryId) {
        return null;
      }
    }
    if (transaction.matchedInvoiceId) {
      return null;
    }

    const bankAccount = await ChartOfAccounts.findOne({ code: '1010' });
    if (!bankAccount) return null;

    let offsetAccount;
    const desc = transaction.description.toLowerCase();

    if (transaction.type === 'debit') {
      if (desc.includes('fee') || desc.includes('charge') || desc.includes('commission')) {
        offsetAccount = await ChartOfAccounts.findOne({ code: '6900' });
      } else if (desc.includes('interest')) {
        offsetAccount = await ChartOfAccounts.findOne({ code: '6200' });
      }
    } else if (transaction.type === 'credit') {
      if (desc.includes('interest')) {
        offsetAccount = await ChartOfAccounts.findOne({ code: '4000' });
      } else if (desc.includes('refund')) {
        offsetAccount = await ChartOfAccounts.findOne({ code: '4000' });
      }
    }

    if (!offsetAccount) return null;

    const amount = transaction.type === 'debit' ? transaction.debit : transaction.credit;

    const lines = transaction.type === 'debit'
      ? [
          { account: offsetAccount._id, debit: amount, credit: '0', description: transaction.description },
          { account: bankAccount._id, debit: '0', credit: amount, description: 'Bank payment' },
        ]
      : [
          { account: bankAccount._id, debit: amount, credit: '0', description: 'Bank receipt' },
          { account: offsetAccount._id, debit: '0', credit: amount, description: transaction.description },
        ];

    try {
      const journalEntry = await ledgerService.createJournalEntry(
        {
          date: transaction.date,
          description: `Auto: ${transaction.description} (${statement.statementNumber})`,
          lines,
          reference: transaction.reference || statement.statementNumber,
          tags: ['bank-statement', 'auto-reconciled'],
          source: 'SYSTEM',
          trace_id: randomUUID(),
          auditAction: 'BANK_TRANSACTION_RECORDED',
        },
        userId
      );

      // No silent posting: keep as draft for accountant review (A4).
      return journalEntry;
    } catch (err) {
      logger.warn(`Journal entry creation skipped: ${err.message}`);
      return null;
    }
  }

  /**
   * Map bank transaction category to expense category
   */
  _mapCategoryToExpenseCategory(bankCategory, description) {
    const desc = (description || '').toLowerCase();

    if (desc.includes('rent') || desc.includes('lease')) return 'rent';
    if (desc.includes('electric') || desc.includes('water') || desc.includes('gas') || desc.includes('utility')) return 'utilities';
    if (desc.includes('insurance')) return 'insurance';
    if (desc.includes('travel') || desc.includes('flight') || desc.includes('hotel') || desc.includes('cab') || desc.includes('uber') || desc.includes('ola')) return 'travel';
    if (desc.includes('food') || desc.includes('restaurant') || desc.includes('meal') || desc.includes('swiggy') || desc.includes('zomato')) return 'meals';
    if (desc.includes('software') || desc.includes('subscription') || desc.includes('aws') || desc.includes('azure') || desc.includes('google cloud')) return 'software';
    if (desc.includes('marketing') || desc.includes('advertising') || desc.includes('ad ') || desc.includes('google ads') || desc.includes('facebook')) return 'marketing';
    if (desc.includes('office') || desc.includes('stationery') || desc.includes('supplies')) return 'supplies';
    if (desc.includes('salary') || desc.includes('payroll')) return 'professional_services';
    if (desc.includes('equipment') || desc.includes('furniture') || desc.includes('hardware')) return 'equipment';

    const categoryMap = {
      fee: 'other',
      payment: 'other',
      withdrawal: 'other',
      transfer: 'other',
    };
    return categoryMap[bankCategory] || 'other';
  }

  // ===== DETAIL EXTRACTION (PRE-SAVE PREVIEW) =====

  /**
   * Best-effort extraction of statement metadata (account, bank, dates,
   * balances) from an uploaded file so the upload form can pre-fill itself.
   * Does NOT persist anything.
   */
  async extractDetailsFromFile(file) {
    const text = await this._readRawText(file);
    const transactions = await this._parseTransactionsTolerant(file);
    return this._extractMetadataFromText(text, transactions);
  }

  async _readRawText(file) {
    const p = (file.path || '').toLowerCase();
    try {
      if (p.endsWith('.csv')) {
        return await fs.readFile(file.path, 'utf-8');
      }
      if (p.endsWith('.xlsx') || p.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const buf = await fs.readFile(file.path);
        const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      }
      if (p.endsWith('.pdf')) {
        const extraction = await ocrService.extractText(file.path);
        return extraction.text || '';
      }
    } catch (error) {
      logger.warn(`Statement metadata: raw text read skipped (${error.message})`);
    }
    return '';
  }

  async _parseTransactionsTolerant(file) {
    try {
      const p = (file.path || '').toLowerCase();
      if (p.endsWith('.csv')) return await this.parseCSV(file.path);
      if (p.endsWith('.xlsx') || p.endsWith('.xls')) return await this.parseExcel(file.path);
      if (p.endsWith('.pdf')) return await this.parsePDF(file.path);
    } catch (error) {
      logger.warn(`Statement metadata: transaction parse skipped (${error.message})`);
    }
    return [];
  }

  /** Format a Date as YYYY-MM-DD in LOCAL time (toISOString shifts by TZ). */
  _formatLocalDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  _extractMetadataFromText(text, transactions = []) {
    const raw = String(text || '');
    const detected = [];
    const result = {
      bankName: null,
      accountNumber: null,
      accountHolderName: null,
      startDate: null,
      endDate: null,
      openingBalance: null,
      closingBalance: null,
      transactionCount: transactions.length,
      detectedFields: detected,
    };

    // --- Bank name ---
    const banks = [
      ['HDFC Bank', /hdfc\s*bank/i],
      ['ICICI Bank', /icici\s*bank/i],
      ['State Bank of India', /state\s*bank\s*of\s*india|\bsbi\b/i],
      ['Axis Bank', /axis\s*bank/i],
      ['Kotak Mahindra Bank', /kotak/i],
      ['Punjab National Bank', /punjab\s*national\s*bank|\bpnb\b/i],
      ['Bank of Baroda', /bank\s*of\s*baroda/i],
      ['Canara Bank', /canara\s*bank/i],
      ['IDFC First Bank', /idfc\s*first/i],
      ['Yes Bank', /yes\s*bank/i],
      ['IndusInd Bank', /indusind/i],
      ['Union Bank of India', /union\s*bank/i],
      ['Indian Bank', /indian\s*bank/i],
      ['Federal Bank', /federal\s*bank/i],
      ['Central Bank of India', /central\s*bank\s*of\s*india/i],
      ['IDBI Bank', /\bidbi\b/i],
    ];
    for (const [name, re] of banks) {
      if (re.test(raw)) { result.bankName = name; detected.push('bankName'); break; }
    }
    if (!result.bankName) {
      const m = raw.match(/bank\s*name\s*[:-]\s*([^\n,;|]+)/i);
      if (m?.[1] && m[1].trim().length >= 3) {
        result.bankName = m[1].trim();
        detected.push('bankName');
      }
    }

    // --- Account number ---
    const accPatterns = [
      /a\/?c\s*(?:no\.?|number|num\.?|#)\s*[:\-#.\s]*([\d][\d\s-]{6,19})/i,
      /account\s*(?:no\.?|number|num\.?|#)\s*[:\-#.\s]*([\d][\d\s-]{6,19})/i,
      /\bacct\s*(?:no\.?|number)?\s*[:\-#.\s]*([\d][\d\s-]{6,19})/i,
    ];
    for (const p of accPatterns) {
      const m = raw.match(p);
      if (m?.[1]) {
        const digits = m[1].replace(/[\s-]/g, '');
        if (/^\d{6,20}$/.test(digits)) {
          result.accountNumber = digits;
          detected.push('accountNumber');
          break;
        }
      }
    }

    // --- Account holder name ---
    const namePatterns = [
      /(?:a\/?c\s*(?:holder)?\s*name|account\s*name|account\s*holder(?:'s)?\s*name|customer\s*name|name\s*of\s*account\s*holder)\s*[:-]\s*([^\n|]+)/i,
      /\b(mr|mrs|ms|shri)\.?\s+([A-Za-z][A-Za-z.\s]{2,60})/,
    ];
    for (const p of namePatterns) {
      const m = raw.match(p);
      const candidate = m ? ((m[2] || m[1] || '').trim()) : '';
      if (candidate.length >= 3 && candidate.length <= 80 && !/^account/i.test(candidate)) {
        result.accountHolderName = candidate.replace(/\s{2,}/g, ' ').replace(/[;,]+$/, '');
        detected.push('accountHolderName');
        break;
      }
    }

    // --- Statement period (prefer real transactions) ---
    const dates = transactions.map(t => t.date).filter(Boolean).sort((a, b) => a - b);
    if (dates.length) {
      result.startDate = this._formatLocalDate(dates[0]);
      result.endDate = this._formatLocalDate(dates[dates.length - 1]);
      detected.push('startDate', 'endDate');
    } else {
      const m = raw.match(/(?:statement\s*period|period|from\s*date)[^\d]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|–|thru|through|till)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
      if (m) {
        const s = this.parseDate(m[1]);
        const e = this.parseDate(m[2]);
        if (s) result.startDate = this._formatLocalDate(s);
        if (e) result.endDate = this._formatLocalDate(e);
        if (result.startDate || result.endDate) detected.push('startDate', 'endDate');
      }
    }
    if (result.startDate && result.endDate && result.startDate > result.endDate) {
      [result.startDate, result.endDate] = [result.endDate, result.startDate];
    }

    // --- Opening / closing balance ---
    const openingMatch = raw.match(/(?:opening|opening\s*balance|balance\s*forward(?:ed)?)[^0-9-]*(-?\d[\d,]*\.\d{2})/i);
    const closingMatch = raw.match(/(?:closing|closing\s*balance|balance\s*as\s*on|available\s*balance|closing\s*balance\s*as\s*on)[^0-9-]*(-?\d[\d,]*\.\d{2})/i);

    if (openingMatch) {
      result.openingBalance = this._parseAmount(openingMatch[1]).toFixed(2);
      detected.push('openingBalance');
    }
    if (closingMatch) {
      result.closingBalance = this._parseAmount(closingMatch[1]).toFixed(2);
      detected.push('closingBalance');
    }

    // Fallback: derive balances from transaction running balances
    const withBalance = transactions.filter(t => Number.isFinite(parseFloat(t.balance)));
    if (withBalance.length) {
      const first = withBalance[0];
      const last = withBalance[withBalance.length - 1];
      if (!result.openingBalance) {
        const open = parseFloat(first.balance) + parseFloat(first.debit || 0) - parseFloat(first.credit || 0);
        result.openingBalance = open.toFixed(2);
        detected.push('openingBalance');
      }
      if (!result.closingBalance) {
        result.closingBalance = parseFloat(last.balance).toFixed(2);
        detected.push('closingBalance');
      }
    }

    result.detectedFields = [...new Set(detected)];
    return result;
  }

  // ===== FILE PARSING =====

  async parseCSV(filePath) {
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      // Bank CSVs often start with preamble rows (bank name, account info)
      // before the real column header. Find the header row so parsing works.
      const lines = fileContent.split(/\r?\n/);
      const headerIndex = lines.findIndex(
        (line) =>
          /date/i.test(line) &&
          /(debit|withdrawal|credit|deposit|amount|balance|description|particulars|narration)/i.test(line),
      );
      const content = headerIndex > 0 ? lines.slice(headerIndex).join('\n') : fileContent;

      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });

      // Banks disagree on column names — "Withdrawals (Dr)", "Dr", "Debit",
      // "Narration", "Particulars"… Exact-name lookups silently read every
      // value as 0 and the row then gets filtered out, so match keys
      // case-insensitively against patterns instead.
      const pick = (record, patterns) => {
        const keys = Object.keys(record);
        for (const re of patterns) {
          const hit = keys.find((k) => re.test(String(k).toLowerCase().trim()));
          if (hit !== undefined) return record[hit];
        }
        return undefined;
      };
      const toNumber = (v) => {
        if (v === undefined || v === null || v === '') return 0;
        // Strip thousands separators: parseFloat("5,000.00") === 5 otherwise.
        const n = parseFloat(String(v).replace(/[,\s]/g, ''));
        return Number.isFinite(n) ? n : 0;
      };

      const transactions = records.map((record) => {
        const date = this.parseDate(
          pick(record, [/^date$/, /^(txn|transaction|value|posting|dated?) date$/]) ??
            record.Date ??
            record['Transaction Date'] ??
            record['Txn Date'] ??
            record['Value Date']
        );

        const description =
          pick(record, [
            /^description$/,
            /^narration$/,
            /^particulars?$/,
            /^details$/,
            /^narrative$/,
            /^remarks?$/,
            /^(transaction|payment|narration) details$/,
          ]) || '';

        let debit = toNumber(pick(record, [/withdraw/, /^dr\b/, /debit/, /^out\b/]));
        let credit = toNumber(pick(record, [/deposit/, /^cr\b/, /credit/, /^in\b/]));

        // Single-amount layouts: keep the historic "amount means debit"
        // default, but honour an explicit sign or a Dr/Cr type column.
        if (!debit && !credit) {
          const raw = pick(record, [/^amount$/, /^amt$/, /^(txn|transaction) amount$/]);
          const amt = toNumber(raw);
          if (amt) {
            const dir = pick(record, [/^(type|dr\/cr|cr\/dr|txn type|transaction type)$/]);
            const negative = String(raw ?? '').trim().startsWith('-');
            const creditTyped =
              dir !== undefined && /^(c|cr|credit|deposit|in)\b/i.test(String(dir).trim());
            if (negative || creditTyped) credit = Math.abs(amt);
            else debit = amt;
          }
        }

        const reference =
          pick(record, [
            /^reference$/,
            /^ref nos?$/,
            /^ref$/,
            /^cheque nos?$/,
            /^check nos?$/,
            /^txn ids?$/,
            /^transaction ids?$/,
            /^utr( nos?)?$/,
          ]) || '';

        const balance = toNumber(pick(record, [/^balance$/, /^running balance$/, /^closing balance$/]));

        const type = debit > 0 ? 'debit' : 'credit';
        const category = this.categorizeTransaction(description, type);

        return {
          date,
          description,
          reference,
          debit: debit > 0 ? debit.toFixed(2) : '0',
          credit: credit > 0 ? credit.toFixed(2) : '0',
          balance: balance > 0 ? balance.toFixed(2) : undefined,
          type,
          category,
          payee: this.extractPayee(description),
        };
      });

      return transactions.filter(t => t.date && (t.debit > 0 || t.credit > 0));
    } catch (error) {
      logger.error('Parse CSV error:', error);
      throw new Error('Failed to parse CSV file');
    }
  }

  async parseExcel(filePath) {
    try {
      const XLSX = await import('xlsx');
      const fileBuffer = await fs.readFile(filePath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!records || records.length === 0) {
        throw new Error('No data found in Excel file');
      }

      const transactions = records.map(record => {
        const date = this.parseDate(
          record.Date ||
            record['Transaction Date'] ||
            record['Txn Date'] ||
            record['Value Date']
        );

        const description = String(
          record.Description ||
            record['Particulars'] ||
            record['Narration'] ||
            record['Details'] ||
            ''
        );

        const debit = parseFloat(
          record.Debit || record.Withdrawal || record.Out || record.Amount || 0
        );
        const credit = parseFloat(
          record.Credit || record.Deposit || record.In || 0
        );
        const reference = String(
          record.Reference || record['Ref No'] || record['Cheque No'] || record['Txn Id'] || ''
        );
        const balance = parseFloat(record.Balance || record['Running Balance'] || 0);

        const type = debit > 0 ? 'debit' : 'credit';
        const category = this.categorizeTransaction(description, type);

        return {
          date,
          description,
          reference,
          debit: debit > 0 ? debit.toFixed(2) : '0',
          credit: credit > 0 ? credit.toFixed(2) : '0',
          balance: balance > 0 ? balance.toFixed(2) : undefined,
          type,
          category,
          payee: this.extractPayee(description),
        };
      });

      const valid = transactions.filter(t => t.date && (t.debit > 0 || t.credit > 0));
      logger.info(`Parsed ${valid.length} transactions from Excel file`);
      return valid;
    } catch (error) {
      logger.error('Parse Excel error:', error);
      throw new Error(`Failed to parse Excel file: ${error.message}`);
    }
  }

  async parsePDF(filePath) {
    try {
      const extraction = await ocrService.extractText(filePath);
      if (extraction.error === 'password_required') {
        throw new Error('PDF is password-protected. Provide password and retry upload.');
      }
      if (extraction.error) {
        throw new Error(extraction.errorMessage || 'Unable to read PDF content');
      }

      const text = extraction.text || '';
      const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      const transactionStartPattern =
        /^(\d+)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/i;
      const amountPattern = /-?\d[\d,]*\.\d{2}/g;

      const openingBalanceMatch = text.match(/opening\s+balance[^\d-]*(-?\d[\d,]*\.\d{2})/i);
      let previousBalance = openingBalanceMatch ? this._parseAmount(openingBalanceMatch[1]) : null;

      const blocks = [];
      let currentBlock = [];

      for (const line of lines) {
        if (
          /statement\s+generated/i.test(line) ||
          /current\s+account\s+transactions/i.test(line) ||
          /withdrawal\s*\(dr\)/i.test(line) ||
          /deposit\s*\(cr\)/i.test(line) ||
          /^#\s*date/i.test(line) ||
          /^--\s*\d+\s*of\s*\d+\s*--$/i.test(line)
        ) {
          continue;
        }

        if (transactionStartPattern.test(line)) {
          if (currentBlock.length) {
            blocks.push(currentBlock.join(' '));
          }
          currentBlock = [line];
          continue;
        }

        if (currentBlock.length) {
          currentBlock.push(line);
        }
      }

      if (currentBlock.length) {
        blocks.push(currentBlock.join(' '));
      }

      const transactions = [];

      for (const block of blocks) {
        const startMatch = block.match(transactionStartPattern);
        if (!startMatch) continue;

        const date = this.parseDate(startMatch[2]);
        if (!date) continue;

        const amounts = (block.match(amountPattern) || [])
          .map(raw => this._parseAmount(raw))
          .filter(v => Number.isFinite(v));

        if (!amounts.length) continue;

        let debit = 0;
        let credit = 0;
        let balance = amounts.length >= 2 ? amounts[amounts.length - 1] : null;
        let transactionAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];

        if (amounts.length >= 3) {
          const withdrawal = amounts[amounts.length - 3];
          const deposit = amounts[amounts.length - 2];
          balance = amounts[amounts.length - 1];

          if (withdrawal > 0 && deposit === 0) {
            debit = withdrawal;
            transactionAmount = withdrawal;
          } else if (deposit > 0 && withdrawal === 0) {
            credit = deposit;
            transactionAmount = deposit;
          } else if (withdrawal > 0 && deposit > 0) {
            const inferredType = this._inferPdfTransactionType(
              block,
              Math.max(withdrawal, deposit),
              balance,
              previousBalance,
            );
            if (inferredType === 'credit') {
              credit = Math.max(withdrawal, deposit);
              transactionAmount = credit;
            } else {
              debit = Math.max(withdrawal, deposit);
              transactionAmount = debit;
            }
          }
        }

        if (debit === 0 && credit === 0) {
          const inferredType = this._inferPdfTransactionType(
            block,
            transactionAmount,
            balance,
            previousBalance,
          );
          if (inferredType === 'credit') {
            credit = Math.abs(transactionAmount);
          } else {
            debit = Math.abs(transactionAmount);
          }
        }

        const description = block
          .replace(startMatch[0], ' ')
          .replace(amountPattern, ' ')
          .replace(/\b(?:dr|cr|debit|credit)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (!description || (debit === 0 && credit === 0)) continue;

        const type = debit > 0 ? 'debit' : 'credit';

        transactions.push({
          date,
          description,
          reference: '',
          debit: debit > 0 ? Math.abs(debit).toFixed(2) : '0',
          credit: credit > 0 ? Math.abs(credit).toFixed(2) : '0',
          balance: Number.isFinite(balance) ? balance.toFixed(2) : undefined,
          type,
          category: this.categorizeTransaction(description, type),
          payee: this.extractPayee(description),
        });

        if (Number.isFinite(balance)) {
          previousBalance = balance;
        }
      }

      logger.info(`Parsed ${transactions.length} transactions from PDF file`);

      if (transactions.length === 0) {
        throw new Error('Could not extract transactions from PDF. Try CSV or Excel format for better results.');
      }

      return transactions;
    } catch (error) {
      logger.error('Parse PDF error:', error);
      if (error.message.includes('Could not extract')) throw error;
      throw new Error(`Failed to parse PDF file: ${error.message}`);
    }
  }

  _parseAmount(raw) {
    const value = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(value) ? value : 0;
  }

  _inferPdfTransactionType(rawText, transactionAmount, currentBalance, previousBalance) {
    const text = String(rawText || '').toLowerCase();

    const creditHints = [
      'received',
      'deposit',
      'salary',
      'refund',
      'interest',
      'reversal',
      'credit',
      'cash deposit',
      'inward',
      'by transfer',
    ];

    const debitHints = [
      'sent',
      'withdrawal',
      'debit',
      'payment',
      'charge',
      'fee',
      'emi',
      'purchase',
      'atm',
      'imps',
      'neft',
      'rtgs',
      'upi',
      'to ',
    ];

    const hasCreditHint = creditHints.some(hint => text.includes(hint));
    const hasDebitHint = debitHints.some(hint => text.includes(hint));

    if (hasCreditHint && !hasDebitHint) return 'credit';
    if (hasDebitHint && !hasCreditHint) return 'debit';

    if (Number.isFinite(currentBalance) && Number.isFinite(previousBalance)) {
      const delta = currentBalance - previousBalance;
      const absTxn = Math.abs(transactionAmount || 0);
      if (absTxn > 0 && Math.abs(Math.abs(delta) - absTxn) <= 1) {
        return delta >= 0 ? 'credit' : 'debit';
      }
      if (Math.abs(delta) > 0) {
        return delta >= 0 ? 'credit' : 'debit';
      }
    }

    if (/\bcr\b/.test(text) && !/\bdr\b/.test(text)) return 'credit';
    if (/\bdr\b/.test(text) && !/\bcr\b/.test(text)) return 'debit';

    return 'debit';
  }

  // ===== UTILITY METHODS =====

  parseDate(dateStr) {
    if (!dateStr) return null;

    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
      return dateStr;
    }

    dateStr = String(dateStr).trim();

    const dmy = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
    if (dmy) {
      const p1 = parseInt(dmy[1], 10);
      const p2 = parseInt(dmy[2], 10);
      let year = parseInt(dmy[3], 10);
      if (year < 100) year += 2000;

      let day = p1;
      let month = p2;
      if (p1 <= 12 && p2 > 12) {
        day = p2;
        month = p1;
      }

      const date = new Date(year, month - 1, day);
      return isNaN(date.getTime()) ? null : date;
    }

    const ymd = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (ymd) {
      const date = new Date(
        parseInt(ymd[1], 10),
        parseInt(ymd[2], 10) - 1,
        parseInt(ymd[3], 10),
      );
      return isNaN(date.getTime()) ? null : date;
    }

    const dMonY = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
    if (dMonY) {
      const monthMap = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      const day = parseInt(dMonY[1], 10);
      const monthKey = dMonY[2].toLowerCase().slice(0, 3);
      let year = parseInt(dMonY[3], 10);
      if (year < 100) year += 2000;

      const month = monthMap[monthKey];
      if (month !== undefined) {
        const date = new Date(year, month, day);
        return isNaN(date.getTime()) ? null : date;
      }
    }

    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  categorizeTransaction(description, type) {
    const desc = description.toLowerCase();

    if (type === 'credit') {
      if (desc.includes('salary') || desc.includes('payment')) return 'deposit';
      if (desc.includes('interest')) return 'interest';
      if (desc.includes('refund')) return 'refund';
      if (desc.includes('transfer')) return 'transfer';
      return 'other';
    }

    if (type === 'debit') {
      if (desc.includes('transfer')) return 'transfer';
      if (desc.includes('fee') || desc.includes('charge')) return 'fee';
      if (desc.includes('withdrawal') || desc.includes('cash')) return 'withdrawal';
      if (desc.includes('payment')) return 'payment';
      return 'other';
    }

    return 'other';
  }

  extractPayee(description) {
    return description.split(/[,-]/)[0].trim();
  }

  // ===== QUERY METHODS =====

  async getBankStatements(filters = {}, pagination = {}) {
    const { status, accountNumber, dateFrom, dateTo } = filters;
    const { page = 1, limit = 20, sortBy = 'endDate', sortOrder = 'desc' } = pagination;

    const query = {};

    if (status) query.status = status;
    if (accountNumber) query.accountNumber = accountNumber;

    if (dateFrom || dateTo) {
      query.endDate = {};
      if (dateFrom) query.endDate.$gte = new Date(dateFrom);
      if (dateTo) query.endDate.$lte = new Date(dateTo);
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [statements, total] = await Promise.all([
      BankStatement.find(query)
        .populate('uploadedBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      BankStatement.countDocuments(query),
    ]);

    return {
      statements,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getBankStatementById(statementId) {
    const statement = await BankStatement.findById(statementId)
      .populate('uploadedBy', 'name email')
      .populate('transactions.matchedExpenseId')
      .populate('transactions.matchedInvoiceId');

    if (!statement) {
      throw new Error('Bank statement not found');
    }

    return statement;
  }

  /**
   * Permanently delete a bank statement and its uploaded source file.
   */
  async deleteBankStatement(statementId, actor = {}) {
    const statement = await BankStatement.findById(statementId);
    if (!statement) {
      throw new Error('Bank statement not found');
    }

    const actorId = actor?._id ? String(actor._id) : '';
    const actorRole = String(actor?.role || '').toLowerCase();
    const actorRoles = Array.isArray(actor?.roles)
      ? actor.roles.map(r => String(r).toLowerCase())
      : [];
    const isPrivileged =
      actorRole === 'admin' ||
      actorRole === 'accountant' ||
      actorRoles.includes('admin') ||
      actorRoles.includes('accountant');

    const ownerId = statement.uploadedBy ? String(statement.uploadedBy) : '';
    const isOwner = Boolean(actorId) && ownerId === actorId;

    if (!isPrivileged && !isOwner) {
      throw new Error('Not authorized to delete this bank statement');
    }

    const filePath = statement.file?.path;
    await BankStatement.findByIdAndDelete(statementId);

    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // Missing file should not block database deletion.
        if (error.code !== 'ENOENT') {
          logger.warn(`Failed to delete statement file at ${filePath}: ${error.message}`);
        }
      }
    }

    return {
      deletedId: statementId,
      statementNumber: statement.statementNumber,
      fileDeleted: Boolean(filePath),
    };
  }

  /**
   * Manual match trigger (re-runs matching on already-processed statement)
   */
  async matchTransactions(statementId) {
    const statement = await BankStatement.findById(statementId);
    if (!statement) throw new Error('Bank statement not found');

    let matchCount = 0;

    for (const transaction of statement.transactions) {
      if (transaction.type === 'debit' && !transaction.matched) {
        const expense = await Expense.findOne({
          date: {
            $gte: new Date(new Date(transaction.date).setDate(new Date(transaction.date).getDate() - 3)),
            $lte: new Date(new Date(transaction.date).setDate(new Date(transaction.date).getDate() + 3)),
          },
          totalAmount: transaction.debit,
          status: { $in: ['approved', 'recorded', 'pending'] },
        });

        if (expense) {
          transaction.matched = true;
          transaction.matchedExpenseId = expense._id;
          matchCount++;
        }
      }

      if (transaction.type === 'credit' && !transaction.matched) {
        const invoice = await Invoice.findOne({
          status: { $in: ['sent', 'partial', 'overdue'] },
          $expr: {
            $lte: [
              { $abs: { $subtract: [{ $toDouble: '$totalAmount' }, { $toDouble: transaction.credit }] } },
              0.01,
            ],
          },
        });

        if (invoice) {
          transaction.matched = true;
          transaction.matchedInvoiceId = invoice._id;
          matchCount++;
        }
      }
    }

    await statement.save();

    logger.info(`Matched ${matchCount} transactions for statement: ${statement.statementNumber}`);
    return { matched: matchCount, total: statement.transactions.length };
  }

  /**
   * Create expenses from selected unmatched transactions
   */
  async createExpensesFromTransactions(statementId, userId, transactionIds = []) {
    const statement = await BankStatement.findById(statementId);
    if (!statement) throw new Error('Bank statement not found');

    const createdExpenses = [];

    for (const txnId of transactionIds) {
      const transaction = statement.transactions.id(txnId);

      if (!transaction || transaction.matched) {
        continue;
      }

      const expense = new Expense({
        date: transaction.date,
        vendor: transaction.payee || transaction.description,
        description: transaction.description,
        category: this._mapCategoryToExpenseCategory(transaction.category, transaction.description),
        amount: transaction.debit,
        taxAmount: '0',
        totalAmount: transaction.debit,
        paymentMethod: 'bank_transfer',
        status: 'pending',
        submittedBy: userId,
        notes: `From bank statement: ${statement.statementNumber}`,
      });

      await expense.save();

      transaction.matched = true;
      transaction.matchedExpenseId = expense._id;
      transaction.autoCreated = true;

      createdExpenses.push(expense);
    }

    await statement.save();

    logger.info(`Created ${createdExpenses.length} expenses from statement: ${statement.statementNumber}`);
    return createdExpenses;
  }
}

export default new BankStatementService();
