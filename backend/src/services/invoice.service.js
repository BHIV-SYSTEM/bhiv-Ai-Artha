import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import Invoice from '../models/Invoice.js';
import JournalEntry from '../models/JournalEntry.js';
import companySettingsService from './companySettings.service.js';
import ledgerService from './ledger.service.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import logger from '../config/logger.js';
import cacheService from './cache.service.js';
import { calculateGSTBreakdown, buildGSTValidationError } from './gstEngine.service.js';
import auditService from './audit.service.js';
import evidenceAutomationService from './evidenceAutomation.service.js';
import tantraService from './tantra.service.js';
import notificationEvent from './notificationEvent.service.js';
import recipientVerification from './recipientVerification.service.js';
import { getScope } from '../utils/companyScope.js';

class InvoiceService {
  /**
   * Create a new invoice
   */
  async createInvoice(invoiceData, userId) {
    try {
      const invoice = new Invoice({
        ...invoiceData,
        createdBy: userId,
      });
      
      await invoice.save();
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'INVOICE_CREATED',
        entityType: 'Invoice',
        entityId: invoice._id,
        traceId: randomUUID(),
        userId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          totalAmount: invoice.totalAmount,
          status: invoice.status,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'createInvoice',
        entityType: 'Invoice',
        entityId: invoice._id,
        request: { invoiceData, userId },
        response: { success: true, invoiceNumber: invoice.invoiceNumber },
        traceId: invoice.trace_id || randomUUID(),
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'INVOICE_CREATED',
        entityType: 'Invoice',
        entityId: invoice._id,
        details: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
      });
      
      logger.info(`Invoice created: ${invoice.invoiceNumber}`);

      notificationEvent.invoiceCreated(invoice).catch(() => {});

      return invoice;
    } catch (error) {
      logger.error('Create invoice error:', error);
      throw error;
    }
  }
  
  /**
   * Get invoices with filters and pagination
   */
  async getInvoices(filters = {}, pagination = {}) {
    const {
      status,
      dateFrom,
      dateTo,
      customerName,
      search,
      customerEmail,
      customerGSTIN,
    } = filters;
    
    const {
      page = 1,
      limit = 20,
      sortBy = 'invoiceDate',
      sortOrder = 'desc',
    } = pagination;
    
    const query = {};
    const andClauses = [];
    
    if (status) {
      query.status = status;
    }
    
    if (dateFrom || dateTo) {
      query.invoiceDate = {};
      if (dateFrom) query.invoiceDate.$gte = new Date(dateFrom);
      if (dateTo) query.invoiceDate.$lte = new Date(dateTo);
    }
    
    if (customerName) {
      const safeName = customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.customerName = { $regex: safeName, $options: 'i' };
    }
    
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andClauses.push({
        $or: [
          { invoiceNumber: { $regex: safeSearch, $options: 'i' } },
          { customerName: { $regex: safeSearch, $options: 'i' } },
          { customerEmail: { $regex: safeSearch, $options: 'i' } },
        ],
      });
    }
    
    // Customer ownership scope (exact, case-insensitive): invoice matches if
    // customerEmail or customerGSTIN equals the supplied value(s).
    const scopeClauses = [];
    if (customerEmail) {
      const safeEmail = String(customerEmail).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scopeClauses.push({ customerEmail: { $regex: `^${safeEmail}$`, $options: 'i' } });
    }
    if (customerGSTIN) {
      const safeGstin = String(customerGSTIN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scopeClauses.push({ customerGSTIN: { $regex: `^${safeGstin}$`, $options: 'i' } });
    }
    if (scopeClauses.length === 1) {
      andClauses.push(scopeClauses[0]);
    } else if (scopeClauses.length > 1) {
      andClauses.push({ $or: scopeClauses });
    }
    
    if (andClauses.length === 1) {
      Object.assign(query, andClauses[0]);
    } else if (andClauses.length > 1) {
      query.$and = andClauses;
    }
    
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Invoice.countDocuments(query),
    ]);
    
    return {
      invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }
  
  /**
   * Get a single invoice by ID
   */
  async getInvoiceById(invoiceId) {
    const invoice = await Invoice.findById(invoiceId)
      .populate('createdBy', 'name email')
      .populate('payments.journalEntryId');
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    return invoice;
  }
  
  /**
   * Update invoice
   */
  async updateInvoice(invoiceId, updateData) {
    const invoice = await Invoice.findById(invoiceId);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    if (invoice.status === 'paid') {
      throw new Error('Cannot update a paid invoice');
    }
    
    if (invoice.status === 'cancelled') {
      throw new Error('Cannot update a cancelled invoice');
    }

    const allowedFields = [
      'customerName', 'customerEmail', 'customerAddress', 'customerState',
      'customerGSTIN', 'dueDate', 'items', 'lines', 'taxRate', 'notes',
    ];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        invoice[field] = updateData[field];
      }
    }
    
    await invoice.save();
    
    logger.info(`Invoice updated: ${invoice.invoiceNumber}`);
    
    return invoice;
  }
  
  /**
   * Record payment for invoice
   */
  async recordPayment(invoiceId, paymentData, userId) {
    const { withTransaction } = await import('../config/database.js');
    
    return await withTransaction(async (session) => {
      const invoice = session ? await Invoice.findById(invoiceId).session(session) : await Invoice.findById(invoiceId);
      
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      if (invoice.status === 'cancelled') {
        throw new Error('Cannot record payment for cancelled invoice');
      }
      
      const paymentAmount = new Decimal(paymentData.amount);
      const amountDue = new Decimal(invoice.amountDue);
      
      if (paymentAmount.greaterThan(amountDue)) {
        throw new Error('Payment amount exceeds amount due');
      }
      
      // Get accounts — auto-create if missing
      let cashAccount = await ChartOfAccounts.findOne({ code: '1010' }).session(session);
      let arAccount = await ChartOfAccounts.findOne({ code: '1100' }).session(session);
      
      if (!cashAccount) {
        cashAccount = await ChartOfAccounts.create([{
          code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit',
        }], { session });
        cashAccount = cashAccount[0];
      }
      if (!arAccount) {
        arAccount = await ChartOfAccounts.create([{
          code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit',
        }], { session });
        arAccount = arAccount[0];
      }
      
      // Create journal entry for payment
      const traceId = randomUUID();
      const journalEntry = await ledgerService.createJournalEntry(
        {
          date: paymentData.paymentDate || new Date(),
          description: `Payment received for invoice ${invoice.invoiceNumber}`,
          lines: [
            {
              account: cashAccount._id,
              debit: paymentAmount.toString(),
              credit: '0',
              description: `Payment via ${paymentData.paymentMethod}`,
            },
            {
              account: arAccount._id,
              debit: '0',
              credit: paymentAmount.toString(),
              description: `Reduce AR for ${invoice.customerName}`,
            },
          ],
          reference: invoice.invoiceNumber,
          tags: ['invoice-payment', invoice.invoiceNumber],
          source: 'SYSTEM',
          trace_id: traceId,
          auditAction: 'INVOICE_PAYMENT_RECORDED',
        },
        userId
      );
      
      // Validate before posting to enforce draft -> validate -> post workflow
      await ledgerService.validateJournalEntry(journalEntry._id, userId);
      await ledgerService.postJournalEntry(journalEntry._id, userId);
      
      // Add payment to invoice
      invoice.payments.push({
        amount: paymentAmount.toString(),
        paymentDate: paymentData.paymentDate || new Date(),
        paymentMethod: paymentData.paymentMethod,
        reference: paymentData.reference,
        journalEntryId: journalEntry._id,
        notes: paymentData.notes,
      });
      
      // Update amount paid
      const currentPaid = new Decimal(invoice.amountPaid);
      invoice.amountPaid = currentPaid.plus(paymentAmount).toString();
      
      await invoice.save({ session });
      
      // Invalidate related caches
      await cacheService.invalidateInvoiceCaches();
      await cacheService.invalidateLedgerCaches();
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'INVOICE_PAYMENT_RECORDED',
        entityType: 'Invoice',
        entityId: invoice._id,
        traceId: traceId,
        userId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          paymentAmount: paymentAmount.toString(),
          paymentMethod: paymentData.paymentMethod,
          paymentDate: paymentData.paymentDate,
          newAmountPaid: invoice.amountPaid,
          newAmountDue: invoice.amountDue,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'recordPayment',
        entityType: 'Invoice',
        entityId: invoice._id,
        request: { invoiceId, paymentData, userId },
        response: { success: true, invoiceNumber: invoice.invoiceNumber, paymentAmount: paymentAmount.toString() },
        traceId,
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'INVOICE_PAYMENT_RECORDED',
        entityType: 'Invoice',
        entityId: invoice._id,
        details: { invoiceNumber: invoice.invoiceNumber, paymentAmount: paymentAmount.toString() },
      });
      
      logger.info(`Payment recorded for invoice: ${invoice.invoiceNumber}`);

      notificationEvent.invoicePayment(invoice, paymentAmount, paymentData.paymentMethod).catch(() => {});

      return invoice;
    });
  }
  
  /**
   * Send invoice (change status to sent)
   */
  async sendInvoice(invoiceId, userId) {
    const { withTransaction } = await import('../config/database.js');
    
    return await withTransaction(async (session) => {
      const invoice = session ? await Invoice.findById(invoiceId).session(session) : await Invoice.findById(invoiceId);
      
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      if (invoice.status !== 'draft') {
        throw new Error('Only draft invoices can be sent');
      }

      const verification = await recipientVerification.verify({
        customerEmail: invoice.customerEmail,
        customerGSTIN: invoice.customerGSTIN,
      });

      // Verification only decides whether the recipient's ARTHA workspace can
      // see this invoice — sharing itself is resolved at read time
      // (getSharedInvoices matches on customerEmail / customerGSTIN).
      // An unverified recipient is the NORMAL case (customers who are not
      // ARTHA users), so it must never block sending.
      if (!verification.verified) {
        logger.info(
          `Invoice ${invoice.invoiceNumber}: recipient is not a shared ARTHA account — sending normally`
        );
      }

      // Create journal entry to record AR
      let arAccount = await ChartOfAccounts.findOne({ code: '1100' }).session(session);
      let revenueAccount = await ChartOfAccounts.findOne({ code: '4000' }).session(session);
      let outputCGST = await ChartOfAccounts.findOne({ code: '2311' }).session(session);
      let outputSGST = await ChartOfAccounts.findOne({ code: '2312' }).session(session);
      let outputIGST = await ChartOfAccounts.findOne({ code: '2313' }).session(session);

      if (!arAccount) {
        arAccount = (await ChartOfAccounts.create([{ code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' }], { session }))[0];
      }
      if (!revenueAccount) {
        revenueAccount = (await ChartOfAccounts.create([{ code: '4000', name: 'Sales Revenue', type: 'Income', subtype: 'Operating Revenue', normalBalance: 'credit' }], { session }))[0];
      }

      const settings = await companySettingsService.getSettings({ session });
      const companyState = settings?.address?.state || (settings?.gstin ? settings.gstin.substring(0, 2) : null);

      if (!companyState) {
        throw buildGSTValidationError('Company state is required for GST', {
          invoiceId: String(invoice._id),
        });
      }

      const customerState = invoice.customerGSTIN
        ? invoice.customerGSTIN.substring(0, 2)
        : (invoice.customerState || invoice.customerAddress?.state);

      const invoiceLines = (invoice.lines && invoice.lines.length)
        ? invoice.lines
        : (invoice.items || []);

      if (!invoiceLines.length) {
        throw new Error('Invoice lines are required');
      }

      if (!customerState) {
        throw buildGSTValidationError('Customer state is required for GST', {
          invoiceId: String(invoice._id),
        });
      }

      if (!outputCGST) {
        outputCGST = await ChartOfAccounts.create([
          {
            code: '2311',
            name: 'Output CGST',
            type: 'Liability',
            subtype: 'Current Liability',
            normalBalance: 'credit',
          },
        ], { session });
        outputCGST = outputCGST[0];
      }

      if (!outputSGST) {
        outputSGST = await ChartOfAccounts.create([
          {
            code: '2312',
            name: 'Output SGST',
            type: 'Liability',
            subtype: 'Current Liability',
            normalBalance: 'credit',
          },
        ], { session });
        outputSGST = outputSGST[0];
      }

      if (!outputIGST) {
        outputIGST = await ChartOfAccounts.create([
          {
            code: '2313',
            name: 'Output IGST',
            type: 'Liability',
            subtype: 'Current Liability',
            normalBalance: 'credit',
          },
        ], { session });
        outputIGST = outputIGST[0];
      }
      
      if (!outputCGST || !outputSGST || !outputIGST) {
        throw new Error('GST accounts could not be created');
      }

      const traceId = randomUUID();
      let totalTaxable = new Decimal(0);
      let totalCGST = new Decimal(0);
      let totalSGST = new Decimal(0);
      let totalIGST = new Decimal(0);
      let taxType = null;
      const gstDetails = [];

      invoiceLines.forEach((line, index) => {
        const quantity = new Decimal(line.quantity || 0);
        const unitPrice = new Decimal(line.unitPrice || 0);
        const lineAmount = (line.amount !== undefined && line.amount !== null)
          ? new Decimal(line.amount)
          : quantity.times(unitPrice);
        const lineRate = (line.taxRate !== undefined && line.taxRate !== null)
          ? line.taxRate
          : invoice.taxRate;

        if (lineRate === undefined || lineRate === null) {
          throw buildGSTValidationError('GST rate is required for invoice line', {
            invoiceId: String(invoice._id),
            line: index + 1,
          });
        }

        const detail = calculateGSTBreakdown({
          transaction_type: 'sale',
          amount: lineAmount.toDecimalPlaces(2).toString(),
          gst_rate: lineRate,
          supplier_state: customerState,
          company_state: companyState,
        });

        if (taxType === null) {
          taxType = detail.is_interstate ? 'interstate' : 'intrastate';
        }

        if ((detail.is_interstate && taxType !== 'interstate') ||
            (!detail.is_interstate && taxType !== 'intrastate')) {
          throw buildGSTValidationError('Mixed GST tax types are not allowed', {
            invoiceId: String(invoice._id),
          });
        }

        gstDetails.push({
          ...detail,
          amount: lineAmount.toDecimalPlaces(2).toString(),
        });

        totalTaxable = totalTaxable.plus(detail.taxable_value || 0);
        totalCGST = totalCGST.plus(detail.cgst || 0);
        totalSGST = totalSGST.plus(detail.sgst || 0);
        totalIGST = totalIGST.plus(detail.igst || 0);
      });

      const totalTax = totalCGST.plus(totalSGST).plus(totalIGST);
      const totalAmount = totalTaxable.plus(totalTax);

      // Overwrite with server-calculated values (authoritative source)
      invoice.subtotal = totalTaxable.toString();
      invoice.taxAmount = totalTax.toString();
      invoice.totalAmount = totalAmount.toString();
      invoice.gstBreakdown = {
        cgst: totalCGST.toString(),
        sgst: totalSGST.toString(),
        igst: totalIGST.toString(),
        cess: '0',
      };
      
      const lines = [
        {
          account: arAccount._id,
          debit: totalAmount.toString(),
          credit: '0',
          description: 'Accounts Receivable',
        },
        {
          account: revenueAccount._id,
          debit: '0',
          credit: totalTaxable.toString(),
          description: 'Sales Revenue',
        },
      ];

      if (totalCGST.greaterThan(0)) {
        lines.push({
          account: outputCGST._id,
          debit: '0',
          credit: totalCGST.toString(),
          description: 'Output CGST',
        });
      }

      if (totalSGST.greaterThan(0)) {
        lines.push({
          account: outputSGST._id,
          debit: '0',
          credit: totalSGST.toString(),
          description: 'Output SGST',
        });
      }

      if (totalIGST.greaterThan(0)) {
        lines.push({
          account: outputIGST._id,
          debit: '0',
          credit: totalIGST.toString(),
          description: 'Output IGST',
        });
      }

      // Idempotent AR posting: if a journal for this invoice number already
      // exists (e.g. a retried send after a partial failure), reuse it instead
      // of creating a duplicate posting.
      let journalEntry = await JournalEntry.findOne({
        reference: invoice.invoiceNumber,
        status: { $nin: ['VOIDED', 'voided'] },
      });

      if (journalEntry) {
        const alreadyPosted = ['POSTED', 'posted'].includes(journalEntry.status);
        if (!alreadyPosted) {
          // postJournalEntry self-validates draft entries.
          await ledgerService.postJournalEntry(journalEntry._id, userId);
        }
        logger.warn(`Invoice ${invoice.invoiceNumber}: existing journal ${journalEntry.entryNumber} reused (idempotent send)`);
      } else {
        journalEntry = await ledgerService.createJournalEntry(
          {
            date: invoice.invoiceDate,
            description: `Invoice ${invoice.invoiceNumber} to ${invoice.customerName}`,
            lines,
            reference: invoice.invoiceNumber,
            tags: ['invoice', invoice.invoiceNumber],
            source: 'SYSTEM',
            trace_id: traceId,
            gstDetails,
            auditAction: 'INVOICE_SENT',
          },
          userId
        );

        // Validate before posting to enforce draft -> validate -> post workflow
        await ledgerService.validateJournalEntry(journalEntry._id, userId);
        await ledgerService.postJournalEntry(journalEntry._id, userId);
      }
      
      // Update invoice status
      invoice.status = 'sent';
      invoice.sentAt = invoice.sentAt || new Date();
      await invoice.save({ session });
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'INVOICE_SENT',
        entityType: 'Invoice',
        entityId: invoice._id,
        traceId: traceId,
        userId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          totalAmount: invoice.totalAmount,
          status: invoice.status,
          gstDetails: invoice.gstBreakdown,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'sendInvoice',
        entityType: 'Invoice',
        entityId: invoice._id,
        request: { invoiceId, userId },
        response: { success: true, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
        traceId,
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'INVOICE_SENT',
        entityType: 'Invoice',
        entityId: invoice._id,
        details: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
      });
      
      logger.info(`Invoice sent: ${invoice.invoiceNumber}`);

      notificationEvent.invoiceSent(invoice).catch(() => {});
      notificationEvent.deliverInvoiceToAccounts(invoice).catch(() => {});

      return invoice;
    });
  }
  
  /**
   * Cancel invoice
   */
  async cancelInvoice(invoiceId, reason, userId) {
    const { withTransaction } = await import('../config/database.js');
    
    return await withTransaction(async (session) => {
      const invoice = session 
        ? await Invoice.findById(invoiceId).session(session) 
        : await Invoice.findById(invoiceId);
      
      if (!invoice) {
        throw new Error('Invoice not found');
      }
      
      if (invoice.status === 'paid' || invoice.status === 'partial') {
        throw new Error('Cannot cancel an invoice with payments');
      }

      if (invoice.status === 'cancelled') {
        throw new Error('Invoice is already cancelled');
      }
      
      const traceId = invoice.trace_id || randomUUID();

      if (invoice.status === 'sent') {
        const arAccount = await ChartOfAccounts.findOne({ code: '1100' }).session(session);
        const revenueAccount = await ChartOfAccounts.findOne({ code: '4000' }).session(session);
        const outputCGST = await ChartOfAccounts.findOne({ code: '2311' }).session(session);
        const outputSGST = await ChartOfAccounts.findOne({ code: '2312' }).session(session);
        const outputIGST = await ChartOfAccounts.findOne({ code: '2313' }).session(session);

        const totalAmount = new Decimal(invoice.totalAmount || 0);
        const taxableAmount = new Decimal(invoice.subtotal || 0);
        const cgst = new Decimal(invoice.gstBreakdown?.cgst || 0);
        const sgst = new Decimal(invoice.gstBreakdown?.sgst || 0);
        const igst = new Decimal(invoice.gstBreakdown?.igst || 0);

        const reversingLines = [];

        if (arAccount) {
          reversingLines.push({
            account: arAccount._id,
            debit: '0',
            credit: totalAmount.toString(),
            description: `Reverse AR for cancelled invoice ${invoice.invoiceNumber}`,
          });
        }

        if (revenueAccount) {
          reversingLines.push({
            account: revenueAccount._id,
            debit: taxableAmount.toString(),
            credit: '0',
            description: `Reverse revenue for cancelled invoice ${invoice.invoiceNumber}`,
          });
        }

        if (outputCGST && cgst.greaterThan(0)) {
          reversingLines.push({
            account: outputCGST._id,
            debit: cgst.toString(),
            credit: '0',
            description: 'Reverse Output CGST',
          });
        }

        if (outputSGST && sgst.greaterThan(0)) {
          reversingLines.push({
            account: outputSGST._id,
            debit: sgst.toString(),
            credit: '0',
            description: 'Reverse Output SGST',
          });
        }

        if (outputIGST && igst.greaterThan(0)) {
          reversingLines.push({
            account: outputIGST._id,
            debit: igst.toString(),
            credit: '0',
            description: 'Reverse Output IGST',
          });
        }

        if (reversingLines.length >= 2) {
          const reversalEntry = await ledgerService.createJournalEntry(
            {
              date: new Date(),
              description: `Reversal for cancelled invoice ${invoice.invoiceNumber}: ${reason}`,
              lines: reversingLines,
              reference: invoice.invoiceNumber,
              tags: ['invoice-cancellation', invoice.invoiceNumber],
              source: 'SYSTEM',
              trace_id: traceId,
              auditAction: 'INVOICE_CANCELLED_REVERSAL',
            },
            userId
          );
          await ledgerService.validateJournalEntry(reversalEntry._id, userId);
          await ledgerService.postJournalEntry(reversalEntry._id, userId);
        }
      }
      
      invoice.status = 'cancelled';
      invoice.notes = (invoice.notes || '') + `\nCancelled: ${reason}`;
      await invoice.save({ session });
      
      await auditService.recordEvent({
        eventType: 'INVOICE_CANCELLED',
        entityType: 'Invoice',
        entityId: invoice._id,
        traceId,
        userId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          totalAmount: invoice.totalAmount,
          reason,
          status: invoice.status,
        },
      });
      
      await evidenceAutomationService.captureAPIResponse({
        operation: 'cancelInvoice',
        entityType: 'Invoice',
        entityId: invoice._id,
        request: { invoiceId, reason, userId },
        response: { success: true, invoiceNumber: invoice.invoiceNumber, status: invoice.status },
        traceId,
      });
      
      await tantraService.emitEvent({
        event: 'INVOICE_CANCELLED',
        entityType: 'Invoice',
        entityId: invoice._id,
        details: { invoiceNumber: invoice.invoiceNumber, reason },
      });
      
      logger.info(`Invoice cancelled: ${invoice.invoiceNumber}`);

      notificationEvent.invoiceCancelled(invoice, reason).catch(() => {});

      return invoice;
    });
  }
  
  /**
   * Get invoice statistics
   */
  async getInvoiceStats(dateFrom, dateTo) {
    // Try to get from cache first
    const cached = await cacheService.getCachedInvoiceStats(dateFrom, dateTo);
    if (cached) {
      return cached;
    }

    const match = {};
    
    if (dateFrom || dateTo) {
      match.invoiceDate = {};
      if (dateFrom) match.invoiceDate.$gte = new Date(dateFrom);
      if (dateTo) match.invoiceDate.$lte = new Date(dateTo);
    }
    
    const [stats, totalStats] = await Promise.all([
      Invoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: '$totalAmount' } },
            totalDue: {
              $sum: {
                $subtract: [
                  { $toDouble: '$totalAmount' },
                  { $toDouble: '$amountPaid' }
                ]
              }
            },
          },
        },
      ]),
      Invoice.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: '$totalAmount' } },
            totalPaid: { $sum: { $toDouble: '$amountPaid' } },
            totalDue: {
              $sum: {
                $subtract: [
                  { $toDouble: '$totalAmount' },
                  { $toDouble: '$amountPaid' }
                ]
              }
            },
          },
        },
      ]),
    ]);
    
    const summary = {
      draft: { count: 0, amount: '0.00', due: '0.00' },
      sent: { count: 0, amount: '0.00', due: '0.00' },
      partial: { count: 0, amount: '0.00', due: '0.00' },
      paid: { count: 0, amount: '0.00', due: '0.00' },
      overdue: { count: 0, amount: '0.00', due: '0.00' },
      cancelled: { count: 0, amount: '0.00', due: '0.00' },
    };
    
    stats.forEach(stat => {
      summary[stat._id] = {
        count: stat.count,
        amount: stat.totalAmount.toFixed(2),
        due: stat.totalDue.toFixed(2),
      };
    });
    
    const totals = totalStats[0] || {
      totalCount: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalDue: 0,
    };
    
    summary.total = {
      count: totals.totalCount,
      amount: totals.totalAmount.toFixed(2),
      paid: totals.totalPaid.toFixed(2),
      due: totals.totalDue.toFixed(2),
    };
    
    // Cache the result
    await cacheService.cacheInvoiceStats(dateFrom, dateTo, summary);
    
    return summary;
  }

  async _readUnscoped(fn) {
    const store = getScope();
    const prev = store ? store.crossCompany : null;
    if (store) store.crossCompany = true;
    try {
      return await fn();
    } finally {
      if (store) store.crossCompany = prev;
    }
  }

  async _requesterGstins() {
    try {
      const settings = await companySettingsService.getSettings();
      return [settings?.gstin, ...((settings?.gstinRegistrations || []).map((r) => r?.gstin))]
        .filter(Boolean)
        .map((g) => String(g).trim().toUpperCase());
    } catch (err) {
      return [];
    }
  }

  async _isSharedWith(invoice, user) {
    const email = String(user?.email || '').trim().toLowerCase();
    const custEmail = String(invoice.customerEmail || '').trim().toLowerCase();
    if (email && custEmail && email === custEmail) return true;
    const gstin = String(invoice.customerGSTIN || '').trim().toUpperCase();
    if (gstin) {
      const mine = await this._requesterGstins();
      if (mine.includes(gstin)) return true;
    }
    return false;
  }

  async getSharedInvoice(invoiceId, user) {
    const invoice = await this._readUnscoped(() => Invoice.findById(invoiceId).lean());
    if (!invoice || !(await this._isSharedWith(invoice, user))) return null;
    return invoice;
  }

  async getSharedInvoices(user) {
    const or = [];
    const email = String(user?.email || '').trim().toLowerCase();
    if (email) or.push({ customerEmail: email });
    const gstins = await this._requesterGstins();
    if (gstins.length) {
      const escaped = gstins.map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      or.push({ customerGSTIN: { $in: escaped.map((e) => new RegExp(`^${e}$`, 'i')) } });
    }
    if (!or.length) return [];
    const workspace = getScope()?.workspace;
    const filter = { $or: or };
    if (workspace) filter.companyId = { $ne: workspace };
    return this._readUnscoped(() =>
      Invoice.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
    );
  }
}

export default new InvoiceService();