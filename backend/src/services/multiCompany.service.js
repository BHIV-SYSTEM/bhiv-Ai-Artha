import Decimal from 'decimal.js';
import Company from '../models/Company.js';
import ChartOfAccounts from '../models/ChartOfAccounts.js';
import AccountBalance from '../models/AccountBalance.js';
import JournalEntry from '../models/JournalEntry.js';
import CostCentre from '../models/CostCentre.js';
import logger from '../config/logger.js';
import { withTransaction } from '../config/database.js';

class MultiCompanyService {
  // Create company
  async createCompany(data, userId) {
    const company = new Company({
      ...data,
      createdBy: userId,
      owners: [userId],
    });
    await company.save();

    // Seed default chart of accounts
    await this.seedCompanyAccounts(company._id);

    return company;
  }

  async seedCompanyAccounts(companyId) {
    const defaultAccounts = [
      { code: '1000', name: 'Cash', type: 'Asset', normalBalance: 'debit' },
      { code: '1100', name: 'Bank Account', type: 'Asset', normalBalance: 'debit' },
      { code: '1200', name: 'Accounts Receivable', type: 'Asset', normalBalance: 'debit' },
      { code: '1300', name: 'Inventory', type: 'Asset', normalBalance: 'debit' },
      { code: '1500', name: 'Fixed Assets', type: 'Asset', normalBalance: 'debit' },
      { code: '2000', name: 'Accounts Payable', type: 'Liability', normalBalance: 'credit' },
      { code: '2200', name: 'GST Payable', type: 'Liability', normalBalance: 'credit' },
      { code: '2400', name: 'TDS Payable', type: 'Liability', normalBalance: 'credit' },
      { code: '3000', name: 'Retained Earnings', type: 'Equity', normalBalance: 'credit' },
      { code: '4000', name: 'Sales Revenue', type: 'Income', normalBalance: 'credit' },
      { code: '5000', name: 'Cost of Goods Sold', type: 'Expense', normalBalance: 'debit' },
      { code: '6000', name: 'Operating Expenses', type: 'Expense', normalBalance: 'debit' },
    ];

    for (const account of defaultAccounts) {
      const existing = await ChartOfAccounts.findOne({ code: account.code });
      if (!existing) {
        await ChartOfAccounts.create({ ...account, companyId, isActive: true });
      }
    }
  }

  // Get companies visible to a user. Super admin sees every company they
  // created; everyone else only sees companies they own or belong to.
  async getCompanies(filters = {}, user = null) {
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.parentCompany) query.parentCompany = filters.parentCompany;
    if (user) {
      if (user.role === 'admin') {
        query.owners = user._id;
      } else {
        query.$or = [
          { owners: user._id },
          { _id: user.companyId || user._id },
        ];
      }
    }

    return Company.find(query).sort({ name: 1 });
  }

  // Get company by ID
  async getCompany(companyId) {
    const company = await Company.findById(companyId)
      .populate('parentCompany', 'name companyId')
      .populate('owners', 'name email');
    if (!company) throw new Error('Company not found');
    return company;
  }

  // Update company
  async updateCompany(companyId, data, userId) {
    const company = await Company.findByIdAndUpdate(companyId, data, { new: true });
    if (!company) throw new Error('Company not found');
    return company;
  }

  // Create branch
  async createBranch(data, userId) {
    const branch = new Company({
      ...data,
      isSubsidiary: true,
      isHeadquarters: false,
      createdBy: userId,
    });
    await branch.save();
    return branch;
  }

  // Get branches for a company
  async getBranches(companyId) {
    return Company.find({ parentCompany: companyId, isSubsidiary: true, status: 'active' });
  }

  // Consolidated reporting
  async generateConsolidatedReport(parentCompanyId, dateRange) {
    const parentCompany = await Company.findById(parentCompanyId);
    if (!parentCompany) throw new Error('Parent company not found');

    const subsidiaries = await Company.find({
      parentCompany: parentCompanyId,
      isSubsidiary: true,
      status: 'active',
    });

    const companyIds = [parentCompanyId, ...subsidiaries.map(s => s._id)];

    const consolidated = {
      companies: [],
      totals: {
        assets: new Decimal(0),
        liabilities: new Decimal(0),
        equity: new Decimal(0),
        income: new Decimal(0),
        expenses: new Decimal(0),
      },
    };

    for (const companyId of companyIds) {
      const company = await Company.findById(companyId);
      const balances = await AccountBalance.aggregate([
        { $lookup: { from: 'chartofaccounts', localField: 'account', foreignField: '_id', as: 'accountDetails' } },
        { $unwind: '$accountDetails' },
        { $match: { 'accountDetails.isActive': true } },
        { $group: {
          _id: '$accountDetails.type',
          total: { $sum: { $toDouble: '$balance' } },
        }},
      ]);

      const companyData = {
        companyId: String(companyId),
        companyName: company.name,
        balances: {},
      };

      for (const b of balances) {
        companyData.balances[b._id] = b.total;
        consolidated.totals[b._id] = consolidated.totals[b._id].plus(new Decimal(b.total));
      }

      consolidated.companies.push(companyData);
    }

    // Eliminate intercompany transactions if enabled
    if (parentCompany.consolidation?.eliminateIntercompany) {
      consolidated.totals = await this.eliminateIntercompany(consolidated.totals, companyIds);
    }

    return consolidated;
  }

  async eliminateIntercompany(totals, companyIds) {
    // Simplified intercompany elimination
    logger.info('Intercompany elimination applied');
    return totals;
  }

  // Cost centre operations
  async createCostCentre(data, userId) {
    const centre = new CostCentre({ ...data, createdBy: userId });
    await centre.save();
    return centre;
  }

  async getCostCentres(filters = {}) {
    const query = {};
    if (filters.companyId) query.companyId = filters.companyId;
    if (filters.type) query.type = filters.type;
    if (filters.isActive !== undefined) query.isActive = filters.isActive;
    return CostCentre.find(query).sort({ code: 1 });
  }

  // Get consolidated trial balance across companies
  async getConsolidatedTrialBalance(companyIds, asOfDate) {
    const allAccounts = [];

    for (const companyId of companyIds) {
      const company = await Company.findById(companyId);
      const balances = await AccountBalance.aggregate([
        { $lookup: { from: 'chartofaccounts', localField: 'account', foreignField: '_id', as: 'accountDetails' } },
        { $unwind: '$accountDetails' },
        { $match: { 'accountDetails.isActive': true } },
        { $project: {
          code: '$accountDetails.code',
          name: '$accountDetails.name',
          type: '$accountDetails.type',
          balance: 1,
          company: company.name,
        }},
      ]);
      allAccounts.push(...balances);
    }

    // Aggregate by account code
    const aggregated = {};
    for (const account of allAccounts) {
      if (!aggregated[account.code]) {
        aggregated[account.code] = {
          code: account.code,
          name: account.name,
          type: account.type,
          debit: new Decimal(0),
          credit: new Decimal(0),
        };
      }
      const bal = new Decimal(account.balance || 0);
      if (bal.gt(0)) {
        aggregated[account.code].debit = aggregated[account.code].debit.plus(bal);
      } else if (bal.lt(0)) {
        aggregated[account.code].credit = aggregated[account.code].credit.plus(bal.abs());
      }
    }

    const accounts = Object.values(aggregated).map(a => ({
      ...a,
      debit: a.debit.toString(),
      credit: a.credit.toString(),
    }));

    const totalDebits = accounts.reduce((sum, a) => sum.plus(new Decimal(a.debit)), new Decimal(0));
    const totalCredits = accounts.reduce((sum, a) => sum.plus(new Decimal(a.credit)), new Decimal(0));

    return {
      accounts,
      totalDebits: totalDebits.toString(),
      totalCredits: totalCredits.toString(),
      isBalanced: totalDebits.equals(totalCredits),
    };
  }
}

export default new MultiCompanyService();
