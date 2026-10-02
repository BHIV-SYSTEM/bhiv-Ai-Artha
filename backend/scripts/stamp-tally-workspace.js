/**
 * One-time migration: stamp pre-existing Tally* documents with the
 * connector's workspace id (companyId). The companyScope plugin filters
 * queries by companyId — documents created before scoping have
 * companyId: null and would be invisible to everyone (and upserts would
 * hit duplicate-key errors on the unique indexes).
 *
 * Usage:  node scripts/stamp-tally-workspace.js
 * Env:    MONGODB_URI, TALLY_COMPANY (default: Bright Connections company)
 */
import mongoose from 'mongoose';
import { resolveWorkspace } from '../src/controllers/tallyIngest.controller.js';
import TallyParty from '../src/models/TallyParty.js';
import TallyVoucher from '../src/models/TallyVoucher.js';
import TallyOutstanding from '../src/models/TallyOutstanding.js';
import Invoice from '../src/models/Invoice.js';
import Expense from '../src/models/Expense.js';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27117/artha';
const company = process.env.TALLY_COMPANY || 'Bright Connections - (from 1-Apr-24)';

await mongoose.connect(uri);

const workspace = await resolveWorkspace(company);
if (!workspace) {
  console.error('No workspace resolved — create the owner admin first.');
  process.exit(1);
}
console.log(`workspace = ${String(workspace)}`);

const collections = ['tallyparties', 'tallyvouchers', 'tallyoutstandings', 'tallysyncruns'];
for (const name of collections) {
  const res = await mongoose.connection.db.collection(name).updateMany(
    { $or: [{ companyId: { $exists: false } }, { companyId: null }] },
    { $set: { companyId: workspace } },
  );
  console.log(`${name}: stamped ${res.modifiedCount}/${res.matchedCount}`);
}

// Rebuild indexes: unique keys now include companyId so different accounts
// can hold the same voucher/party numbers without colliding (drops the old
// global unique indexes).
await TallyParty.syncIndexes();
await TallyVoucher.syncIndexes();
await TallyOutstanding.syncIndexes();
await Invoice.syncIndexes();
await Expense.syncIndexes();
console.log('indexes rebuilt (companyId-scoped unique keys)');

await mongoose.disconnect();
console.log('done');
