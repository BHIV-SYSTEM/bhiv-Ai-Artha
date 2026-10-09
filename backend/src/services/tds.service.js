import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import TDSEntry from '../models/TDSEntry.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import ledgerService from './ledger.service.js';
import logger from '../config/logger.js';
import auditService from './audit.service.js';
import evidenceAutomationService from './evidenceAutomation.service.js';
import tantraService from './tantra.service.js';
import notificationEvent from './notificationEvent.service.js';

class TDSService {
  /**
   * Get TDS rate based on section
   */
  getTDSRate(section) {
    const rates = {
      '194A': 10, // Interest
      '194C': 2,  // Contractor (individual) / 1% (company)
      '194H': 5,  // Commission
      '194I': 10, // Rent
      '194J': 10, // Professional services
      '192': 0,   // Salary (varies by slab)
      '194Q': 0.1, // Purchase of goods
    };
    
    return rates[section] || 10;
  }
  
  /**
   * Calculate TDS amount
   */
  calculateTDS(amount, section, customRate = null) {
    const rate = customRate !== null ? customRate : this.getTDSRate(section);
    const amt = new Decimal(amount);
    const tdsAmount = amt.times(rate).dividedBy(100);
    
    return {
      tdsRate: rate,
      tdsAmount: tdsAmount.toString(),
      netPayable: amt.minus(tdsAmount).toString(),
    };
  }
  
  /**
   * Create TDS entry
   */
  async createTDSEntry(entryData, userId) {
    try {
      // Calculate TDS if not provided
      if (!entryData.tdsAmount) {
        const calculation = this.calculateTDS(
          entryData.paymentAmount,
          entryData.section,
          entryData.tdsRate
        );
        entryData.tdsAmount = calculation.tdsAmount;
        entryData.tdsRate = calculation.tdsRate;
      }
      
      // Determine quarter and FY — fall back to today when the caller omits
      // or sends an invalid transactionDate (it used to derive "FYNaN-aN",
      // which can never match any dashboard filter).
      let date = new Date(entryData.transactionDate);
      if (Number.isNaN(date.getTime())) date = new Date();
      entryData.transactionDate = date;
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      
      let quarter;
      if (month >= 4 && month <= 6) quarter = 'Q1';
      else if (month >= 7 && month <= 9) quarter = 'Q2';
      else if (month >= 10 && month <= 12) quarter = 'Q3';
      else quarter = 'Q4';
      
      const fyYear = month >= 4 ? year : year - 1;
      const financialYear = `FY${fyYear}-${(fyYear + 1).toString().slice(-2)}`;
      
      const tdsEntry = await TDSEntry.create({
        ...entryData,
        quarter,
        financialYear,
        createdBy: userId,
      });
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'TDS_ENTRY_CREATED',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        traceId: tdsEntry.trace_id || randomUUID(),
        userId,
        details: {
          entryNumber: tdsEntry.entryNumber,
          deducteeName: tdsEntry.deducteeName,
          section: tdsEntry.section,
          paymentAmount: tdsEntry.paymentAmount,
          tdsAmount: tdsEntry.tdsAmount,
          tdsRate: tdsEntry.tdsRate,
          quarter,
          financialYear,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'createTDSEntry',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        request: { entryData, userId },
        response: { success: true, entryNumber: tdsEntry.entryNumber },
        traceId: tdsEntry.trace_id || randomUUID(),
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'TDS_ENTRY_CREATED',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        details: { entryNumber: tdsEntry.entryNumber, tdsAmount: tdsEntry.tdsAmount },
      });
      
      logger.info(`TDS entry created: ${tdsEntry.entryNumber}`);

      notificationEvent.tdsEntryCreated(tdsEntry).catch(() => {});

      return tdsEntry;
    } catch (error) {
      logger.error('Create TDS entry error:', error);
      throw error;
    }
  }
  
  /**
   * Record TDS deduction in ledger
   */
  async recordTDSDeduction(tdsId, userId) {
    // Resolve (and if needed create) the ledger accounts BEFORE opening the
    // transaction. ledgerService.createJournalEntry / validate / post each run
    // their own transaction, and a transaction cannot see accounts created
    // inside this one while uncommitted — that made validateAccounts fail
    // with "Required accounts not found" and rolled the whole deduction back.
    const bootstrap = await TDSEntry.findById(tdsId);
    if (!bootstrap) {
      throw new Error('TDS entry not found');
    }

    let expenseAccount = bootstrap.expenseAccount
      ? await ChartOfAccounts.findById(bootstrap.expenseAccount)
      : await ChartOfAccounts.findOne({ code: '6700' });
    if (!expenseAccount) {
      throw new Error('Expense account not found');
    }

    let tdsPayableAccount = await ChartOfAccounts.findOne({ code: '2300' });
    if (!tdsPayableAccount) {
      tdsPayableAccount = (await ChartOfAccounts.create([{
        code: '2300',
        name: 'TDS Payable',
        type: 'Liability',
        subtype: 'Current Liability',
        normalBalance: 'credit',
        description: 'Tax Deducted at Source - Payable to Government',
      }]))[0];
    }

    let cashAccount = await ChartOfAccounts.findOne({ code: '1010' });
    if (!cashAccount) {
      cashAccount = (await ChartOfAccounts.create([{
        code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit',
      }]))[0];
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const tdsEntry = await TDSEntry.findById(tdsId).session(session);
      
      if (!tdsEntry) {
        throw new Error('TDS entry not found');
      }
      
      if (tdsEntry.status !== 'pending') {
        throw new Error('Only pending TDS entries can be recorded');
      }
      
      // Accounts were resolved and committed before the transaction started
      // (see above) — the ledger's own transactions need to see them.

      if (!expenseAccount) {
        throw new Error('Expense account not found');
      }
      
      // Create journal entry
      const traceId = randomUUID();
      const journalEntry = await ledgerService.createJournalEntry(
        {
          date: tdsEntry.transactionDate,
          description: `TDS ${tdsEntry.section} - ${tdsEntry.deductee.name}`,
          lines: [
            {
              account: expenseAccount._id,
              debit: tdsEntry.paymentAmount,
              credit: '0',
              description: `Payment to ${tdsEntry.deductee.name}`,
            },
            {
              account: tdsPayableAccount._id,
              debit: '0',
              credit: tdsEntry.tdsAmount,
              description: `TDS deducted @ ${tdsEntry.tdsRate}%`,
            },
            {
              account: cashAccount._id,
              debit: '0',
              credit: tdsEntry.netPayable,
              description: 'Net payment',
            },
          ],
          reference: tdsEntry.entryNumber,
          tags: ['tds', tdsEntry.section],
          source: 'SYSTEM',
          trace_id: traceId,
          auditAction: 'TDS_DEDUCTION_RECORDED',
        },
        userId
      );
      
      // Validate before posting to enforce draft -> validate -> post workflow
      await ledgerService.validateJournalEntry(journalEntry._id, userId);
      await ledgerService.postJournalEntry(journalEntry._id, userId);
      
      // Update TDS entry
      tdsEntry.status = 'deducted';
      tdsEntry.journalEntryId = journalEntry._id;
      tdsEntry.expenseAccount = expenseAccount._id;
      tdsEntry.tdsPayableAccount = tdsPayableAccount._id;
      await tdsEntry.save({ session });
      
      await session.commitTransaction();
      
      // Audit trail
      await auditService.recordEvent({
        eventType: 'TDS_DEDUCTION_RECORDED',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        traceId,
        userId,
        details: {
          entryNumber: tdsEntry.entryNumber,
          deducteeName: tdsEntry.deducteeName,
          section: tdsEntry.section,
          paymentAmount: tdsEntry.paymentAmount,
          tdsAmount: tdsEntry.tdsAmount,
          netPayable: tdsEntry.netPayable,
          journalEntryId: journalEntry._id,
        },
      });
      
      // Capture evidence
      await evidenceAutomationService.captureAPIResponse({
        operation: 'recordTDSDeduction',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        request: { tdsId, userId },
        response: { success: true, entryNumber: tdsEntry.entryNumber, journalEntryId: journalEntry._id },
        traceId,
      });
      
      // Emit TANTRA event
      await tantraService.emitEvent({
        event: 'TDS_DEDUCTION_RECORDED',
        entityType: 'TDSEntry',
        entityId: tdsEntry._id,
        details: { entryNumber: tdsEntry.entryNumber, tdsAmount: tdsEntry.tdsAmount },
      });
      
      logger.info(`TDS deduction recorded: ${tdsEntry.entryNumber}`);

      notificationEvent.tdsDeducted(tdsEntry).catch(() => {});

      return tdsEntry;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Record TDS deduction error:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Record TDS challan deposit
   */
  async recordChallanDeposit(tdsId, challanData, userId) {
    const tdsEntry = await TDSEntry.findById(tdsId);
    
    if (!tdsEntry) {
      throw new Error('TDS entry not found');
    }
    
    if (tdsEntry.status !== 'deducted') {
      throw new Error('TDS must be deducted before recording challan');
    }
    
    tdsEntry.challanNumber = challanData.challanNumber;
    tdsEntry.challanDate = challanData.challanDate;
    tdsEntry.bankBSR = challanData.bankBSR;
    tdsEntry.status = 'deposited';
    
    await tdsEntry.save();
    
    // Audit trail
    await auditService.recordEvent({
      eventType: 'TDS_CHALLAN_DEPOSITED',
      entityType: 'TDSEntry',
      entityId: tdsEntry._id,
      traceId: tdsEntry.trace_id || randomUUID(),
      userId,
      details: {
        entryNumber: tdsEntry.entryNumber,
        challanNumber: challanData.challanNumber,
        challanDate: challanData.challanDate,
        bankBSR: challanData.bankBSR,
        status: tdsEntry.status,
      },
    });
    
    // Capture evidence
    await evidenceAutomationService.captureAPIResponse({
      operation: 'recordChallanDeposit',
      entityType: 'TDSEntry',
      entityId: tdsEntry._id,
      request: { tdsId, challanData, userId },
      response: { success: true, entryNumber: tdsEntry.entryNumber, status: tdsEntry.status },
      traceId: tdsEntry.trace_id || randomUUID(),
    });
    
    // Emit TANTRA event
    await tantraService.emitEvent({
      event: 'TDS_CHALLAN_DEPOSITED',
      entityType: 'TDSEntry',
      entityId: tdsEntry._id,
      details: { entryNumber: tdsEntry.entryNumber, challanNumber: challanData.challanNumber },
    });
    
    logger.info(`TDS challan recorded: ${tdsEntry.entryNumber}`);
    
    return tdsEntry;
  }

  /**
   * Record an actual government filing for a TDS entry (filing happens on the
   * TRACES portal; this stores the acknowledgement as evidence).
   */
  async recordTDSFiling(tdsId, filingData, userId) {
    const tdsEntry = await TDSEntry.findById(tdsId);

    if (!tdsEntry) {
      throw new Error('TDS entry not found');
    }

    if (tdsEntry.status === 'filed') {
      throw new Error('Filing is already recorded for this entry');
    }

    if (tdsEntry.status !== 'deposited') {
      throw new Error('Challan must be deposited before recording filing');
    }

    tdsEntry.status = 'filed';
    tdsEntry.filedDate = filingData.filedDate ? new Date(filingData.filedDate) : new Date();
    tdsEntry.filingForm = filingData.filingForm || '26Q';
    if (filingData.acknowledgementNumber) {
      tdsEntry.acknowledgementNumber = String(filingData.acknowledgementNumber).trim();
    }
    if (filingData.notes) tdsEntry.filingNotes = String(filingData.notes);

    await tdsEntry.save();

    await auditService.recordEvent({
      eventType: 'TDS_FILING_RECORDED',
      entityType: 'TDSEntry',
      entityId: tdsEntry._id,
      traceId: tdsEntry.trace_id || randomUUID(),
      userId,
      details: {
        entryNumber: tdsEntry.entryNumber,
        filingForm: tdsEntry.filingForm,
        acknowledgementNumber: tdsEntry.acknowledgementNumber || null,
        filedDate: tdsEntry.filedDate,
        status: tdsEntry.status,
      },
    });

    await evidenceAutomationService.captureAPIResponse({
      operation: 'recordTDSFiling',
      entityType: 'TDSEntry',
      entityId: tdsEntry._id,
      request: { tdsId, filingData, userId },
      response: { success: true, entryNumber: tdsEntry.entryNumber, status: tdsEntry.status, acknowledgementNumber: tdsEntry.acknowledgementNumber || null },
      traceId: tdsEntry.trace_id || randomUUID(),
    });

    notificationEvent.filingStatusUpdated({
      regime: 'TDS',
      reference: `${tdsEntry.entryNumber} (${tdsEntry.filingForm})`,
      status: 'filed',
      acknowledgementNumber: tdsEntry.acknowledgementNumber || null,
      period: `${tdsEntry.quarter || ''} ${tdsEntry.financialYear || ''}`.trim(),
    }).catch(() => {});

    logger.info(`TDS filing recorded: ${tdsEntry.entryNumber}`);
    return tdsEntry;
  }
  
  /**
   * Get TDS entries with filters
   */
  async getTDSEntries(filters = {}, pagination = {}) {
    const {
      status,
      section,
      quarter,
      financialYear,
      dateFrom,
      dateTo,
      pan,
    } = filters;
    
    const {
      page = 1,
      limit = 20,
      sortBy = 'transactionDate',
      sortOrder = 'desc',
    } = pagination;
    
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (section) {
      query.section = section;
    }
    
    if (quarter) {
      query.quarter = quarter;
    }
    
    if (financialYear) {
      query.financialYear = financialYear;
    }
    
    if (dateFrom || dateTo) {
      query.transactionDate = {};
      if (dateFrom) query.transactionDate.$gte = new Date(dateFrom);
      if (dateTo) query.transactionDate.$lte = new Date(dateTo);
    }
    
    if (pan) {
      query['deductee.pan'] = pan;
    }
    
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    const [entries, total] = await Promise.all([
      TDSEntry.find(query)
        .populate('createdBy', 'name email')
        .populate('expenseAccount', 'code name')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      TDSEntry.countDocuments(query),
    ]);
    
    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }
  
  /**
   * Get TDS dashboard summary
   */
  async getTDSDashboardSummary(quarter, financialYear) {
    try {
      // Get all TDS entries for the quarter
      const entries = await TDSEntry.find({
        quarter,
        financialYear,
      });

      // Calculate totals
      let totalDeducted = new Decimal(0);
      let totalPaid = new Decimal(0);
      let pendingPayment = new Decimal(0);
      let pendingEntries = 0;

      const sectionMap = {};
      const byStatus = {
        pending: 0,
        deducted: 0,
        deposited: 0,
        filed: 0,
      };

      entries.forEach(entry => {
        const tdsAmount = new Decimal(entry.tdsAmount || 0);

        // Count by status
        if (byStatus[entry.status] !== undefined) {
          byStatus[entry.status]++;
        }

        // Calculate totals
        if (entry.status === 'deducted' || entry.status === 'deposited' || entry.status === 'filed') {
          totalDeducted = totalDeducted.plus(tdsAmount);
        }

        if (entry.status === 'deposited' || entry.status === 'filed') {
          totalPaid = totalPaid.plus(tdsAmount);
        }

        if (entry.status === 'deducted') {
          pendingPayment = pendingPayment.plus(tdsAmount);
        }

        if (entry.status === 'pending') {
          pendingEntries++;
        }

        // Group by section
        if (!sectionMap[entry.section]) {
          sectionMap[entry.section] = {
            section: entry.section,
            name: this.getSectionName(entry.section),
            deducted: new Decimal(0),
            paid: new Decimal(0),
            pending: new Decimal(0),
          };
        }
        
        sectionMap[entry.section].deducted = sectionMap[entry.section].deducted.plus(tdsAmount);
        
        if (entry.status === 'deposited' || entry.status === 'filed') {
          sectionMap[entry.section].paid = sectionMap[entry.section].paid.plus(tdsAmount);
        } else if (entry.status === 'deducted') {
          sectionMap[entry.section].pending = sectionMap[entry.section].pending.plus(tdsAmount);
        }
      });

      // Convert section data to array
      const bySection = Object.values(sectionMap).map(s => ({
        section: s.section,
        name: s.name,
        deducted: parseFloat(s.deducted.toString()),
        paid: parseFloat(s.paid.toString()),
        pending: parseFloat(s.pending.toString()),
      }));

      // Calculate due dates for forms
      const quarterDueDates = {
        Q1: { month: 7, day: 31 },  // July 31
        Q2: { month: 10, day: 31 }, // October 31
        Q3: { month: 1, day: 31 },  // January 31
        Q4: { month: 5, day: 31 },  // May 31
      };

      const dueDate = quarterDueDates[quarter];
      const fyYear = parseInt(financialYear.replace('FY', '').split('-')[0]);
      const dueDateObj = new Date(fyYear + (quarter === 'Q4' ? 1 : 0), dueDate.month - 1, dueDate.day);

      return {
        quarter,
        financialYear,
        summary: {
          totalDeducted: parseFloat(totalDeducted.toString()),
          totalPaid: parseFloat(totalPaid.toString()),
          pendingPayment: parseFloat(pendingPayment.toString()),
          pendingCount: pendingEntries,
        },
        bySection,
        byStatus,
        filingStatus: {
          form24Q: {
            status: byStatus.filed > 0 ? 'filed' : 'pending',
            dueDate: dueDateObj.toISOString(),
          },
          form26Q: {
            status: byStatus.filed > 0 ? 'filed' : 'pending',
            dueDate: dueDateObj.toISOString(),
          },
          form27Q: {
            status: 'not_applicable',
            dueDate: null,
          },
        },
        entries: entries.map(e => ({
          _id: e._id.toString(),
          entryNumber: e.entryNumber,
          deductee: e.deductee.name,
          pan: e.deductee.pan,
          section: e.section,
          amount: parseFloat(e.paymentAmount),
          tdsRate: e.tdsRate,
          tdsAmount: parseFloat(e.tdsAmount),
          deductionDate: e.transactionDate,
          dueDate: dueDateObj,
          status: e.status,
          challanNo: e.challanNumber,
          paidDate: e.challanDate,
        })),
      };
    } catch (error) {
      logger.error('Get TDS dashboard summary error:', error);
      throw error;
    }
  }

  /**
   * Get section name
   */
  getSectionName(section) {
    const names = {
      '194A': 'Interest',
      '194C': 'Contractor',
      '194H': 'Commission',
      '194I': 'Rent',
      '194J': 'Professional',
      '192': 'Salary',
      '194Q': 'Purchase',
    };
    return names[section] || 'Other';
  }

  /**
   * Get TDS summary for quarter
   */
  async getTDSSummary(quarter, financialYear) {
    const summary = await TDSEntry.aggregate([
      {
        $match: {
          quarter,
          financialYear,
          status: { $in: ['deducted', 'deposited', 'filed'] },
        },
      },
      {
        $group: {
          _id: '$section',
          count: { $sum: 1 },
          totalPayment: { $sum: { $toDouble: '$paymentAmount' } },
          totalTDS: { $sum: { $toDouble: '$tdsAmount' } },
          totalNet: { $sum: { $toDouble: '$netPayable' } },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);
    
    // Calculate totals
    let totalPayment = new Decimal(0);
    let totalTDS = new Decimal(0);
    let totalNet = new Decimal(0);
    let totalCount = 0;
    
    summary.forEach(item => {
      totalPayment = totalPayment.plus(item.totalPayment);
      totalTDS = totalTDS.plus(item.totalTDS);
      totalNet = totalNet.plus(item.totalNet);
      totalCount += item.count;
    });
    
    return {
      bySection: summary,
      totals: {
        count: totalCount,
        totalPayment: totalPayment.toString(),
        totalTDS: totalTDS.toString(),
        totalNet: totalNet.toString(),
      },
    };
  }
  
  /**
   * Validate PAN format
   */
  validatePAN(pan) {
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return panRegex.test(pan);
  }
  
  /**
   * Generate Form 26Q data (TDS quarterly return)
   */
  async generateForm26Q(quarter, financialYear) {
    const entries = await TDSEntry.find({
      quarter,
      financialYear,
      status: { $in: ['deducted', 'deposited'] },
    }).sort({ transactionDate: 1 });
    
    // Group by deductee PAN
    const deducteeWise = {};
    
    entries.forEach(entry => {
      const pan = entry.deductee.pan;
      
      if (!deducteeWise[pan]) {
        deducteeWise[pan] = {
          pan,
          name: entry.deductee.name,
          entries: [],
          totalPayment: new Decimal(0),
          totalTDS: new Decimal(0),
        };
      }
      
      deducteeWise[pan].entries.push({
        entryNumber: entry.entryNumber,
        section: entry.section,
        date: entry.transactionDate,
        payment: entry.paymentAmount,
        tds: entry.tdsAmount,
      });
      
      deducteeWise[pan].totalPayment = deducteeWise[pan].totalPayment.plus(entry.paymentAmount);
      deducteeWise[pan].totalTDS = deducteeWise[pan].totalTDS.plus(entry.tdsAmount);
    });
    
    // Convert to array
    const deductees = Object.values(deducteeWise).map(d => ({
      ...d,
      totalPayment: d.totalPayment.toString(),
      totalTDS: d.totalTDS.toString(),
    }));
    
    return {
      quarter,
      financialYear,
      deductees,
      summary: {
        totalEntries: entries.length,
        totalDeductees: deductees.length,
      },
    };
  }
}

export default new TDSService();
