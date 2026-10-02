import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Expense from '../src/models/Expense.js';
import Invoice from '../src/models/Invoice.js';
import BankStatement from '../src/models/BankStatement.js';
import JournalEntry from '../src/models/JournalEntry.js';
import LedgerEntry from '../src/models/LedgerEntry.js';
import GSTReturn from '../src/models/GSTReturn.js';
import TDSEntry from '../src/models/TDSEntry.js';
import AccountBalance from '../src/models/AccountBalance.js';
import Notification from '../src/models/Notification.js';
import CostCentre from '../src/models/CostCentre.js';
import FinancialPeriod from '../src/models/FinancialPeriod.js';
import ReconcileRecord from '../src/models/ReconcileRecord.js';
import TallyExport from '../src/models/TallyExport.js';
import TallyImport from '../src/models/TallyImport.js';
import CompanySettings from '../src/models/CompanySettings.js';

dotenv.config();

const MODELS = [
  Expense, Invoice, BankStatement, JournalEntry, LedgerEntry,
  GSTReturn, TDSEntry, AccountBalance, Notification, CostCentre,
  FinancialPeriod, ReconcileRecord, TallyExport, TallyImport,
];

/**
 * One-time migration for databases created before workspace isolation:
 * assigns every unowned document to the given (or first) admin so that
 * admin keeps the existing data while all other accounts start from zero.
 *
 * Usage:
 *   node scripts/assign-workspaces.js              # first admin
 *   node scripts/assign-workspaces.js admin@x.com  # specific admin
 */
const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const email = process.argv[2];
  const admin = email
    ? await User.findOne({ email: email.toLowerCase() })
    : await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  if (!admin) {
    console.error(email ? `No user with email ${email}` : 'No admin user found');
    process.exit(1);
  }

  console.log(`Assigning unowned documents to ${admin.email} (${admin._id})`);

  for (const Model of MODELS) {
    const res = await Model.updateMany(
      { companyId: null },
      { $set: { companyId: admin._id } }
    );
    console.log(`${Model.modelName}: ${res.modifiedCount} document(s) assigned`);
  }

  // Legacy singleton settings: copy its fields into a workspace document
  // (the string _id cannot be hydrated by mongoose anymore), then remove it.
  const coll = mongoose.connection.collection('companysettings');
  const legacy = await coll.findOne({ _id: 'company_settings' });
  if (legacy) {
    const existing = await CompanySettings.findOne({ companyId: admin._id });
    if (!existing) {
      const rest = { ...legacy };
      delete rest._id;
      delete rest.companyId;
      if (rest.gstin === '') rest.gstin = null;
      if (rest.pan === '') rest.pan = null;
      if (rest.tan === '') rest.tan = null;
      await CompanySettings.create({
        ...rest,
        companyId: admin._id,
        name: rest.name || rest.companyName || 'My Company',
      });
      console.log('CompanySettings: legacy singleton copied to admin workspace');
    }
    await coll.deleteOne({ _id: 'company_settings' });
    console.log('CompanySettings: legacy singleton removed');
  } else {
    console.log('CompanySettings: no legacy singleton found');
  }

  console.log('Done.');
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
