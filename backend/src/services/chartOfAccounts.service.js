import ChartOfAccounts from '../models/ChartOfAccounts.js';
import logger from '../config/logger.js';
import cacheService from './cache.service.js';

class ChartOfAccountsService {
  /**
   * Get all accounts with optional filters
   */
  async getAllAccounts(filters = {}) {
    const { type, isActive, search } = filters;

    const query = {};

    if (type) {
      query.type = type;
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { code: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const accounts = await ChartOfAccounts.find(query)
      .populate('parentAccount', 'code name')
      .sort({ code: 1 });

    return accounts;
  }

  /**
   * Get a single account by ID
   */
  async getAccountById(accountId) {
    const account = await ChartOfAccounts.findById(accountId).populate(
      'parentAccount',
      'code name'
    );

    if (!account) {
      throw new Error('Account not found');
    }

    return account;
  }

  /**
   * Create a new account
   */
  async createAccount(accountData) {
    const { code, name, type, subtype, normalBalance, parentAccount, description } = accountData;

    // Check if code already exists
    const existingAccount = await ChartOfAccounts.findOne({ code });
    if (existingAccount) {
      throw new Error(`Account with code ${code} already exists`);
    }

    const account = await ChartOfAccounts.create({
      code,
      name,
      type,
      subtype,
      normalBalance,
      parentAccount,
      description,
    });

    logger.info(`Chart of account created: ${code} - ${name}`);
    
    // Invalidate accounts cache
    await cacheService.invalidateAccountsCaches();

    return account;
  }

  /**
   * Update an account
   */
  async updateAccount(accountId, updateData) {
    const account = await ChartOfAccounts.findById(accountId);

    if (!account) {
      throw new Error('Account not found');
    }

    // If code is being changed, check for duplicates
    if (updateData.code && updateData.code !== account.code) {
      const existingAccount = await ChartOfAccounts.findOne({
        code: updateData.code,
      });
      if (existingAccount) {
        throw new Error(`Account with code ${updateData.code} already exists`);
      }
    }

    Object.assign(account, updateData);
    await account.save();

    logger.info(`Chart of account updated: ${account.code}`);
    
    // Invalidate accounts cache
    await cacheService.invalidateAccountsCaches();

    return account;
  }

  /**
   * Deactivate an account (soft delete)
   */
  async deactivateAccount(accountId) {
    const account = await ChartOfAccounts.findById(accountId);

    if (!account) {
      throw new Error('Account not found');
    }

    account.isActive = false;
    await account.save();

    logger.info(`Chart of account deactivated: ${account.code}`);
    
    // Invalidate accounts cache
    await cacheService.invalidateAccountsCaches();

    return account;
  }

  /**
   * Seed default chart of accounts
   */
  async seedDefaultAccounts() {
    const defaultAccounts = [
      // Assets
      { code: '1000', name: 'Cash', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1500', name: 'Inventory', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1600', name: 'Prepaid Expenses', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
      { code: '1800', name: 'Equipment', type: 'Asset', subtype: 'Fixed Asset', normalBalance: 'debit' },
      { code: '1810', name: 'Accumulated Depreciation - Equipment', type: 'Asset', subtype: 'Fixed Asset', normalBalance: 'credit' },

      // Liabilities
      { code: '2000', name: 'Accounts Payable', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2100', name: 'Accrued Expenses', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2200', name: 'Unearned Revenue', type: 'Liability', subtype: 'Current Liability', normalBalance: 'credit' },
      { code: '2500', name: 'Long-term Debt', type: 'Liability', subtype: 'Long-term Liability', normalBalance: 'credit' },

      // Equity
      { code: '3000', name: 'Owner\'s Capital', type: 'Equity', subtype: 'Equity', normalBalance: 'credit' },
      { code: '3100', name: 'Retained Earnings', type: 'Equity', subtype: 'Equity', normalBalance: 'credit' },
      { code: '3900', name: 'Owner\'s Drawings', type: 'Expense', subtype: 'Contra Equity', normalBalance: 'debit' },

      // Income
      { code: '4000', name: 'Sales Revenue', type: 'Income', subtype: 'Operating Revenue', normalBalance: 'credit' },
      { code: '4100', name: 'Service Revenue', type: 'Income', subtype: 'Operating Revenue', normalBalance: 'credit' },
      { code: '4900', name: 'Other Income', type: 'Income', subtype: 'Non-Operating Revenue', normalBalance: 'credit' },

      // Expenses
      { code: '5000', name: 'Cost of Goods Sold', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6000', name: 'Salaries Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6100', name: 'Rent Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6200', name: 'Utilities Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6300', name: 'Office Supplies Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6400', name: 'Depreciation Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6500', name: 'Marketing Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6600', name: 'Insurance Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6700', name: 'Professional Fees', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      { code: '6800', name: 'Interest Expense', type: 'Expense', subtype: 'Non-Operating Expense', normalBalance: 'debit' },
      { code: '6900', name: 'Miscellaneous Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
    ];

    // Only count shared (system) accounts: workspace-created custom accounts
    // must never block seeding of the shared chart.
    const existingCount = await ChartOfAccounts.countDocuments({ companyId: null });
    if (existingCount > 0) {
      logger.info('Chart of accounts already seeded');
      return { message: 'Chart of accounts already exists', count: existingCount };
    }

    // Explicit null keeps seeds shared (no workspace stamping).
    const accounts = await ChartOfAccounts.insertMany(
      defaultAccounts.map((account) => ({ ...account, companyId: null }))
    );
    logger.info(`Seeded ${accounts.length} default accounts`);

    return { message: 'Default accounts seeded successfully', count: accounts.length };
  }
}

export default new ChartOfAccountsService();