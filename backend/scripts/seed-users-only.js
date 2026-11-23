import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);

const users = [
  { email: process.env.ADMIN_EMAIL || 'admin@artha.local', password: process.env.ADMIN_PASSWORD || 'Admin@123456', name: 'Admin User', role: 'admin' },
  { email: 'accountant@artha.local', password: 'Accountant@123456', name: 'Accountant User', role: 'accountant' },
  { email: 'viewer@artha.local', password: 'Viewer@123456', name: 'Viewer User', role: 'viewer' },
  { email: 'subadmin@acme.local', password: 'SubAdmin@123456', name: 'Acme Sub Admin', role: 'sub_admin' },
];

for (const u of users) {
  const existing = await User.findOne({ email: u.email });
  if (existing) {
    existing.password = u.password;
    existing.isActive = true;
    existing.isApproved = true;
    await existing.save();
    console.log(`Updated: ${u.email} (${u.role})`);
  } else {
    await User.create({ ...u, isActive: true, isApproved: true });
    console.log(`Created: ${u.email} (${u.role})`);
  }
}

await mongoose.disconnect();
