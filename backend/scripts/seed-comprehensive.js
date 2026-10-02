import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Counter from '../src/models/Counter.js';
import Invoice from '../src/models/Invoice.js';
import Expense from '../src/models/Expense.js';
import GSTReturn from '../src/models/GSTReturn.js';
import TDSEntry from '../src/models/TDSEntry.js';
import CompanySettings from '../src/models/CompanySettings.js';
import ChartOfAccounts from '../src/models/ChartOfAccounts.js';
import chartOfAccountsService from '../src/services/chartOfAccounts.service.js';
import ledgerService from '../src/services/ledger.service.js';
import logger from '../src/config/logger.js';
import { runWithScope } from '../src/utils/companyScope.js';

dotenv.config();

const CUSTOMERS = [
  { name: 'Mega Mart', email: 'billing@megamart.in', gstin: '07AAACB5678F1Z7', state: 'DL' },
  { name: 'Sunrise Distributors', email: 'accounts@sunrise.co.in', gstin: '07AAACB1234F1Z5', state: 'DL' },
  { name: 'Pacific Trading Co', email: 'finance@pacific.in', gstin: '27AABCP5678G1Z9', state: 'MH' },
  { name: 'Vertex Industries', email: 'ap@vertex.in', gstin: '29AABCV9012H1Z3', state: 'KA' },
  { name: 'National Supplies', email: 'pay@nationalsupplies.in', gstin: '24AABCN3456J1Z1', state: 'GJ' },
  { name: 'Apex Enterprises', email: 'accounts@apex.in', gstin: '33AABCA7890K1Z6', state: 'TN' },
  { name: 'Royal Traders', email: 'billing@royaltraders.in', gstin: '09AABCR2345L1Z8', state: 'UP' },
  { name: 'Summit Solutions', email: 'finance@summit.in', gstin: '36AABCS6789M1Z2', state: 'TS' },
];

const VENDORS = [
  { name: 'TechVista Solutions', category: 'software', desc: 'Cloud hosting and SaaS licenses' },
  { name: 'GreenLeaf Office', category: 'supplies', desc: 'Monthly office supplies and stationery' },
  { name: 'CityRent Properties', category: 'rent', desc: 'Office space rent - floor 3' },
  { name: 'QuickBooks India', category: 'software', desc: 'Accounting software annual license' },
  { name: 'SafeGuard Insurance', category: 'insurance', desc: 'Commercial vehicle and office insurance' },
  { name: 'DigitalWave Marketing', category: 'marketing', desc: 'Digital marketing campaign Q1' },
  { name: 'PowerGrid Utilities', category: 'utilities', desc: 'Electricity and internet bills' },
  { name: 'SkillPro Consulting', category: 'professional_services', desc: 'Tax advisory and compliance' },
  { name: 'CloudNine IT', category: 'software', desc: 'ERP system maintenance' },
  { name: 'FreshBites Catering', category: 'meals', desc: 'Team lunch and client meetings' },
];

function randomAmount(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomDate(year, month) {
  const day = Math.floor(Math.random() * 28) + 1;
  return new Date(year, month - 1, day);
}

const seedComprehensive = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Database connected for comprehensive seed');

    // 1. Ensure Chart of Accounts
    const acctCount = await ChartOfAccounts.countDocuments();
    if (acctCount === 0) {
      await chartOfAccountsService.seedDefaultAccounts();
      logger.info('Chart of Accounts seeded');
    } else {
      // Ensure required accounts exist
      const requiredCodes = ['1000', '1010', '1100', '3000', '4000', '6000', '6100', '6200', '6300', '6900'];
      const defaults = [
        { code: '1000', name: 'Cash', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
        { code: '1010', name: 'Bank Account', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
        { code: '1100', name: 'Accounts Receivable', type: 'Asset', subtype: 'Current Asset', normalBalance: 'debit' },
        { code: '3000', name: "Owner's Capital", type: 'Equity', subtype: 'Equity', normalBalance: 'credit' },
        { code: '4000', name: 'Sales Revenue', type: 'Income', subtype: 'Operating Revenue', normalBalance: 'credit' },
        { code: '6000', name: 'Salaries Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
        { code: '6100', name: 'Rent Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
        { code: '6200', name: 'Utilities Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
        { code: '6300', name: 'Office Supplies Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
        { code: '6900', name: 'Miscellaneous Expense', type: 'Expense', subtype: 'Operating Expense', normalBalance: 'debit' },
      ];
      for (const acct of defaults) {
        await ChartOfAccounts.findOneAndUpdate({ code: acct.code }, { $setOnInsert: acct }, { upsert: true });
      }
    }

    // 2. Ensure Users
    let admin = await User.findOne({ email: 'admin@artha.local' });
    if (!admin) {
      admin = await User.create({ email: 'admin@artha.local', password: 'Admin@123456', name: 'Admin User', role: 'admin' });
    }
    let accountant = await User.findOne({ email: 'accountant@artha.local' });
    if (!accountant) {
      accountant = await User.create({ email: 'accountant@artha.local', password: 'Accountant@123456', name: 'Rajesh Kumar', role: 'accountant', companyId: admin._id });
    } else if (!accountant.companyId) {
      accountant.companyId = admin._id;
      await accountant.save();
    }
    logger.info('Users ready');

    // 3. Ensure Company Settings (belongs to the admin's workspace)
    try {
      const settingsExists = await CompanySettings.findOne({ companyId: admin._id });
      if (!settingsExists) {
        await CompanySettings.create({
          companyId: admin._id,
          companyName: 'Bright Connection Pvt Ltd',
          name: 'Bright Connection Pvt Ltd',
          legalName: 'Bright Connection Private Limited',
          address: {
            line1: '42 Business Tower',
            street: '42 Business Tower',
            city: 'New Delhi',
            state: 'DL',
            pincode: '110001',
            postalCode: '110001',
            country: 'India',
          },
          phone: '+91-11-98765432',
          email: 'info@brightconnection.in',
          gstin: '07AABCB1234F1Z5',
          pan: 'AABCB1234F',
          tan: 'DELH12345E',
          gstSettings: { isRegistered: true, filingFrequency: 'quarterly', compositionScheme: false },
          tdsSettings: { isTANActive: true, defaultTDSRate: 10, autoCalculateTDS: true },
        });
        logger.info('Company settings created');
      }
    } catch (e) {
      logger.warn(`Company settings: ${e.message}`);
    }

    // ─── All demo data below is stamped into the admin's workspace so
    // every other account starts from zero. ─────────────────────────────
    await runWithScope(
      { workspace: admin._id, userId: admin._id, role: 'admin', crossCompany: false },
      async () => {

    // 4. Get accounts (with fallbacks)
    const arAccount = await ChartOfAccounts.findOne({ code: '1100' }) || await ChartOfAccounts.findOne({ type: 'Asset' });
    const revenueAccount = await ChartOfAccounts.findOne({ code: '4000' }) || await ChartOfAccounts.findOne({ type: 'Income' });
    const cashAccount = await ChartOfAccounts.findOne({ code: '1000' }) || await ChartOfAccounts.findOne({ type: 'Asset' });
    const bankAccount = await ChartOfAccounts.findOne({ code: '1010' }) || cashAccount;
    const capitalAccount = await ChartOfAccounts.findOne({ code: '3000' }) || await ChartOfAccounts.findOne({ type: 'Equity' });
    const rentExpense = await ChartOfAccounts.findOne({ code: '6100' }) || await ChartOfAccounts.findOne({ type: 'Expense' });
    const salariesExpense = await ChartOfAccounts.findOne({ code: '6000' }) || rentExpense;
    const utilitiesExpense = await ChartOfAccounts.findOne({ code: '6200' }) || rentExpense;
    const suppliesExpense = await ChartOfAccounts.findOne({ code: '6300' }) || rentExpense;
    const miscExpense = await ChartOfAccounts.findOne({ code: '6900' }) || rentExpense;

    const requiredAccounts = [arAccount, revenueAccount, bankAccount, capitalAccount, rentExpense, salariesExpense];
    if (requiredAccounts.some(a => !a)) {
      logger.error('Required accounts missing. Run: npm run seed first');
      process.exit(1);
    }

    // ─── JOURNAL ENTRIES (spread across months) ──────────────────
    logger.info('Creating journal entries...');
    const journalEntries = [
      { date: new Date('2026-01-05'), desc: 'Capital investment by owner', lines: [
        { account: bankAccount._id, debit: '500000', credit: '0', description: 'Bank deposit' },
        { account: capitalAccount._id, debit: '0', credit: '500000', description: "Owner's capital" },
      ], ref: 'CAP-2026-001', tags: ['capital'] },
      { date: new Date('2026-01-15'), desc: 'January sales - Mega Mart', lines: [
        { account: arAccount._id, debit: '180000', credit: '0', description: 'AR - Mega Mart' },
        { account: revenueAccount._id, debit: '0', credit: '180000', description: 'Sales revenue' },
      ], ref: 'SALE-JAN-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-01-20'), desc: 'January sales - Sunrise Distributors', lines: [
        { account: arAccount._id, debit: '95000', credit: '0', description: 'AR - Sunrise' },
        { account: revenueAccount._id, debit: '0', credit: '95000', description: 'Sales revenue' },
      ], ref: 'SALE-JAN-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-01-25'), desc: 'Receipt from Mega Mart - January', lines: [
        { account: bankAccount._id, debit: '180000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '180000', description: 'AR reduction' },
      ], ref: 'RCV-JAN-001', tags: ['receipt'] },
      { date: new Date('2026-01-31'), desc: 'Office rent - January', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-JAN-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-01-31'), desc: 'Staff salaries - January', lines: [
        { account: salariesExpense._id, debit: '320000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '320000', description: 'Bank payment' },
      ], ref: 'EXP-JAN-SAL', tags: ['expense', 'salaries'] },
      { date: new Date('2026-01-31'), desc: 'Electricity bill - January', lines: [
        { account: utilitiesExpense._id, debit: '12000', credit: '0', description: 'Electricity' },
        { account: bankAccount._id, debit: '0', credit: '12000', description: 'Bank payment' },
      ], ref: 'EXP-JAN-UTIL', tags: ['expense', 'utilities'] },

      // February
      { date: new Date('2026-02-10'), desc: 'February sales - Pacific Trading', lines: [
        { account: arAccount._id, debit: '220000', credit: '0', description: 'AR - Pacific' },
        { account: revenueAccount._id, debit: '0', credit: '220000', description: 'Sales revenue' },
      ], ref: 'SALE-FEB-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-02-14'), desc: 'February sales - Vertex Industries', lines: [
        { account: arAccount._id, debit: '135000', credit: '0', description: 'AR - Vertex' },
        { account: revenueAccount._id, debit: '0', credit: '135000', description: 'Sales revenue' },
      ], ref: 'SALE-FEB-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-02-18'), desc: 'Receipt from Pacific Trading', lines: [
        { account: bankAccount._id, debit: '220000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '220000', description: 'AR reduction' },
      ], ref: 'RCV-FEB-001', tags: ['receipt'] },
      { date: new Date('2026-02-28'), desc: 'Office rent - February', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-FEB-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-02-28'), desc: 'Staff salaries - February', lines: [
        { account: salariesExpense._id, debit: '320000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '320000', description: 'Bank payment' },
      ], ref: 'EXP-FEB-SAL', tags: ['expense', 'salaries'] },
      { date: new Date('2026-02-28'), desc: 'Marketing campaign - February', lines: [
        { account: miscExpense._id, debit: '35000', credit: '0', description: 'Marketing' },
        { account: bankAccount._id, debit: '0', credit: '35000', description: 'Bank payment' },
      ], ref: 'EXP-FEB-MKT', tags: ['expense', 'marketing'] },

      // March
      { date: new Date('2026-03-08'), desc: 'March sales - National Supplies', lines: [
        { account: arAccount._id, debit: '275000', credit: '0', description: 'AR - National' },
        { account: revenueAccount._id, debit: '0', credit: '275000', description: 'Sales revenue' },
      ], ref: 'SALE-MAR-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-03-12'), desc: 'March sales - Apex Enterprises', lines: [
        { account: arAccount._id, debit: '160000', credit: '0', description: 'AR - Apex' },
        { account: revenueAccount._id, debit: '0', credit: '160000', description: 'Sales revenue' },
      ], ref: 'SALE-MAR-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-03-20'), desc: 'Receipt from National Supplies', lines: [
        { account: bankAccount._id, debit: '275000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '275000', description: 'AR reduction' },
      ], ref: 'RCV-MAR-001', tags: ['receipt'] },
      { date: new Date('2026-03-31'), desc: 'Office rent - March', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-MAR-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-03-31'), desc: 'Staff salaries - March', lines: [
        { account: salariesExpense._id, debit: '340000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '340000', description: 'Bank payment' },
      ], ref: 'EXP-MAR-SAL', tags: ['expense', 'salaries'] },

      // April
      { date: new Date('2026-04-05'), desc: 'April sales - Royal Traders', lines: [
        { account: arAccount._id, debit: '190000', credit: '0', description: 'AR - Royal' },
        { account: revenueAccount._id, debit: '0', credit: '190000', description: 'Sales revenue' },
      ], ref: 'SALE-APR-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-04-15'), desc: 'April sales - Summit Solutions', lines: [
        { account: arAccount._id, debit: '145000', credit: '0', description: 'AR - Summit' },
        { account: revenueAccount._id, debit: '0', credit: '145000', description: 'Sales revenue' },
      ], ref: 'SALE-APR-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-04-25'), desc: 'Receipt from Royal Traders', lines: [
        { account: bankAccount._id, debit: '190000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '190000', description: 'AR reduction' },
      ], ref: 'RCV-APR-001', tags: ['receipt'] },
      { date: new Date('2026-04-30'), desc: 'Office rent - April', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-APR-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-04-30'), desc: 'Staff salaries - April', lines: [
        { account: salariesExpense._id, debit: '340000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '340000', description: 'Bank payment' },
      ], ref: 'EXP-APR-SAL', tags: ['expense', 'salaries'] },

      // May
      { date: new Date('2026-05-10'), desc: 'May sales - Mega Mart', lines: [
        { account: arAccount._id, debit: '310000', credit: '0', description: 'AR - Mega Mart' },
        { account: revenueAccount._id, debit: '0', credit: '310000', description: 'Sales revenue' },
      ], ref: 'SALE-MAY-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-05-20'), desc: 'Receipt from Mega Mart', lines: [
        { account: bankAccount._id, debit: '310000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '310000', description: 'AR reduction' },
      ], ref: 'RCV-MAY-001', tags: ['receipt'] },
      { date: new Date('2026-05-31'), desc: 'Office rent - May', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-MAY-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-05-31'), desc: 'Staff salaries - May', lines: [
        { account: salariesExpense._id, debit: '350000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '350000', description: 'Bank payment' },
      ], ref: 'EXP-MAY-SAL', tags: ['expense', 'salaries'] },

      // June
      { date: new Date('2026-06-08'), desc: 'June sales - Sunrise Distributors', lines: [
        { account: arAccount._id, debit: '175000', credit: '0', description: 'AR - Sunrise' },
        { account: revenueAccount._id, debit: '0', credit: '175000', description: 'Sales revenue' },
      ], ref: 'SALE-JUN-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-06-18'), desc: 'Receipt from Sunrise', lines: [
        { account: bankAccount._id, debit: '175000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '175000', description: 'AR reduction' },
      ], ref: 'RCV-JUN-001', tags: ['receipt'] },
      { date: new Date('2026-06-30'), desc: 'Office rent - June', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-JUN-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-06-30'), desc: 'Staff salaries - June', lines: [
        { account: salariesExpense._id, debit: '350000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '350000', description: 'Bank payment' },
      ], ref: 'EXP-JUN-SAL', tags: ['expense', 'salaries'] },

      // July
      { date: new Date('2026-07-05'), desc: 'July sales - Pacific Trading', lines: [
        { account: arAccount._id, debit: '240000', credit: '0', description: 'AR - Pacific' },
        { account: revenueAccount._id, debit: '0', credit: '240000', description: 'Sales revenue' },
      ], ref: 'SALE-JUL-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-07-15'), desc: 'July sales - Vertex Industries', lines: [
        { account: arAccount._id, debit: '155000', credit: '0', description: 'AR - Vertex' },
        { account: revenueAccount._id, debit: '0', credit: '155000', description: 'Sales revenue' },
      ], ref: 'SALE-JUL-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-07-25'), desc: 'Receipt from Pacific Trading', lines: [
        { account: bankAccount._id, debit: '240000', credit: '0', description: 'Bank receipt' },
        { account: arAccount._id, debit: '0', credit: '240000', description: 'AR reduction' },
      ], ref: 'RCV-JUL-001', tags: ['receipt'] },
      { date: new Date('2026-07-31'), desc: 'Office rent - July', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-JUL-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-07-31'), desc: 'Staff salaries - July', lines: [
        { account: salariesExpense._id, debit: '360000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '360000', description: 'Bank payment' },
      ], ref: 'EXP-JUL-SAL', tags: ['expense', 'salaries'] },

      // August
      { date: new Date('2026-08-05'), desc: 'August sales - National Supplies', lines: [
        { account: arAccount._id, debit: '290000', credit: '0', description: 'AR - National' },
        { account: revenueAccount._id, debit: '0', credit: '290000', description: 'Sales revenue' },
      ], ref: 'SALE-AUG-001', tags: ['revenue', 'sales'] },
      { date: new Date('2026-08-12'), desc: 'August sales - Apex Enterprises', lines: [
        { account: arAccount._id, debit: '125000', credit: '0', description: 'AR - Apex' },
        { account: revenueAccount._id, debit: '0', credit: '125000', description: 'Sales revenue' },
      ], ref: 'SALE-AUG-002', tags: ['revenue', 'sales'] },
      { date: new Date('2026-08-31'), desc: 'Office rent - August', lines: [
        { account: rentExpense._id, debit: '45000', credit: '0', description: 'Rent expense' },
        { account: bankAccount._id, debit: '0', credit: '45000', description: 'Bank payment' },
      ], ref: 'EXP-AUG-RENT', tags: ['expense', 'rent'] },
      { date: new Date('2026-08-31'), desc: 'Staff salaries - August', lines: [
        { account: salariesExpense._id, debit: '360000', credit: '0', description: 'Salaries' },
        { account: bankAccount._id, debit: '0', credit: '360000', description: 'Bank payment' },
      ], ref: 'EXP-AUG-SAL', tags: ['expense', 'salaries'] },
    ];

    let postedCount = 0;
    for (const je of journalEntries) {
      try {
        const existing = await (await import('../src/models/JournalEntry.js')).default.findOne({ reference: je.ref });
        if (existing) continue;

        const entry = await ledgerService.createJournalEntry({
          date: je.date,
          description: je.desc,
          lines: je.lines,
          reference: je.ref,
          tags: je.tags,
          source: 'MANUAL',
        }, accountant._id);
        await ledgerService.validateJournalEntry(entry._id, accountant._id);
        await ledgerService.postJournalEntry(entry._id, accountant._id);
        postedCount++;
      } catch (e) {
        logger.warn(`Journal entry ${je.ref} failed: ${e.message}`);
      }
    }
    logger.info(`Posted ${postedCount} journal entries`);

    // ─── INVOICES (various statuses) ─────────────────────────────
    logger.info('Creating invoices...');
    const invoiceData = [
      { cust: CUSTOMERS[0], date: new Date('2026-01-15'), due: new Date('2026-02-15'), items: [{ desc: 'Product A - Bulk Order', qty: 100, price: 1500 }, { desc: 'Installation & Setup', qty: 1, price: 25000 }], status: 'paid', amountPaid: true },
      { cust: CUSTOMERS[1], date: new Date('2026-01-20'), due: new Date('2026-02-20'), items: [{ desc: 'Consulting Services - Jan', qty: 40, price: 2000 }], status: 'overdue' },
      { cust: CUSTOMERS[2], date: new Date('2026-02-10'), due: new Date('2026-03-12'), items: [{ desc: 'Product B - Standard Pack', qty: 50, price: 3200 }, { desc: 'Delivery Charges', qty: 1, price: 5000 }], status: 'paid', amountPaid: true },
      { cust: CUSTOMERS[3], date: new Date('2026-02-14'), due: new Date('2026-03-16'), items: [{ desc: 'Annual Maintenance Contract', qty: 1, price: 120000 }], status: 'sent' },
      { cust: CUSTOMERS[4], date: new Date('2026-03-08'), due: new Date('2026-04-07'), items: [{ desc: 'Raw Materials - March', qty: 200, price: 1100 }, { desc: 'Quality Testing', qty: 5, price: 3000 }], status: 'paid', amountPaid: true },
      { cust: CUSTOMERS[5], date: new Date('2026-03-12'), due: new Date('2026-04-11'), items: [{ desc: 'Technical Support - Q1', qty: 3, price: 45000 }], status: 'partial', partialAmount: 67500 },
      { cust: CUSTOMERS[6], date: new Date('2026-04-05'), due: new Date('2026-05-05'), items: [{ desc: 'Product C - Premium', qty: 25, price: 6800 }], status: 'overdue' },
      { cust: CUSTOMERS[7], date: new Date('2026-04-15'), due: new Date('2026-05-15'), items: [{ desc: 'Software License - Annual', qty: 10, price: 18000 }], status: 'paid', amountPaid: true },
      { cust: CUSTOMERS[0], date: new Date('2026-05-10'), due: new Date('2026-06-09'), items: [{ desc: 'Product A - Repeat Order', qty: 150, price: 1500 }, { desc: 'Express Delivery', qty: 1, price: 8000 }], status: 'paid', amountPaid: true },
      { cust: CUSTOMERS[1], date: new Date('2026-06-08'), due: new Date('2026-07-08'), items: [{ desc: 'Consulting Services - Jun', qty: 35, price: 2200 }], status: 'sent' },
      { cust: CUSTOMERS[2], date: new Date('2026-07-05'), due: new Date('2026-08-04'), items: [{ desc: 'Product B - Bulk Order', qty: 80, price: 3200 }], status: 'sent' },
      { cust: CUSTOMERS[3], date: new Date('2026-07-15'), due: new Date('2026-08-14'), items: [{ desc: 'Custom Development', qty: 1, price: 250000 }], status: 'sent' },
      { cust: CUSTOMERS[4], date: new Date('2026-08-05'), due: new Date('2026-09-04'), items: [{ desc: 'Raw Materials - Aug', qty: 300, price: 950 }, { desc: 'Packaging', qty: 300, price: 150 }], status: 'sent' },
      { cust: CUSTOMERS[5], date: new Date('2026-08-12'), due: new Date('2026-09-11'), items: [{ desc: 'Technical Support - Q3', qty: 3, price: 45000 }], status: 'draft' },
    ];

    for (const inv of invoiceData) {
      try {
        const subtotal = inv.items.reduce((sum, i) => sum + i.qty * i.price, 0);
        const tax = Math.round(subtotal * 0.18);
        const total = subtotal + tax;

        const existing = await Invoice.findOne({ customerName: inv.cust.name, invoiceDate: inv.date });
        if (existing) continue;

        const invoice = await Invoice.create({
          customerName: inv.cust.name,
          customerEmail: inv.cust.email,
          customerGSTIN: inv.cust.gstin,
          customerState: inv.cust.state,
          invoiceDate: inv.date,
          dueDate: inv.due,
          items: inv.items.map(i => ({
            description: i.desc,
            quantity: i.qty,
            unitPrice: String(i.price),
            amount: String(i.qty * i.price),
            taxRate: 18,
          })),
          subtotal: String(subtotal),
          taxRate: 18,
          taxAmount: String(tax),
          totalAmount: String(total),
          status: inv.status === 'paid' ? 'paid' : inv.status === 'overdue' ? 'overdue' : inv.status === 'partial' ? 'partial' : 'sent',
          amountPaid: inv.amountPaid ? String(total) : inv.partialAmount ? String(inv.partialAmount) : '0',
          source: 'manual',
          createdBy: accountant._id,
          notes: `Invoice for ${inv.cust.name}`,
        });
        logger.info(`Invoice created: ${invoice.invoiceNumber || invoice._id} - ${inv.cust.name} - Rs.${total}`);
      } catch (e) {
        logger.warn(`Invoice for ${inv.cust.name} failed: ${e.message}`);
      }
    }

    // ─── EXPENSES (various categories) ───────────────────────────
    logger.info('Creating expenses...');
    const expenseData = [
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Q1', amt: 85000, date: new Date('2026-01-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Jan', amt: 12000, date: new Date('2026-01-20'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - January', amt: 45000, date: new Date('2026-01-05'), status: 'approved' },
      { vendor: 'PowerGrid Utilities', cat: 'utilities', desc: 'Electricity bill - January', amt: 12000, date: new Date('2026-01-28'), status: 'approved' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Feb', amt: 92000, date: new Date('2026-02-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Feb', amt: 15000, date: new Date('2026-02-18'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - February', amt: 45000, date: new Date('2026-02-05'), status: 'approved' },
      { vendor: 'DigitalWave Marketing', cat: 'marketing', desc: 'Google Ads campaign - Feb', amt: 35000, date: new Date('2026-02-15'), status: 'approved' },
      { vendor: 'SafeGuard Insurance', cat: 'insurance', desc: 'Annual commercial insurance', amt: 68000, date: new Date('2026-02-20'), status: 'approved' },
      { vendor: 'SkillPro Consulting', cat: 'professional_services', desc: 'Tax filing advisory - FY25', amt: 45000, date: new Date('2026-03-01'), status: 'approved' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Mar', amt: 88000, date: new Date('2026-03-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Mar', amt: 11000, date: new Date('2026-03-20'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - March', amt: 45000, date: new Date('2026-03-05'), status: 'approved' },
      { vendor: 'PowerGrid Utilities', cat: 'utilities', desc: 'Electricity + Internet - Mar', amt: 18000, date: new Date('2026-03-28'), status: 'approved' },
      { vendor: 'FreshBites Catering', cat: 'meals', desc: 'Team lunch - Q1 review', amt: 22000, date: new Date('2026-03-30'), status: 'approved' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Apr', amt: 95000, date: new Date('2026-04-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Apr', amt: 13000, date: new Date('2026-04-18'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - April', amt: 45000, date: new Date('2026-04-05'), status: 'approved' },
      { vendor: 'CloudNine IT', cat: 'software', desc: 'ERP system maintenance - Apr', amt: 28000, date: new Date('2026-04-15'), status: 'approved' },
      { vendor: 'DigitalWave Marketing', cat: 'marketing', desc: 'Social media campaign - Q2', amt: 55000, date: new Date('2026-04-20'), status: 'pending' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - May', amt: 98000, date: new Date('2026-05-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - May', amt: 14000, date: new Date('2026-05-18'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - May', amt: 45000, date: new Date('2026-05-05'), status: 'approved' },
      { vendor: 'PowerGrid Utilities', cat: 'utilities', desc: 'Electricity bill - May', amt: 15000, date: new Date('2026-05-28'), status: 'approved' },
      { vendor: 'SkillPro Consulting', cat: 'professional_services', desc: 'GST quarterly filing', amt: 35000, date: new Date('2026-06-01'), status: 'approved' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Jun', amt: 102000, date: new Date('2026-06-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Jun', amt: 16000, date: new Date('2026-06-18'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - Jun', amt: 45000, date: new Date('2026-06-05'), status: 'approved' },
      { vendor: 'FreshBites Catering', cat: 'meals', desc: 'Client meeting lunch - Jun', amt: 18000, date: new Date('2026-06-25'), status: 'approved' },
      { vendor: 'DigitalWave Marketing', cat: 'marketing', desc: 'LinkedIn ads - Q3', amt: 42000, date: new Date('2026-07-05'), status: 'pending' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Jul', amt: 105000, date: new Date('2026-07-10'), status: 'approved' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Jul', amt: 12500, date: new Date('2026-07-18'), status: 'approved' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - Jul', amt: 45000, date: new Date('2026-07-05'), status: 'approved' },
      { vendor: 'PowerGrid Utilities', cat: 'utilities', desc: 'Electricity + Internet - Jul', amt: 20000, date: new Date('2026-07-28'), status: 'approved' },
      { vendor: 'TechVista Solutions', cat: 'software', desc: 'AWS cloud hosting - Aug', amt: 110000, date: new Date('2026-08-10'), status: 'pending' },
      { vendor: 'GreenLeaf Office', cat: 'supplies', desc: 'Monthly office supplies - Aug', amt: 13500, date: new Date('2026-08-12'), status: 'pending' },
      { vendor: 'CityRent Properties', cat: 'rent', desc: 'Office rent - Aug', amt: 45000, date: new Date('2026-08-05'), status: 'approved' },
    ];

    let expCount = 0;
    for (const exp of expenseData) {
      try {
        const existing = await Expense.findOne({ vendor: exp.vendor, date: exp.date, description: exp.desc });
        if (existing) continue;

        const expense = await Expense.create({
          date: exp.date,
          vendor: exp.vendor,
          description: exp.desc,
          category: exp.cat,
          amount: String(exp.amt),
          totalAmount: String(exp.amt),
          paymentMethod: 'bank_transfer',
          status: exp.status,
          source: 'manual',
          submittedBy: accountant._id,
          approvedBy: exp.status === 'approved' ? admin._id : undefined,
          approvedAt: exp.status === 'approved' ? exp.date : undefined,
        });
        expCount++;
      } catch (e) {
        logger.warn(`Expense ${exp.vendor} failed: ${e.message}`);
      }
    }
    logger.info(`Created ${expCount} expenses`);

    // ─── TDS ENTRIES ─────────────────────────────────────────────
    logger.info('Creating TDS entries...');
    const tdsEntries = [
      { date: new Date('2026-01-25'), name: 'Rajesh Consultants', pan: 'ABCPR1234F', section: '194J', nature: 'Professional Fees', amount: 80000, rate: 10, status: 'deposited', quarter: 'Q4', fy: '2025-26' },
      { date: new Date('2026-02-15'), name: 'QuickFix Contractors', pan: 'BCDFQ5678G', section: '194C', nature: 'Contractor Payment', amount: 150000, rate: 1, status: 'deducted', quarter: 'Q4', fy: '2025-26' },
      { date: new Date('2026-03-10'), name: 'Prime Properties', pan: 'CDERP9012H', section: '194I', nature: 'Office Rent', amount: 45000, rate: 10, status: 'deposited', quarter: 'Q1', fy: '2026-27' },
      { date: new Date('2026-04-20'), name: 'SalesMax Agents', pan: 'SAGME4561J', section: '194H', nature: 'Commission', amount: 60000, rate: 5, status: 'deducted', quarter: 'Q1', fy: '2026-27' },
      { date: new Date('2026-05-15'), name: 'TechVista Solutions', pan: 'EFGHT7890K', section: '194J', nature: 'Technical Services', amount: 120000, rate: 10, status: 'pending', quarter: 'Q2', fy: '2026-27' },
      { date: new Date('2026-06-30'), name: 'SafeGuard Insurance', pan: 'FGHIU2345L', section: '194A', nature: 'Insurance Commission', amount: 35000, rate: 10, status: 'pending', quarter: 'Q2', fy: '2026-27' },
    ];

    for (const tds of tdsEntries) {
      try {
        const existing = await TDSEntry.findOne({ 'deductee.name': tds.name, transactionDate: tds.date });
        if (existing) continue;

        const tdsAmt = Math.round(tds.amount * tds.rate / 100);
        await TDSEntry.create({
          transactionDate: tds.date,
          deductee: { name: tds.name, pan: tds.pan, address: 'India' },
          section: tds.section,
          nature: tds.nature,
          paymentAmount: String(tds.amount),
          tdsRate: tds.rate,
          tdsAmount: String(tdsAmt),
          status: tds.status,
          quarter: tds.quarter,
          financialYear: tds.fy,
          createdBy: accountant._id,
        });
      } catch (e) {
        logger.warn(`TDS entry failed: ${e.message}`);
      }
    }

    // ─── GST RETURNS ─────────────────────────────────────────────
    logger.info('Creating GST returns...');
    const gstReturns = [
      { month: 1, year: 2026, quarter: 4, fy: '2025-26', taxable: 275000, cgst: 24750, sgst: 24750 },
      { month: 4, year: 2026, quarter: 1, fy: '2026-27', taxable: 335000, cgst: 30150, sgst: 30150 },
      { month: 7, year: 2026, quarter: 2, fy: '2026-27', taxable: 395000, cgst: 35550, sgst: 35550 },
    ];

    for (const g of gstReturns) {
      try {
        const existing = await GSTReturn.findOne({ returnType: 'GSTR1', 'period.month': g.month, 'period.year': g.year });
        if (existing) continue;

        await GSTReturn.create({
          returnType: 'GSTR1',
          period: { month: g.month, year: g.year, quarter: g.quarter },
          gstin: '07AABCB1234F1Z5',
          b2b: [{ customerGSTIN: '27AABCA1234A1Z5', customerName: 'Sample Customer', invoiceNumber: `INV-${g.year}${String(g.month).padStart(2, '0')}-001`, invoiceDate: new Date(g.year, g.month - 1, 15), invoiceValue: String(g.taxable + g.cgst + g.sgst), taxableValue: String(g.taxable), cgst: String(g.cgst), sgst: String(g.sgst), igst: '0' }],
          outwardSupplies: { taxable: String(g.taxable), cgst: String(g.cgst), sgst: String(g.sgst), igst: '0', cess: '0' },
          inwardSupplies: { taxable: '0', cgst: '0', sgst: '0', igst: '0', itc: '0' },
          status: 'draft',
          filedBy: accountant._id,
        });
      } catch (e) {
        logger.warn(`GST return failed: ${e.message}`);
      }
    }

    // Summary
    const invoiceCount = await Invoice.countDocuments();
    const expenseCount = await Expense.countDocuments();
    const journalCount = await (await import('../src/models/JournalEntry.js')).default.countDocuments();
    const tdsCount = await TDSEntry.countDocuments();
    const gstCount = await GSTReturn.countDocuments();

    logger.info('\n✅ Comprehensive seed completed!');
    logger.info(`   Invoices: ${invoiceCount}`);
    logger.info(`   Expenses: ${expenseCount}`);
    logger.info(`   Journal Entries: ${journalCount}`);
    logger.info(`   TDS Entries: ${tdsCount}`);
    logger.info(`   GST Returns: ${gstCount}`);
    logger.info('\nCheck: Dashboard, P&L, Balance Sheet, Expenses, GST, TDS tabs');
      }
    );

    process.exit(0);
  } catch (error) {
    logger.error('Seed error:', error);
    process.exit(1);
  }
};

seedComprehensive();
