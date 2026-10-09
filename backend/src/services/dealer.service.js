import Dealer from '../models/Dealer.js';
import TallyParty from '../models/TallyParty.js';
import TallyOutstanding from '../models/TallyOutstanding.js';
import TallyVoucher from '../models/TallyVoucher.js';
import crypto from 'node:crypto';
import logger from '../config/logger.js';
import notificationEvent from './notificationEvent.service.js';

class DealerService {
  async createDealer(data) {
    if (!data.dealerCode) {
      const count = await Dealer.countDocuments();
      data.dealerCode = `DLR-${String(count + 1).padStart(5, '0')}`;
    }
    return Dealer.create(data);
  }

  async getDealers({ page = 1, limit = 20, search, region, city, isActive, assignedAgent, sort = '-createdAt' } = {}) {
    const query = {};
    if (search) query.$text = { $search: search };
    if (region) query.region = region;
    if (city) query.city = city;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (assignedAgent) query.assignedAgent = assignedAgent;

    const total = await Dealer.countDocuments(query);
    const dealers = await Dealer.find(query)
      .populate('assignedAgent', 'name region area')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      dealers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getDealerById(id) {
    return Dealer.findById(id)
      .populate('assignedAgent', 'name region area phone')
      .lean();
  }

  async updateDealer(id, data) {
    return Dealer.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  }

  async deleteDealer(id) {
    return Dealer.findByIdAndUpdate(id, { isActive: false }, { new: true });
  }

  async getDealerSummary(id) {
    const dealer = await Dealer.findById(id).lean();
    if (!dealer) throw new Error('Dealer not found');

    const outstanding = await TallyOutstanding.find({
      $or: [
        { partyName: dealer.name },
        { ledgerName: dealer.name },
      ],
    }).lean();

    const recentVouchers = await TallyVoucher.find({
      $or: [
        { partyName: dealer.name },
        { partyLedgerName: dealer.name },
      ],
    }).sort({ date: -1 }).limit(10).lean();

    const overdueBills = outstanding.filter(b => {
      if (!b.dueDate) return false;
      return new Date(b.dueDate) < new Date();
    });

    return {
      dealer,
      outstanding: {
        total: outstanding.reduce((s, b) => s + (b.balance || b.amount || 0), 0),
        bills: outstanding,
        overdueCount: overdueBills.length,
        overdueAmount: overdueBills.reduce((s, b) => s + (b.balance || b.amount || 0), 0),
      },
      recentVouchers,
      stats: {
        totalBills: outstanding.length,
        overdueBills: overdueBills.length,
        lastBillingDate: recentVouchers.length > 0 ? recentVouchers[0].date : null,
        lastPaymentDate: recentVouchers.find(v => v.voucherType === 'Receipt')?.date || null,
      },
    };
  }

  async syncFromTally() {
    const tallyParties = await TallyParty.find({
      $or: [
        { group: 'Sundry Debtors' },
        { parent: 'Sundry Debtors' },
      ],
    }).lean();

    // Default location from env vars — used when creating new dealers from Tally
    const defaultLat = parseFloat(process.env.DEMO_DEFAULT_LAT) || null;
    const defaultLng = parseFloat(process.env.DEMO_DEFAULT_LNG) || null;
    const defaultCity = process.env.DEMO_DEFAULT_CITY || '';
    const defaultState = process.env.DEMO_DEFAULT_STATE || '';
    const defaultRegion = process.env.DEMO_DEFAULT_REGION || defaultCity || '';

    let created = 0;
    let updated = 0;

    for (const party of tallyParties) {
      const existing = await Dealer.findOne({ $or: [{ tallyPartyId: party.name }, { name: party.name }] });
      if (existing) {
        existing.outstandingBalance = party.closingBalance || 0;
        existing.gstin = party.gstin || existing.gstin;
        existing.pan = party.pan || existing.pan;
        await existing.save();
        updated++;
      } else {
        // Spread default coordinates for dealer map positioning.
        // Individual dealers can be re-positioned later via PUT /dealers/:id/location.
        const jitterLat = defaultLat ? defaultLat + (Math.random() - 0.5) * 0.02 : null;
        const jitterLng = defaultLng ? defaultLng + (Math.random() - 0.5) * 0.02 : null;

        await Dealer.create({
          name: party.name,
          displayName: party.name,
          address: party.address || '',
          city: defaultCity,
          state: defaultState,
          latitude: jitterLat,
          longitude: jitterLng,
          region: defaultRegion,
          group: party.group || 'Sundry Debtors',
          parent: party.parent || 'Sundry Debtors',
          gstin: party.gstin || '',
          pan: party.pan || '',
          outstandingBalance: party.closingBalance || 0,
          tallyPartyId: party.name,
          creditLimit: party.creditLimit || 0,
        });
        created++;
      }
    }

    logger.info(`Dealer sync from Tally: ${created} created, ${updated} updated`);

    notificationEvent.dealerSyncComplete(created, updated).catch(() => {});

    return { created, updated, total: tallyParties.length };
  }

  async syncFromSetu() {
    const secret = process.env.SETU_HMAC_SECRET;
    if (!secret) throw new Error('SETU_HMAC_SECRET is not configured');

    const base = (process.env.SETU_SYNC_BASE_URL || process.env.SETU_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const body = JSON.stringify({ purpose: 'dealer-directory' });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    let response;
    try {
      response = await fetch(`${base}/api/setu/dealer-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Setu-Signature': signature },
        body,
        signal: AbortSignal.timeout(parseInt(process.env.SETU_SYNC_TIMEOUT_MS || '10000', 10)),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : (err.cause?.code || err.message);
      throw new Error(`SETU is unreachable (${reason})`);
    }

    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok || !parsed?.success) {
      throw new Error(parsed?.message || `SETU responded with HTTP ${response.status}`);
    }

    const entries = Array.isArray(parsed.data?.dealers) ? parsed.data.dealers : [];

    // Same env-driven defaults as the Tally sync — no hardcoded locations.
    const defaultLat = parseFloat(process.env.DEMO_DEFAULT_LAT) || null;
    const defaultLng = parseFloat(process.env.DEMO_DEFAULT_LNG) || null;
    const defaultCity = process.env.DEMO_DEFAULT_CITY || '';
    const defaultState = process.env.DEMO_DEFAULT_STATE || '';
    const defaultRegion = process.env.DEMO_DEFAULT_REGION || defaultCity || '';

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of entries) {
      const gstin = String(entry.gstin || '').trim().toUpperCase();
      const email = String(entry.email || '').trim().toLowerCase();
      const or = [];
      if (entry.setuCustomerId) or.push({ setuCustomerId: entry.setuCustomerId });
      if (gstin) or.push({ gstin });
      if (email) or.push({ email });

      const existing = or.length > 0 ? await Dealer.findOne({ $or: or }) : null;

      if (existing) {
        if (entry.name) {
          existing.name = entry.name;
          if (!existing.displayName) existing.displayName = entry.name;
        }
        if (entry.contactPerson) existing.contactPerson = entry.contactPerson;
        if (email) existing.email = email;
        if (entry.phone) existing.phone = entry.phone;
        if (entry.address) existing.address = entry.address;
        if (gstin) existing.gstin = gstin;
        if (entry.setuCustomerId && !existing.setuCustomerId) existing.setuCustomerId = entry.setuCustomerId;
        await existing.save();
        updated++;
        continue;
      }

      if (!entry.name) {
        skipped++;
        continue;
      }

      const jitterLat = defaultLat ? defaultLat + (Math.random() - 0.5) * 0.02 : null;
      const jitterLng = defaultLng ? defaultLng + (Math.random() - 0.5) * 0.02 : null;

      await this.createDealer({
        name: entry.name,
        displayName: entry.name,
        contactPerson: entry.contactPerson || '',
        email,
        phone: entry.phone || '',
        address: entry.address || '',
        city: defaultCity,
        state: defaultState,
        region: defaultRegion,
        latitude: jitterLat,
        longitude: jitterLng,
        gstin,
        setuCustomerId: entry.setuCustomerId || '',
      });
      created++;
    }

    logger.info(`Dealer sync from SETU: ${created} created, ${updated} updated, ${skipped} skipped`);
    notificationEvent.dealerSyncComplete(created, updated).catch(() => {});

    return { created, updated, skipped, total: entries.length, source: 'setu' };
  }

  async syncOutstandingFromTally() {
    const outstanding = await TallyOutstanding.find().lean();
    const dealerMap = new Map();

    for (const bill of outstanding) {
      const name = bill.partyName || bill.ledgerName;
      if (!name) continue;
      if (!dealerMap.has(name)) dealerMap.set(name, { total: 0, overdue: 0, bills: [] });
      const entry = dealerMap.get(name);
      entry.total += bill.balance || bill.amount || 0;
      entry.bills.push(bill);
      if (bill.dueDate && new Date(bill.dueDate) < new Date()) {
        entry.overdue += bill.balance || bill.amount || 0;
      }
    }

    let updated = 0;
    for (const [name, data] of dealerMap) {
      const result = await Dealer.updateOne(
        { name },
        { outstandingBalance: data.total, overdueAmount: data.overdue }
      );
      if (result.modifiedCount > 0) updated++;
    }

    return { updated, totalDealers: dealerMap.size };
  }

  async getDealerStats() {
    const stats = await Dealer.aggregate([
      { $match: { isActive: true } },
      { $group: {
        _id: null,
        totalDealers: { $sum: 1 },
        totalOutstanding: { $sum: '$outstandingBalance' },
        totalOverdue: { $sum: '$overdueAmount' },
        avgOutstanding: { $avg: '$outstandingBalance' },
        maxOutstanding: { $max: '$outstandingBalance' },
      }},
    ]);

    const regionStats = await Dealer.aggregate([
      { $match: { isActive: true } },
      { $group: {
        _id: '$region',
        count: { $sum: 1 },
        outstanding: { $sum: '$outstandingBalance' },
      }},
      { $sort: { outstanding: -1 } },
    ]);

    const topOverdue = await Dealer.find({ isActive: true, overdueAmount: { $gt: 0 } })
      .sort({ overdueAmount: -1 })
      .limit(10)
      .select('name city overdueAmount outstandingBalance lastVisitDate')
      .lean();

    return {
      summary: stats[0] || { totalDealers: 0, totalOutstanding: 0, totalOverdue: 0 },
      byRegion: regionStats,
      topOverdue,
    };
  }

  async updateDealerLocation(id, { latitude, longitude, address, city, region, area }) {
    const update = {};
    if (latitude !== undefined) update.latitude = latitude;
    if (longitude !== undefined) update.longitude = longitude;
    if (address !== undefined) update.address = address;
    if (city !== undefined) update.city = city;
    if (region !== undefined) update.region = region;
    if (area !== undefined) update.area = area;
    return Dealer.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  }

  async bulkUpdateLocations(locations) {
    let updated = 0;
    for (const loc of locations) {
      if (!loc.dealerId) continue;
      const result = await Dealer.findByIdAndUpdate(
        loc.dealerId,
        {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.address && { address: loc.address }),
          ...(loc.city && { city: loc.city }),
          ...(loc.region && { region: loc.region }),
          ...(loc.area && { area: loc.area }),
        },
        { new: true }
      );
      if (result) updated++;
    }
    return { updated };
  }

  async getRegions() {
    return Dealer.distinct('region', { isActive: true, region: { $ne: '' } });
  }

  async getCities() {
    return Dealer.distinct('city', { isActive: true, city: { $ne: '' } });
  }
}

export default new DealerService();
