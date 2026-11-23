import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/models/User.js';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-artha');

const users = await User.find({}).select('email role isActive').lean();
console.log('Existing users:');
for (const u of users) console.log(`  ${u.email} | role=${u.role} | active=${u.isActive}`);

const targets = [
  { match: /^admin@/, email: process.env.ADMIN_EMAIL || 'admin@artha.local', password: process.env.ADMIN_PASSWORD || 'Admin@123456' },
  { match: /^accountant@/, password: 'Accountant@123456' },
  { match: /^viewer@/, password: 'Viewer@123456' },
  { match: /^subadmin@/, password: 'SubAdmin@123456' },
];

for (const t of targets) {
  const list = await User.find({ email: t.match });
  if (!list.length) { console.log(`No user matching ${t.match} — skipped`); continue; }
  const hash = await bcrypt.hash(t.password, 10);
  for (const u of list) {
    await User.updateOne({ _id: u._id }, { $set: { password: hash, isActive: true } });
    console.log(`Reset password for ${u.email} -> ${t.password} (activated)`);
  }
}

await mongoose.disconnect();
