import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Invoice from '../src/models/Invoice.js';
import Expense from '../src/models/Expense.js';
import GSTReturn from '../src/models/GSTReturn.js';
import TDSEntry from '../src/models/TDSEntry.js';
import companySettingsService from '../src/services/companySettings.service.js';
import { runWithScope } from '../src/utils/companyScope.js';
import chartOfAccountsService from '../src/services/chartOfAccounts.service.js';
import ledgerService from '../src/services/ledger.service.js';
import invoiceService from '../src/services/invoice.service.js';
import expenseService from '../src/services/expense.service.js';
import logger from '../src/config/logger.js';

dotenv.config();

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Database connected');

    // Clear existing data (development only!)
    if (process.env.NODE_ENV === 'development') {
      await User.deleteMany({});
      await mongoose.connection.db.dropDatabase();
      logger.info('Existing data cleared');
    }

    // Create admin user
    const admin = await User.create({
      email: process.env.ADMIN_EMAIL || 'admin@artha.local',
      password: process.env.ADMIN_PASSWORD || 'Admin@123456',
      name: 'Admin User',
      role: 'admin',
    });
    logger.info(`Admin user created: ${admin.email}`);

    // Create accountant user
    const accountant = await User.create({
      email: 'accountant@artha.local',
      password: 'Accountant@123456',
      name: 'Accountant User',
      role: 'accountant',
    });
    logger.info(`Accountant user created: ${accountant.email}`);

    // Create viewer user
    const viewer = await User.create({
      email: 'viewer@artha.local',
      password: 'Viewer@123456',
      name: 'Viewer User',
      role: 'viewer',
    });
    logger.info(`Viewer user created: ${viewer.email}`);

    // Seed chart of accounts
    await chartOfAccountsService.seedDefaultAccounts();

    // Get accounts for sample entries
    const ChartOfAccounts = mongoose.model('ChartOfAccounts');
    const cash = await ChartOfAccounts.findOne({ code: '1000' });
    const capital = await ChartOfAccounts.findOne({ code: '3000' });
    const salesRevenue = await ChartOfAccounts.findOne({ code: '4000' });
    const rentExpense = await ChartOfAccounts.findOne({ code: '6100' });
    const salariesExpense = await ChartOfAccounts.findOne({ code: '6000' });

    // Create sample journal entries
    // Entry 1: Initial capital investment
    const entry1 = await ledgerService.createJournalEntry(
      {
        date: new Date('2025-01-01'),
        description: 'Initial capital investment',
        lines: [
          { account: cash._id, debit: '100000', credit: '0', description: 'Cash received' },
          {
            account: capital._id,
            debit: '0',
            credit: '100000',
            description: "Owner's investment",
          },
        ],
        reference: 'INVEST-001',
        tags: ['capital', 'initial'],
      },
      admin._id
    );
    await ledgerService.validateJournalEntry(entry1._id, admin._id);
    await ledgerService.postJournalEntry(entry1._id, admin._id);
    logger.info('Sample entry 1 created and posted');

    // Entry 2: Sales revenue
    const entry2 = await ledgerService.createJournalEntry(
      {
        date: new Date('2025-01-15'),
        description: 'Cash sales for January',
        lines: [
          { account: cash._id, debit: '25000', credit: '0', description: 'Cash received' },
          {
            account: salesRevenue._id,
            debit: '0',
            credit: '25000',
            description: 'Sales revenue',
          },
        ],
        reference: 'SALE-001',
        tags: ['revenue', 'cash-sale'],
      },
      accountant._id
    );
    await ledgerService.validateJournalEntry(entry2._id, accountant._id);
    await ledgerService.postJournalEntry(entry2._id, accountant._id);
    logger.info('Sample entry 2 created and posted');

    // Entry 3: Rent expense
    const entry3 = await ledgerService.createJournalEntry(
      {
        date: new Date('2025-01-31'),
        description: 'Monthly rent payment',
        lines: [
          {
            account: rentExpense._id,
            debit: '5000',
            credit: '0',
            description: 'Rent for January',
          },
          { account: cash._id, debit: '0', credit: '5000', description: 'Cash paid' },
        ],
        reference: 'RENT-JAN-2025',
        tags: ['expense', 'rent'],
      },
      accountant._id
    );
    await ledgerService.validateJournalEntry(entry3._id, accountant._id);
    await ledgerService.postJournalEntry(entry3._id, accountant._id);
    logger.info('Sample entry 3 created and posted');

    // Entry 4: Salaries expense
    const entry4 = await ledgerService.createJournalEntry(
      {
        date: new Date('2025-01-31'),
        description: 'Monthly salary payment',
        lines: [
          {
            account: salariesExpense._id,
            debit: '15000',
            credit: '0',
            description: 'Salaries for January',
          },
          { account: cash._id, debit: '0', credit: '15000', description: 'Cash paid' },
        ],
        reference: 'SAL-JAN-2025',
        tags: ['expense', 'salaries'],
      },
      accountant._id
    );
    await ledgerService.validateJournalEntry(entry4._id, accountant._id);
    await ledgerService.postJournalEntry(entry4._id, accountant._id);
    logger.info('Sample entry 4 created and posted');

    // Create company settings FIRST — required for GST calculations in invoice/expense.
    // Written through the service so it lands on the exact document getSettings
    // reads: the legacy `_id: 'company_settings'` singleton (scripts have no
    // request scope) plus the owner admin's workspace copy (UI requests are scoped).
    const companySettings = {
      companyName: 'Artha Accounting Pvt Ltd',
      legalName: 'Artha Accounting Private Limited',
      address: {
        street: '123 Business Park, Sector 5',
        city: 'Mumbai',
        state: 'MH',
        postalCode: '400001',
        country: 'India'
      },
      phone: '+91-22-12345678',
      email: 'info@artha.local',
      gstin: '27AABCU9603R1ZX',
      pan: 'AABCU9603R',
      tan: 'MUMA12345E',
      gstSettings: {
        isRegistered: true,
        filingFrequency: 'monthly',
        compositionScheme: false
      },
      tdsSettings: {
        isTANActive: true,
        defaultTDSRate: 10,
        autoCalculateTDS: true
      }
    };
    await companySettingsService.updateSettings(companySettings);
    await runWithScope({ workspace: admin._id }, () => companySettingsService.updateSettings(companySettings));
    logger.info('Company settings created');

    // Create sample invoice
    const sampleInvoice = await Invoice.create({
      invoiceNumber: 'INV-2025-001',
      invoiceDate: new Date('2025-01-20'),
      dueDate: new Date('2025-02-20'),
      customerName: 'Acme Corporation',
      customerEmail: 'billing@acme.com',
      customerGSTIN: '27AABCA1234A1Z5',
      customerState: 'MH',
      customerAddress: {
        street: '123 Business Park',
        city: 'Mumbai',
        state: 'Maharashtra',
        zipCode: '400001',
        country: 'India',
      },
      items: [
        {
          description: 'Consulting Services - January 2025',
          quantity: 40,
          unitPrice: '2000.00',
          amount: '80000.00',
        },
        {
          description: 'Software License',
          quantity: 1,
          unitPrice: '10000.00',
          amount: '10000.00',
        },
      ],
      subtotal: '90000.00',
      taxRate: 18,
      taxAmount: '16200.00',
      totalAmount: '106200.00',
      notes: 'Payment terms: Net 30 days',
      createdBy: accountant._id,
    });

    // Send the invoice (creates AR entry)
    await invoiceService.sendInvoice(sampleInvoice._id, accountant._id);
    logger.info('Sample invoice created and sent');

    // Create sample expense
    const officeSupplies = await ChartOfAccounts.findOne({ code: '6300' });
    const sampleExpense = await Expense.create({
      expenseNumber: 'EXP-2025-001',
      date: new Date('2025-01-25'),
      category: 'supplies',
      vendor: 'Office Depot',
      description: 'Office supplies and stationery',
      amount: '5000.00',
      taxAmount: '0.00',
      totalAmount: '5000.00',
      paymentMethod: 'credit_card',
      status: 'approved',
      submittedBy: accountant._id,
      approvedBy: admin._id,
      approvedAt: new Date(),
      account: officeSupplies._id,
      notes: 'Monthly office supplies purchase',
    });

    // Record expense in ledger
    await expenseService.recordExpense(sampleExpense._id, admin._id);
    logger.info('Sample expense created and recorded');

    // Create sample GST return
    await GSTReturn.create({
      returnType: 'GSTR1',
      period: { month: 12, year: 2024 },
      gstin: '27AABCU9603R1ZX',
      b2b: [{
        customerGSTIN: '29AABCU9603R1ZY',
        customerName: 'Acme Corporation',
        invoiceNumber: 'INV-2025-001',
        invoiceDate: new Date('2025-01-20'),
        invoiceValue: '106200.00',
        taxableValue: '90000.00',
        cgst: '8100.00',
        sgst: '8100.00',
        igst: '0.00'
      }],
      status: 'draft',
      filedBy: accountant._id
    });
    logger.info('Sample GST return created');

    // Create sample TDS entry
    await TDSEntry.create({
      transactionDate: new Date('2025-01-25'),
      deductee: {
        name: 'Professional Consultant',
        pan: 'ABCDE1234F',
        address: '456 Consultant Street, Mumbai'
      },
      section: '194J',
      nature: 'Professional Fees',
      paymentAmount: '50000.00',
      tdsRate: 10,
      tdsAmount: '5000.00',
      status: 'deducted',
      quarter: 'Q4',
      financialYear: '2024-25',
      createdBy: accountant._id,
      notes: 'Consulting services for system implementation'
    });
    logger.info('Sample TDS entry created');

    // Verify ledger chain
    const verification = await ledgerService.verifyLedgerChain();
    logger.info('Ledger chain verification:', verification);

    // Get summary
    const summary = await ledgerService.getLedgerSummary();
    logger.info('Ledger summary:', summary);

    logger.info('✅ Database seeded successfully!');
    logger.info('\nSeed data created. Check your .env file for admin credentials.');
    logger.info('\nIndia Compliance Data:');
    logger.info('Company GSTIN: 27AABCU9603R1ZX');
    logger.info('Company PAN: AABCU9603R');
    logger.info('Company TAN: MUMA12345E');
    logger.info('Sample GST Return: GSTR1 for Dec 2024');
    logger.info('Sample TDS Entry: Professional fees with 10% TDS');
    
    process.exit(0);
  } catch (error) {
    logger.error('Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();