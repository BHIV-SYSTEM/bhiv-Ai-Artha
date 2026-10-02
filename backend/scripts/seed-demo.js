import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import Dealer from '../src/models/Dealer.js';
import SalesAgent from '../src/models/SalesAgent.js';
import LocationPing from '../src/models/LocationPing.js';
import Visit from '../src/models/Visit.js';
import Notification from '../src/models/Notification.js';
import User from '../src/models/User.js';
import logger from '../src/config/logger.js';

// ─── Configurable Location Defaults ──────────────────────────────────
// Set these in backend/.env to seed data for your own city/region.
// If not set, defaults to Mumbai.
const DEFAULT_LAT = parseFloat(process.env.DEMO_DEFAULT_LAT) || 19.0760;
const DEFAULT_LNG = parseFloat(process.env.DEMO_DEFAULT_LNG) || 72.8777;
const DEFAULT_CITY = process.env.DEMO_DEFAULT_CITY || 'Mumbai';
const DEFAULT_STATE = process.env.DEMO_DEFAULT_STATE || 'Maharashtra';
const DEFAULT_PINCODE_PREFIX = process.env.DEMO_DEFAULT_PINCODE_PREFIX || '4000';
const DEFAULT_COUNTRY = process.env.DEMO_DEFAULT_COUNTRY || 'India';

// Generate random offset from center (within ~5km radius)
function randomOffset(rangeKm = 0.05) {
  return (Math.random() - 0.5) * rangeKm * 2;
}

// Build dealer data using configured center point
const DEMO_DEALERS = [
  { name: 'Sharma Electronics', area: 'Main Market', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 245000, overdue: 85000, phone: '9810123456', gstin: '27AABCS1234F1Z5' },
  { name: 'Gupta Traders', area: 'Industrial Area', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 178000, overdue: 0, phone: '9810234567', gstin: '27AABCG5678G1Z3' },
  { name: 'Patel & Sons', area: 'Commerce Center', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 312000, overdue: 112000, phone: '9810345678', gstin: '27AABCP9012H1Z1' },
  { name: 'Mehta Brothers', area: 'Business District', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 89000, overdue: 0, phone: '9810456789', gstin: '27AABCM3456J1Z8' },
  { name: 'Kumar Enterprises', area: 'Trade Center', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 456000, overdue: 200000, phone: '9810567890', gstin: '27AABCK7890K1Z6' },
  { name: 'Agarwal & Co', area: 'Station Road', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 134000, overdue: 34000, phone: '9810678901', gstin: '27AABCA2345L1Z4' },
  { name: 'Singh Trading Co', area: 'Ring Road', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 67000, overdue: 0, phone: '9810789012', gstin: '27AABCJ6789M1Z2' },
  { name: 'Reddy Industries', area: ' MG Road', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 201000, overdue: 101000, phone: '9810890123', gstin: '27AABCR0123N1Z0' },
  { name: 'Jain Hardware', area: 'City Center', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 156000, overdue: 56000, phone: '9810901234', gstin: '27AABCJ4567P1Z8' },
  { name: 'Verma Sales Corp', area: 'Market Road', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 289000, overdue: 0, phone: '9811012345', gstin: '27AABCV8901Q1Z6' },
  { name: 'Bansal Mart', area: 'Nehru Nagar', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 98000, overdue: 28000, phone: '9811123456', gstin: '27AABCB2345R1Z4' },
  { name: 'Tiwari Electronics', area: 'Gandhi Road', lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset(), outstanding: 175000, overdue: 75000, phone: '9811234567', gstin: '27AABCT6789S1Z2' },
];

const DEMO_AGENTS = [
  { name: 'Rajesh Kumar', role: 'sales-executive', area: 'Zone A', phone: '9800100001', target: 500000, achieved: 340000, lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset() },
  { name: 'Amit Singh', role: 'sales-executive', area: 'Zone B', phone: '9800100002', target: 600000, achieved: 450000, lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset() },
  { name: 'Priya Sharma', role: 'field-agent', area: 'Zone C', phone: '9800100003', target: 400000, achieved: 220000, lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset() },
  { name: 'Vikram Patel', role: 'sales-executive', area: 'Zone D', phone: '9800100004', target: 350000, achieved: 180000, lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset() },
  { name: 'Deepak Gupta', role: 'sales-manager', area: 'All Zones', phone: '9800100005', target: 800000, achieved: 620000, lat: DEFAULT_LAT + randomOffset(), lng: DEFAULT_LNG + randomOffset() },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for demo seed');
    logger.info(`Seeding demo data for: ${DEFAULT_CITY}, ${DEFAULT_STATE} (lat: ${DEFAULT_LAT}, lng: ${DEFAULT_LNG})`);

    // Clear old demo data
    await Dealer.deleteMany({});
    await SalesAgent.deleteMany({});
    await LocationPing.deleteMany({});
    await Visit.deleteMany({});
    await Notification.deleteMany({});
    logger.info('Cleared old demo data');

    // Ensure demo admin user exists
    const existingAdmin = await User.findOne({ email: 'admin@brightconnection.in' });
    if (!existingAdmin) {
      await User.create({
        email: 'admin@brightconnection.in',
        password: 'admin123',
        name: 'Demo Admin',
        role: 'admin',
        isActive: true,
      });
      logger.info('Created demo admin user');
    }

    // Create dealers
    const dealerDocs = [];
    for (let i = 0; i < DEMO_DEALERS.length; i++) {
      const d = DEMO_DEALERS[i];
      const dealer = await Dealer.create({
        dealerCode: `BC-DEMO-${String(i + 1).padStart(3, '0')}`,
        name: d.name,
        displayName: d.name,
        contactPerson: `Owner - ${d.name}`,
        phone: d.phone,
        email: `info@${d.name.toLowerCase().replace(/[^a-z]/g, '')}.in`,
        address: `${d.area}, ${DEFAULT_CITY}`,
        city: DEFAULT_CITY,
        state: DEFAULT_STATE,
        pincode: DEFAULT_PINCODE_PREFIX + String(Math.floor(Math.random() * 90) + 10),
        latitude: d.lat,
        longitude: d.lng,
        region: DEFAULT_CITY,
        area: d.area,
        gstin: d.gstin,
        creditLimit: 500000,
        outstandingBalance: d.outstanding,
        overdueAmount: d.overdue,
        lastBillingDate: new Date(Date.now() - Math.floor(Math.random() * 15) * 86400000),
        lastPaymentDate: d.overdue === 0 ? new Date(Date.now() - Math.floor(Math.random() * 5) * 86400000) : null,
        isActive: true,
        visits: Math.floor(Math.random() * 12) + 1,
        lastVisitDate: new Date(Date.now() - Math.floor(Math.random() * 7) * 86400000),
        tallyPartyId: `DEMO-${d.name.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 8)}`,
      });
      dealerDocs.push(dealer);
    }
    logger.info(`Created ${dealerDocs.length} demo dealers`);

    // Create agents
    const agentDocs = [];
    for (let i = 0; i < DEMO_AGENTS.length; i++) {
      const a = DEMO_AGENTS[i];
      // Assign 2-3 dealers per agent
      const startIdx = (i * 2) % dealerDocs.length;
      const assignedDealerIds = [dealerDocs[startIdx]._id, dealerDocs[(startIdx + 1) % dealerDocs.length]._id];

      const agent = await SalesAgent.create({
        agentCode: `AGT-DEMO-${String(i + 1).padStart(3, '0')}`,
        name: a.name,
        phone: a.phone,
        email: `${a.name.toLowerCase().replace(/[^a-z]/g, '')}@brightconnection.in`,
        role: a.role,
        region: DEFAULT_CITY,
        area: a.area,
        assignedDealers: assignedDealerIds,
        isActive: true,
        isLocationTrackingEnabled: true,
        lastKnownLocation: {
          latitude: a.lat,
          longitude: a.lng,
          timestamp: new Date(Date.now() - Math.floor(Math.random() * 30) * 60000),
          address: `${a.area}, ${DEFAULT_CITY}`,
        },
        totalVisits: Math.floor(Math.random() * 50) + 10,
        totalSales: a.achieved,
        targetAmount: a.target,
        targetAchieved: a.achieved,
        targetAchievedPercent: Math.round((a.achieved / a.target) * 100),
        joinedAt: new Date('2024-04-01'),
      });

      // Update dealers with assigned agent
      for (const did of assignedDealerIds) {
        await Dealer.findByIdAndUpdate(did, { assignedAgent: agent._id });
      }

      agentDocs.push(agent);
    }
    logger.info(`Created ${agentDocs.length} demo agents`);

    // Create location pings (last 2 hours)
    const now = Date.now();
    for (const agent of agentDocs) {
      // Generate 6-10 pings per agent over last 2 hours
      const pingCount = Math.floor(Math.random() * 5) + 6;
      for (let j = 0; j < pingCount; j++) {
        const timeAgo = (j * 12 + Math.floor(Math.random() * 5)) * 60000;
        const latOffset = (Math.random() - 0.5) * 0.01;
        const lngOffset = (Math.random() - 0.5) * 0.01;
        const nearestDealer = dealerDocs[Math.floor(Math.random() * dealerDocs.length)];

        await LocationPing.create({
          agentId: agent._id,
          agentName: agent.name,
          latitude: agent.lastKnownLocation.latitude + latOffset,
          longitude: agent.lastKnownLocation.longitude + lngOffset,
          accuracy: Math.floor(Math.random() * 15) + 5,
          batteryLevel: Math.floor(Math.random() * 40) + 60,
          batteryCharging: Math.random() > 0.8,
          networkType: ['4g', '5g', 'wifi'][Math.floor(Math.random() * 3)],
          deviceId: `DEMO-DEVICE-${agent.agentCode}`,
          devicePlatform: 'android',
          address: `${agent.area}, ${DEFAULT_CITY}`,
          nearbyDealer: nearestDealer._id,
          isAtDealer: j < 2,
          source: 'manual',
          createdAt: new Date(now - timeAgo),
        });
      }
    }
    logger.info('Created demo location pings');

    // Create visits
    for (const agent of agentDocs) {
      const assignedDealers = dealerDocs.filter(d =>
        agent.assignedDealers.some(id => id.toString() === d._id.toString())
      );
      for (const dealer of assignedDealers) {
        // Create one completed visit and one active visit per dealer
        const hoursAgo = Math.floor(Math.random() * 48) + 2;
        await Visit.create({
          agentId: agent._id,
          agentName: agent.name,
          dealerId: dealer._id,
          dealerName: dealer.name,
          visitType: ['check-in', 'collection', 'meeting'][Math.floor(Math.random() * 3)],
          status: 'completed',
          checkIn: {
            time: new Date(now - hoursAgo * 3600000),
            latitude: dealer.latitude + (Math.random() - 0.5) * 0.001,
            longitude: dealer.longitude + (Math.random() - 0.5) * 0.001,
            address: `${dealer.area}, ${DEFAULT_CITY}`,
          },
          checkOut: {
            time: new Date(now - (hoursAgo - 1) * 3600000),
            latitude: dealer.latitude,
            longitude: dealer.longitude,
          },
          duration: Math.floor(Math.random() * 90) + 15,
          purpose: 'Regular visit and collection',
          notes: `Discussed outstanding payment of Rs ${dealer.outstandingBalance}`,
          outcome: Math.random() > 0.5 ? 'payment-collected' : 'order-placed',
          totalOrderAmount: Math.floor(Math.random() * 50000) + 10000,
          collectionAmount: Math.floor(Math.random() * dealer.outstandingBalance * 0.3),
        });
      }

      // One active visit for first agent
      if (agentDocs.indexOf(agent) === 0 && assignedDealers.length > 0) {
        const dealer = assignedDealers[0];
        await Visit.create({
          agentId: agent._id,
          agentName: agent.name,
          dealerId: dealer._id,
          dealerName: dealer.name,
          visitType: 'check-in',
          status: 'in-progress',
          checkIn: {
            time: new Date(now - 45 * 60000),
            latitude: dealer.latitude,
            longitude: dealer.longitude,
            address: `${dealer.area}, ${DEFAULT_CITY}`,
          },
          purpose: 'Delivery follow-up',
          notes: 'Scheduled delivery confirmation',
        });
      }
    }
    logger.info('Created demo visits');

    // Create notifications
    const notifMessages = [
      { title: 'Payment Received', body: `${DEMO_DEALERS[0].name} paid Rs 50,000`, type: 'payment', category: 'finance' },
      { title: 'Visit Completed', body: `${DEMO_AGENTS[0].name} completed visit to ${DEMO_DEALERS[1].name}`, type: 'visit', category: 'system' },
      { title: 'Overdue Alert', body: `${DEMO_DEALERS[4].name} - Rs 2,00,000 overdue by 15 days`, type: 'overdue', category: 'crm' },
      { title: 'New Order', body: `${DEMO_DEALERS[2].name} placed order for Rs 75,000`, type: 'info', category: 'crm' },
      { title: 'Agent Check-in', body: `${DEMO_AGENTS[1].name} checked in at ${DEMO_DEALERS[3].area}`, type: 'location', category: 'system' },
    ];
    for (let i = 0; i < notifMessages.length; i++) {
      await Notification.create({
        ...notifMessages[i],
        read: i > 2,
        createdAt: new Date(now - i * 3600000),
      });
    }
    logger.info('Created demo notifications');

    // Print summary
    const dealerCount = await Dealer.countDocuments();
    const agentCount = await SalesAgent.countDocuments();
    const pingCount = await LocationPing.countDocuments();
    const visitCount = await Visit.countDocuments();
    const notifCount = await Notification.countDocuments();

    console.log('\n========================================');
    console.log('  DEMO DATA SEEDED SUCCESSFULLY');
    console.log('========================================');
    console.log(`  Location:         ${DEFAULT_CITY}, ${DEFAULT_STATE}`);
    console.log(`  Coordinates:      ${DEFAULT_LAT}, ${DEFAULT_LNG}`);
    console.log(`  Dealers:          ${dealerCount}`);
    console.log(`  Sales Agents:     ${agentCount}`);
    console.log(`  Location Pings:   ${pingCount}`);
    console.log(`  Visits:           ${visitCount}`);
    console.log(`  Notifications:    ${notifCount}`);
    console.log('========================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    logger.error('Demo seed failed:', err);
    console.error(err);
    process.exit(1);
  }
}

seed();
