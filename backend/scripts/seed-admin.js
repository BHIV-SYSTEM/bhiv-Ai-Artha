#!/usr/bin/env node

/**
 * seed-admin.js
 *
 * Creates the production administrator account for Yaseen Bhai.
 * Run: node scripts/seed-admin.js
 *
 * Phase 5: Production Demonstration & Business Handover
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/artha';

const ADMIN_USER = {
  name: 'Yaseen Bhai',
  email: 'yaseen@bhiv.com',
  password: 'BHIV@Artha2026!',
  role: 'admin',
  roles: ['admin', 'finance_manager', 'compliance_officer'],
  allowedApps: ['artha', 'governance', 'compliance', 'reports', 'settings'],
  isApproved: true,
  isActive: true,
};

async function seedAdmin() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   ARTHA Production Admin Account Seed                    ║');
  console.log('║   Creating administrator for Yaseen Bhai                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  try {
    await mongoose.connect(MONGO_URI);
    console.log('  ✓ Connected to MongoDB');

    // Import User model
    const { default: User } = await import('../src/models/User.js');

    // Check if admin already exists
    const existing = await User.findOne({ email: ADMIN_USER.email });
    if (existing) {
      console.log(`  ℹ Admin user already exists: ${ADMIN_USER.email}`);
      console.log(`    Role: ${existing.role}`);
      console.log(`    ID: ${existing._id}`);
      await mongoose.disconnect();
      return;
    }

    // Create admin user — pass the PLAINTEXT password; the User model's
    // pre('save') hook hashes it exactly once. (Pre-hashing here would make
    // the model hash an already-hashed string, so login could never match.)
    const admin = await User.create({
      name: ADMIN_USER.name,
      email: ADMIN_USER.email,
      password: ADMIN_USER.password,
      role: ADMIN_USER.role,
      roles: ADMIN_USER.roles,
      allowedApps: ADMIN_USER.allowedApps,
      isApproved: ADMIN_USER.isApproved,
      isActive: ADMIN_USER.isActive,
    });

    console.log('  ✓ Admin user created successfully');
    console.log(`    Name: ${admin.name}`);
    console.log(`    Email: ${admin.email}`);
    console.log(`    Role: ${admin.role}`);
    console.log(`    Roles: ${admin.roles.join(', ')}`);
    console.log(`    ID: ${admin._id}`);
    console.log(`    Password: ${ADMIN_USER.password}`);

    console.log('\n  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  LOGIN CREDENTIALS                                  │');
    console.log('  ├─────────────────────────────────────────────────────┤');
    console.log(`  │  Email:    ${ADMIN_USER.email.padEnd(37)}│`);
    console.log(`  │  Password: ${ADMIN_USER.password.padEnd(37)}│`);
    console.log('  │  Role:     admin                                   │');
    console.log('  └─────────────────────────────────────────────────────┘\n');

    await mongoose.disconnect();
    console.log('  ✓ Disconnected from MongoDB');
    console.log('\n  Admin account ready for production use by Yaseen Bhai.\n');

  } catch (error) {
    console.error('  ✗ Error:', error.message);
    process.exit(1);
  }
}

seedAdmin();
