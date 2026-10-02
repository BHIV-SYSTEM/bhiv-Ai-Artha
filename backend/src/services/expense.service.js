import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import Expense from '../models/Expense.js';
import companySettingsService from './companySettings.service.js';
import ledgerService from './ledger.service.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import logger from '../config/logger.js';
import fs from 'fs/promises';
import path from 'path';
import cacheService from './cache.service.js';
import { calculateGSTBreakdown, buildGSTValidationError } from './gstEngine.service.js';
import auditService from './audit.service.js';
import evidenceAutomationService from './evidenceAutomation.service.js';
import tantraService from './tantra.service.js';
import notificationEvent from './notificationEvent.service.js';

class ExpenseService {
  /**
   * Create a new expense
   */
  async createExpense(expenseData, userId, files = []) {
    try {
      const allowedFields = [
        'vendor', 'description', 'amount', 'category', 'date',
        'paymentMethod', 'reference', 'tags', 'gstRate', 'supplierState',
        'taxAmount', 'totalAmount', 'isRecurring', 'recurrencePattern',
        'frequency', 'nextDueDate', 'isGSTExpense',
      ];
      const filtered = {};
      for (const field of allowedFields) {
        if (expenseData[field] !== undefined) {
          filtered[field] = expenseData[field];
        }
      }
      const expense = new Expense({
        ...filtered,
        submittedBy: userId,
      });

      // Auto-calculate GST if gstRate and supplierState provided
      const gstRate = expense.gstRate;
      const supplierState = expense.supplierState;
      const amount = new Decimal(expense.amount || 0);
      const hasGSTRate = gstRate !== undefined && gstRate !== null && gstRate !== '' && new Decimal(gstRate).greaterThan(0);
      const hasSupplierState = supplierState && supplierState.trim().length > 0;

      if (hasGSTRate && hasSupplierState) {
        const settings = await companySettingsService.getSettings();
        const companyState = settings?.address?.state || (settings?.gstin ? settings.gstin.substring(0, 2) : null);

        if (companyState) {
          const detail = calculateGSTBreakdown({
            transaction_type: 'purchase',
            amount: amount.toDecimalPlaces(2).toString(),
            gst_rate: gstRate,
            supplier_state: supplierState,
            company_state: companyState,
          });

          const cgst = new Decimal(detail.cgst || 0);
          const sgst = new Decimal(detail.sgst || 0);
          const igst = new Decimal(detail.igst || 0);
          const totalTax = cgst.plus(sgst).plus(igst);

          expense.taxAmount = totalTax.toString();
          expense.totalAmount = amount.plus(totalTax).toDecimalPlaces(2).toString();
        }
      }

      // Handle file uploads
      if (files && files.length > 0) {
        expense.receipts = files.map(file => ({
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
        }));
      }

      await expense.save();
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'EXPENSE_CREATED',
        entityType: 'Expense',
        entityId: expense._id,
        traceId: expense.trace_id || randomUUID(),
        userId,
        details: {
          expenseNumber: expense.expenseNumber,
          vendor: expense.vendor,
          amount: expense.amount,
          category: expense.category,
          status: expense.status,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'createExpense',
        entityType: 'Expense',
        entityId: expense._id,
        request: { expenseData, userId },
        response: { success: true, expenseNumber: expense.expenseNumber },
        traceId: expense.trace_id || randomUUID(),
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'EXPENSE_CREATED',
        entityType: 'Expense',
        entityId: expense._id,
        details: { expenseNumber: expense.expenseNumber, amount: expense.amount },
      });
      
      logger.info(`Expense created: ${expense.expenseNumber}`);

      notificationEvent.expenseCreated(expense).catch(() => {});

      return expense;
    } catch (error) {
      logger.error('Create expense error:', error);
      throw error;
    }
  }
  
  /**
   * Get expenses with filters and pagination
   */
  async getExpenses(filters = {}, pagination = {}) {
    const {
      status,
      category,
      dateFrom,
      dateTo,
      submittedBy,
      search,
    } = filters;
    
    const {
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc',
    } = pagination;
    
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (category) {
      query.category = category;
    }
    
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }
    
    if (submittedBy) {
      query.submittedBy = submittedBy;
    }
    
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { expenseNumber: { $regex: safeSearch, $options: 'i' } },
        { vendor: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    const [expenses, total] = await Promise.all([
      Expense.find(query)
        .populate('submittedBy', 'name email')
        .populate('approvedBy', 'name email')
        .populate('account', 'code name')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Expense.countDocuments(query),
    ]);
    
    return {
      expenses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }
  
  /**
   * Get a single expense by ID
   */
  async getExpenseById(expenseId) {
    const expense = await Expense.findById(expenseId)
      .populate('submittedBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('account', 'code name')
      .populate('journalEntryId');
    
    if (!expense) {
      throw new Error('Expense not found');
    }
    
    return expense;
  }
  
  /**
   * Update expense
   */
  async updateExpense(expenseId, updateData, files = []) {
    const expense = await Expense.findById(expenseId);
    
    if (!expense) {
      throw new Error('Expense not found');
    }
    
    if (expense.status === 'recorded') {
      throw new Error('Cannot update a recorded expense');
    }

    const allowedFields = [
      'vendor', 'description', 'amount', 'category', 'date',
      'paymentMethod', 'reference', 'tags', 'gstRate', 'supplierState',
      'taxAmount', 'totalAmount', 'isRecurring', 'recurrencePattern',
      'frequency', 'nextDueDate', 'isGSTExpense',
    ];
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        expense[field] = updateData[field];
      }
    }
    
    // Add new receipts
    if (files && files.length > 0) {
      const newReceipts = files.map(file => ({
        filename: file.filename,
        path: file.path,
        mimetype: file.mimetype,
        size: file.size,
      }));
      expense.receipts = [...expense.receipts, ...newReceipts];
    }
    
    await expense.save();
    
    logger.info(`Expense updated: ${expense.expenseNumber}`);
    
    return expense;
  }
  
  /**
   * Approve expense
   */
  async approveExpense(expenseId, userId) {
    const expense = await Expense.findById(expenseId);
    
    if (!expense) {
      throw new Error('Expense not found');
    }
    
    if (expense.status !== 'pending') {
      throw new Error('Only pending expenses can be approved');
    }
    
    expense.status = 'approved';
    expense.approvedBy = userId;
    expense.approvedAt = new Date();
    
    await expense.save();
    
    // Audit trail
    await auditService.recordEvent({
      eventType: 'EXPENSE_APPROVED',
      entityType: 'Expense',
      entityId: expense._id,
      traceId: expense.trace_id || randomUUID(),
      userId,
      details: {
        expenseNumber: expense.expenseNumber,
        vendor: expense.vendor,
        amount: expense.amount,
        status: expense.status,
      },
    });
    
    // Capture evidence
    await evidenceAutomationService.captureAPIResponse({
      operation: 'approveExpense',
      entityType: 'Expense',
      entityId: expense._id,
      request: { expenseId, userId },
      response: { success: true, expenseNumber: expense.expenseNumber, status: expense.status },
      traceId: expense.trace_id || randomUUID(),
    });
    
    // Emit TANTRA event
    await tantraService.emitEvent({
      event: 'EXPENSE_APPROVED',
      entityType: 'Expense',
      entityId: expense._id,
      details: { expenseNumber: expense.expenseNumber, amount: expense.amount },
    });
    
    logger.info(`Expense approved: ${expense.expenseNumber}`);

    notificationEvent.expenseApproved(expense).catch(() => {});

    let autoRecordWarning = null;
    try {
      await this.recordExpense(expenseId, userId);
      logger.info(`Expense auto-recorded to ledger after approval: ${expense.expenseNumber}`);
    } catch (err) {
      autoRecordWarning = `Auto-record failed: ${err.message}. Call POST /expenses/${expenseId}/record to retry after fixing the issue.`;
      logger.warn(`Auto-record after approval failed for ${expense.expenseNumber}: ${err.message}`);
    }
    
    // Re-fetch to get latest status after possible auto-record
    const updatedExpense = await Expense.findById(expenseId);
    return { expense: updatedExpense, autoRecordWarning };
  }
  
  /**
   * Reject expense
   */
  async rejectExpense(expenseId, reason, userId) {
    const expense = await Expense.findById(expenseId);
    
    if (!expense) {
      throw new Error('Expense not found');
    }
    
    if (expense.status !== 'pending') {
      throw new Error('Only pending expenses can be rejected');
    }
    
    expense.status = 'rejected';
    expense.rejectionReason = reason;
    expense.approvedBy = userId;
    expense.approvedAt = new Date();
    
    await expense.save();
    
    logger.info(`Expense rejected: ${expense.expenseNumber}`);

    notificationEvent.expenseRejected(expense, reason).catch(() => {});

    return expense;
  }
  
  /**
   * Record expense in ledger
   */
  async recordExpense(expenseId, userId) {
    const { withTransaction } = await import('../config/database.js');
    
    return await withTransaction(async (session) => {
      const expense = session ? await Expense.findById(expenseId).session(session) : await Expense.findById(expenseId);
      
      if (!expense) {
        throw new Error('Expense not found');
      }
      
      if (expense.status !== 'approved') {
        throw new Error('Only approved expenses can be recorded');
      }
      
      // Get or find expense account
      let expenseAccount;
      if (expense.account) {
        expenseAccount = await ChartOfAccounts.findById(expense.account).session(session);
      } else {
        // Map category to account
        const categoryAccountMap = {
          travel: '6700',
          meals: '6900',
          supplies: '6300',
          utilities: '6200',
          rent: '6100',
          insurance: '6600',
          marketing: '6500',
          professional_services: '6700',
          equipment: '1800',
          software: '6300',
          other: '6900',
        };
        
        const accountCode = categoryAccountMap[expense.category] || '6900';
        expenseAccount = await ChartOfAccounts.findOne({ code: accountCode }).session(session);
      }
      
      let cashAccount = await ChartOfAccounts.findOne({ code: '1010' }).session(session);
      let inputCGST = await ChartOfAccounts.findOne({ code: '2301' }).session(session);
      let inputSGST = await ChartOfAccounts.findOne({ code: '2302' }).session(session);
      let inputIGST = await ChartOfAccounts.findOne({ code: '2303' }).session(session);

      if (!cashAccount) {
        cashAccount = await ChartOfAccounts.create([{
          code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit',
        }], { session });
        cashAccount = cashAccount[0];
      }

      if (!inputCGST) {
        inputCGST = await ChartOfAccounts.create([
          {
            code: '2301',
            name: 'Input CGST',
            type: 'Asset',
            subtype: 'Current Asset',
            normalBalance: 'debit',
          },
        ], { session });
        inputCGST = inputCGST[0];
      }

      if (!inputSGST) {
        inputSGST = await ChartOfAccounts.create([
          {
            code: '2302',
            name: 'Input SGST',
            type: 'Asset',
            subtype: 'Current Asset',
            normalBalance: 'debit',
          },
        ], { session });
        inputSGST = inputSGST[0];
      }

      if (!inputIGST) {
        inputIGST = await ChartOfAccounts.create([
          {
            code: '2303',
            name: 'Input IGST',
            type: 'Asset',
            subtype: 'Current Asset',
            normalBalance: 'debit',
          },
        ], { session });
        inputIGST = inputIGST[0];
      }
      
      if (!expenseAccount) {
        // Fallback to miscellaneous expense
        expenseAccount = await ChartOfAccounts.findOne({ code: '6900' }).session(session);
        if (!expenseAccount) {
          expenseAccount = (await ChartOfAccounts.create([{
            code: '6900', name: 'Miscellaneous Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit',
          }], { session }))[0];
        }
      }

      if (!cashAccount || !inputCGST || !inputSGST || !inputIGST) {
        throw new Error('GST accounts could not be created');
      }

      const taxableAmount = new Decimal(expense.amount || 0);
      const declaredTaxAmount = new Decimal(expense.taxAmount || 0);
      const declaredTotalAmount = new Decimal(expense.totalAmount || 0);
      const gstRate = expense.gstRate;
      const tolerance = new Decimal('0.01');

      let totalCGST = new Decimal(0);
      let totalSGST = new Decimal(0);
      let totalIGST = new Decimal(0);
      let gstDetails = undefined;
      let gstCalculated = false;

      const hasGSTRate = gstRate !== undefined && gstRate !== null && gstRate !== '' && new Decimal(gstRate).greaterThan(0);
      const hasSupplierState = expense.supplierState && expense.supplierState.trim().length > 0;

      if (hasGSTRate && hasSupplierState) {
        const settings = await companySettingsService.getSettings({ session });
        const companyState = settings?.address?.state || (settings?.gstin ? settings.gstin.substring(0, 2) : null);

        if (companyState) {
          const detail = calculateGSTBreakdown({
            transaction_type: 'purchase',
            amount: taxableAmount.toDecimalPlaces(2).toString(),
            gst_rate: gstRate,
            supplier_state: expense.supplierState,
            company_state: companyState,
          });

          totalCGST = new Decimal(detail.cgst || 0);
          totalSGST = new Decimal(detail.sgst || 0);
          totalIGST = new Decimal(detail.igst || 0);
          gstCalculated = true;
          gstDetails = [{
            ...detail,
            amount: taxableAmount.toDecimalPlaces(2).toString(),
          }];
        }
      }

      let totalTax;
      let totalAmount;

      if (gstCalculated) {
        totalTax = totalCGST.plus(totalSGST).plus(totalIGST);
        totalAmount = taxableAmount.plus(totalTax);

        if (declaredTaxAmount.greaterThan(0) && totalTax.minus(declaredTaxAmount).abs().greaterThan(tolerance)) {
          throw buildGSTValidationError('Expense tax amount does not match GST calculation', {
            expenseId: String(expense._id),
            expected: totalTax.toString(),
            actual: expense.taxAmount,
          });
        }

        if (declaredTotalAmount.greaterThan(0) && totalAmount.minus(declaredTotalAmount).abs().greaterThan(tolerance)) {
          throw buildGSTValidationError('Expense total amount does not match GST calculation', {
            expenseId: String(expense._id),
            expected: totalAmount.toString(),
            actual: expense.totalAmount,
          });
        }
      } else {
        totalTax = declaredTaxAmount;
        totalAmount = declaredTotalAmount.greaterThan(0)
          ? declaredTotalAmount
          : taxableAmount.plus(declaredTaxAmount);
      }

      expense.taxAmount = totalTax.toString();
      expense.totalAmount = totalAmount.toString();

      const lines = [
        {
          account: expenseAccount._id,
          debit: taxableAmount.toString(),
          credit: '0',
          description: `${expense.category} expense`,
        },
      ];

      if (totalCGST.greaterThan(0)) {
        lines.push(
          {
            account: inputCGST._id,
            debit: totalCGST.toString(),
            credit: '0',
            description: 'Input CGST',
          },
        );
      }

      if (totalSGST.greaterThan(0)) {
        lines.push(
          {
            account: inputSGST._id,
            debit: totalSGST.toString(),
            credit: '0',
            description: 'Input SGST',
          }
        );
      }

      if (totalIGST.greaterThan(0)) {
        lines.push({
          account: inputIGST._id,
          debit: totalIGST.toString(),
          credit: '0',
          description: 'Input IGST',
        });
      }

      lines.push({
        account: cashAccount._id,
        debit: '0',
        credit: totalAmount.toString(),
        description: `Payment via ${expense.paymentMethod}`,
      });
      
      // Create journal entry
      const traceId = randomUUID();
      const journalEntry = await ledgerService.createJournalEntry(
        {
          date: expense.date,
          description: `Expense: ${expense.description} - ${expense.vendor}`,
          lines,
          reference: expense.expenseNumber,
          tags: ['expense', expense.category],
          source: 'MANUAL',
          trace_id: traceId,
          gstDetails,
          auditAction: 'EXPENSE_RECORDED',
        },
        userId
      );
      
      // Validate before posting to enforce draft -> validate -> post workflow
      await ledgerService.validateJournalEntry(journalEntry._id, userId);
      await ledgerService.postJournalEntry(journalEntry._id, userId);
      
      // Update expense
      expense.status = 'recorded';
      expense.journalEntryId = journalEntry._id;
      expense.account = expenseAccount._id;
      await expense.save({ session });
      
      // Invalidate related caches
      await cacheService.invalidateExpenseCaches();
      await cacheService.invalidateLedgerCaches();
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'EXPENSE_RECORDED',
        entityType: 'Expense',
        entityId: expense._id,
        traceId,
        userId,
        details: {
          expenseNumber: expense.expenseNumber,
          vendor: expense.vendor,
          amount: expense.amount,
          totalAmount: expense.totalAmount,
          journalEntryId: journalEntry._id,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'recordExpense',
        entityType: 'Expense',
        entityId: expense._id,
        request: { expenseId, userId },
        response: { success: true, expenseNumber: expense.expenseNumber, journalEntryId: journalEntry._id },
        traceId,
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'EXPENSE_RECORDED',
        entityType: 'Expense',
        entityId: expense._id,
        details: { expenseNumber: expense.expenseNumber, journalEntryId: journalEntry._id },
      });
      
      logger.info(`Expense recorded: ${expense.expenseNumber}`);

      notificationEvent.expenseRecorded(expense).catch(() => {});

      return expense;
    });
  }
  
  /**
   * Delete receipt file
   */
  async deleteReceipt(expenseId, receiptId) {
    const expense = await Expense.findById(expenseId);
    
    if (!expense) {
      throw new Error('Expense not found');
    }
    
    const receipt = expense.receipts.id(receiptId);
    
    if (!receipt) {
      throw new Error('Receipt not found');
    }
    
    // Delete file from filesystem
    try {
      await fs.unlink(receipt.path);
    } catch (error) {
      logger.warn(`Failed to delete file: ${receipt.path}`, error);
    }
    
    // Remove from database
    expense.receipts.pull(receiptId);
    await expense.save();
    
    logger.info(`Receipt deleted from expense: ${expense.expenseNumber}`);
    
    return expense;
  }
  
  /**
   * Get expense statistics
   */
  async getExpenseStats(dateFrom, dateTo) {
    // Try to get from cache first
    const cached = await cacheService.getCachedExpenseStats(dateFrom, dateTo);
    if (cached) {
      return cached;
    }

    const match = {};
    
    if (dateFrom || dateTo) {
      match.date = {};
      if (dateFrom) match.date.$gte = new Date(dateFrom);
      if (dateTo) match.date.$lte = new Date(dateTo);
    }
    
    const [statusStats, categoryStats, totalStats] = await Promise.all([
      Expense.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: '$totalAmount' } },
          },
        },
      ]),
      Expense.aggregate([
        { $match: { ...match, status: { $in: ['approved', 'recorded'] } } },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: '$totalAmount' } },
          },
        },
      ]),
      Expense.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            totalAmount: { $sum: { $toDouble: '$totalAmount' } },
            approvedCount: {
              $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
            },
            approvedAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'approved'] }, { $toDouble: '$totalAmount' }, 0] }
            },
            recordedCount: {
              $sum: { $cond: [{ $eq: ['$status', 'recorded'] }, 1, 0] }
            },
            recordedAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'recorded'] }, { $toDouble: '$totalAmount' }, 0] }
            },
            pendingCount: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            },
            pendingAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, { $toDouble: '$totalAmount' }, 0] }
            },
          },
        },
      ]),
    ]);
    
    // Format status stats
    const formattedStatusStats = {};
    statusStats.forEach(stat => {
      formattedStatusStats[stat._id] = {
        count: stat.count,
        amount: stat.totalAmount.toFixed(2),
      };
    });
    
    // Add missing statuses with zero values
    ['pending', 'approved', 'rejected', 'recorded'].forEach(status => {
      if (!formattedStatusStats[status]) {
        formattedStatusStats[status] = { count: 0, amount: '0.00' };
      }
    });
    
    const totals = totalStats[0] || {
      totalCount: 0,
      totalAmount: 0,
      approvedCount: 0,
      approvedAmount: 0,
      recordedCount: 0,
      recordedAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
    };
    
    const result = {
      ...formattedStatusStats,
      byCategory: categoryStats,
      total: {
        count: totals.totalCount,
        amount: totals.totalAmount.toFixed(2),
      },
      summary: {
        pending: { count: totals.pendingCount, amount: totals.pendingAmount.toFixed(2) },
        approved: { count: totals.approvedCount, amount: totals.approvedAmount.toFixed(2) },
        recorded: { count: totals.recordedCount, amount: totals.recordedAmount.toFixed(2) },
      },
    };
    
    // Cache the result
    await cacheService.cacheExpenseStats(dateFrom, dateTo, result);
    
    return result;
  }
}

export default new ExpenseService();