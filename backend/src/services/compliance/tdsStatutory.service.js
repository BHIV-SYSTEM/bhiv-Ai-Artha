import Decimal from 'decimal.js';
import TDSEntry from '../../models/TDSEntry.js';
import TDSChallan from '../../models/TDSChallan.js';
import ComplianceFiling from '../../models/ComplianceFiling.js';
import { buildTraceId, parseQuarterPeriod } from './period.util.js';
import traceabilityService from '../traceability.service.js';
import companySettingsService from '../companySettings.service.js';

const FORM26Q_SECTIONS = ['194A', '194C', '194H', '194I', '194J', '194Q', 'other'];

class TDSStatutoryService {
  async generateForm26Q(quarter, financialYear, userId, existingTraceId = null) {
    const { startDate, endDate } = parseQuarterPeriod(quarter, financialYear);
    const settings = await companySettingsService.getSettings();
    const traceId = existingTraceId || buildTraceId();

    const entries = await TDSEntry.find({
      transactionDate: { $gte: startDate, $lte: endDate },
      section: { $in: FORM26Q_SECTIONS },
    }).lean();

    const challans = await TDSChallan.find({ quarter, financialYear }).lean();
    const challanMap = new Map();
    challans.forEach((challan) => {
      (challan.tdsEntries || []).forEach((id) => challanMap.set(String(id), challan));
    });

    const deducteeMap = new Map();
    const sourceTransactions = [];

    entries.forEach((entry) => {
      const pan = entry.deductee?.pan;
      const key = `${pan}-${entry.section}`;
      const paymentAmount = new Decimal(entry.paymentAmount || 0);
      const tdsAmount = new Decimal(entry.tdsAmount || 0);
      const existing = deducteeMap.get(key) || {
        pan,
        name: entry.deductee?.name,
        section: entry.section,
        total_amount_paid: new Decimal(0),
        total_tds_deducted: new Decimal(0),
        entries: [],
      };

      existing.total_amount_paid = existing.total_amount_paid.plus(paymentAmount);
      existing.total_tds_deducted = existing.total_tds_deducted.plus(tdsAmount);
      existing.entries.push({
        entry_number: entry.entryNumber,
        transaction_date: entry.transactionDate?.toISOString().split('T')[0],
        amount_paid: paymentAmount.toString(),
        tds_deducted: tdsAmount.toString(),
        challan_number: entry.challanNumber || challanMap.get(String(entry._id))?.challanNumber,
        challan_date: entry.challanDate || challanMap.get(String(entry._id))?.challanDate,
        bank_bsr: entry.bankBSR || challanMap.get(String(entry._id))?.bankBSR,
      });

      deducteeMap.set(key, existing);
      sourceTransactions.push({ sourceType: 'TDSEntry', sourceId: String(entry._id) });
    });

    const deductees = Array.from(deducteeMap.values()).map((item) => ({
      pan: item.pan,
      name: item.name,
      section: item.section,
      amount_paid: item.total_amount_paid.toString(),
      tds_deducted: item.total_tds_deducted.toString(),
      entries: item.entries,
    }));

    const filing = {
      filing_type: 'FORM-26Q',
      quarter,
      financial_year: financialYear,
      tan: settings?.tan,
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      deductees,
    };

    const record = await ComplianceFiling.create({
      filingType: 'FORM-26Q',
      period: { startDate, endDate, quarter, year: undefined },
      tan: settings?.tan,
      traceId,
      generatedBy: userId,
      schemaVersion: filing.schema_version,
      generatedAt: new Date(),
      sourceTransactions,
      jsonData: filing,
    });

    // Initialize unified trace and record FILING_CREATED stage
    try {
      if (!existingTraceId) {
        await traceabilityService.initializeTrace({
          source: 'TDS_FILING',
          source_id: record._id,
          user_id: userId,
          metadata: { filing_type: 'FORM-26Q', quarter, financial_year: financialYear },
        });
      }
      await traceabilityService.addStage(traceId, {
        stage: 'FILING_CREATED',
        entity_type: 'ComplianceFiling',
        entity_id: String(record._id),
        status: 'SUCCESS',
        metadata: { filing_type: 'FORM-26Q', quarter, financial_year: financialYear, filing_id: record.filingId },
      });
    } catch (traceErr) {
      // Trace failures must not break filing generation
    }

    return { filing, traceId, filingId: record.filingId };
  }

  async generateForm24Q(quarter, financialYear, userId, existingTraceId = null) {
    const { startDate, endDate } = parseQuarterPeriod(quarter, financialYear);
    const settings = await companySettingsService.getSettings();
    const traceId = existingTraceId || buildTraceId();

    const entries = await TDSEntry.find({
      transactionDate: { $gte: startDate, $lte: endDate },
      section: '192',
    }).lean();

    const employees = entries.map((entry) => ({
      employee_pan: entry.deductee?.pan,
      employee_name: entry.deductee?.name,
      employee_id: entry.employeeDetails?.employeeId,
      salary_basic: entry.salaryDetails?.basic,
      salary_hra: entry.salaryDetails?.hra,
      perquisites: entry.salaryDetails?.perquisites,
      other_allowances: entry.salaryDetails?.otherAllowances,
      deductions: entry.salaryDetails?.deductions,
      employer_deductions: entry.salaryDetails?.employerDeductions,
      taxable_salary: entry.salaryDetails?.taxableSalary,
      tds_deducted: entry.tdsAmount,
      transaction_date: entry.transactionDate?.toISOString().split('T')[0],
      challan_number: entry.challanNumber,
      challan_date: entry.challanDate,
      bank_bsr: entry.bankBSR,
    }));

    const filing = {
      filing_type: 'FORM-24Q',
      quarter,
      financial_year: financialYear,
      tan: settings?.tan,
      schema_version: '1.0.0',
      generated_at: new Date().toISOString(),
      employees,
    };

    const record = await ComplianceFiling.create({
      filingType: 'FORM-24Q',
      period: { startDate, endDate, quarter, year: undefined },
      tan: settings?.tan,
      traceId,
      generatedBy: userId,
      schemaVersion: filing.schema_version,
      generatedAt: new Date(),
      sourceTransactions: entries.map((entry) => ({
        sourceType: 'TDSEntry',
        sourceId: String(entry._id),
      })),
      jsonData: filing,
    });

    // Initialize unified trace and record FILING_CREATED stage
    try {
      if (!existingTraceId) {
        await traceabilityService.initializeTrace({
          source: 'TDS_FILING',
          source_id: record._id,
          user_id: userId,
          metadata: { filing_type: 'FORM-24Q', quarter, financial_year: financialYear },
        });
      }
      await traceabilityService.addStage(traceId, {
        stage: 'FILING_CREATED',
        entity_type: 'ComplianceFiling',
        entity_id: String(record._id),
        status: 'SUCCESS',
        metadata: { filing_type: 'FORM-24Q', quarter, financial_year: financialYear, filing_id: record.filingId },
      });
    } catch (traceErr) {
      // Trace failures must not break filing generation
    }

    return { filing, traceId, filingId: record.filingId };
  }
}

export default new TDSStatutoryService();
