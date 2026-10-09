import multiCompanyService from '../services/multiCompany.service.js';
import logger from '../config/logger.js';
import { allowCrossCompany } from '../utils/companyScope.js';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import TallySyncRun from '../models/TallySyncRun.js';
import AuditEvent from '../models/AuditEvent.js';
import BankStatement from '../models/BankStatement.js';
import IngestDocument from '../models/IngestDocument.js';
import GSTReturn from '../models/GSTReturn.js';
import TDSEntry from '../models/TDSEntry.js';
import healthService from '../services/health.service.js';

/**
 * Company records are the workspace containers created and managed by the
 * super admin only. Everything else (cost centres, branches listing, ...)
 * stays available within a user's own workspace via the companyScope plugin.
 */
function requireSuperAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Only the super admin can manage companies' });
    return false;
  }
  return true;
}

class MultiCompanyController {
  async createCompany(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      const company = await multiCompanyService.createCompany(req.body, req.user._id);
      res.status(201).json({ success: true, data: company });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getCompanies(req, res) {
    try {
      const companies = await multiCompanyService.getCompanies(req.query, req.user);
      res.json({ success: true, data: companies });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getCompany(req, res) {
    try {
      const company = await multiCompanyService.getCompany(req.params.id);
      const isOwner = (company.owners || []).some((o) => String(o) === String(req.user._id));
      const isMember = req.user.companyId && String(req.user.companyId) === String(company._id);
      if (req.user.role !== 'admin' && !isOwner && !isMember) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }
      res.json({ success: true, data: company });
    } catch (err) {
      res.status(404).json({ success: false, message: err.message });
    }
  }

  async updateCompany(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      const company = await multiCompanyService.updateCompany(req.params.id, req.body, req.user._id);
      res.json({ success: true, data: company });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async createBranch(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      const branch = await multiCompanyService.createBranch(req.body, req.user._id);
      res.status(201).json({ success: true, data: branch });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getBranches(req, res) {
    try {
      const branches = await multiCompanyService.getBranches(req.params.companyId);
      res.json({ success: true, data: branches });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getConsolidatedReport(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      allowCrossCompany();
      const report = await multiCompanyService.generateConsolidatedReport(
        req.params.companyId, req.body.dateRange
      );
      res.json({ success: true, data: report });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getConsolidatedTrialBalance(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      allowCrossCompany();
      const trialBalance = await multiCompanyService.getConsolidatedTrialBalance(
        req.body.companyIds, req.body.asOfDate
      );
      res.json({ success: true, data: trialBalance });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async createCostCentre(req, res) {
    try {
      const centre = await multiCompanyService.createCostCentre(req.body, req.user._id);
      res.status(201).json({ success: true, data: centre });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getCostCentres(req, res) {
    try {
      const centres = await multiCompanyService.getCostCentres(req.query);
      res.json({ success: true, data: centres });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Super-admin platform overview: tenants, their users and activity.
   * Backs the technical dashboard - not business bookkeeping.
   */
  async getPlatformStats(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      allowCrossCompany();

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [
        companies, admins, roleGroups, invoiceStats, expenseStats,
        allUsers, recentEvents, failedSyncs, failedBankDocs, failedIngestDocs, health,
        adminActivityAgg, stmtStats, ingestStats, tallyStats, gstStats, tdsStats,
      ] = await Promise.all([
        Company.find({}).select('name legalName gstin status createdAt').sort({ createdAt: -1 }).lean(),
        User.find({ role: 'sub_admin', companyId: { $ne: null } })
          .select('name email companyId lastLogin isActive').lean(),
        User.aggregate([
          { $group: { _id: { companyId: '$companyId', role: '$role' }, count: { $sum: 1 } } },
        ]),
        Invoice.aggregate([
          { $group: { _id: '$companyId', count: { $sum: 1 }, amount: { $sum: { $convert: { input: '$totalAmount', to: 'double', onError: 0, onNull: 0 } } }, lastAt: { $max: '$createdAt' } } },
        ]),
        Expense.aggregate([
          { $group: { _id: '$companyId', count: { $sum: 1 }, amount: { $sum: { $convert: { input: '$totalAmount', to: 'double', onError: 0, onNull: 0 } } }, lastAt: { $max: '$createdAt' } } },
        ]),
        User.find({})
          .select('name email role companyId lastLogin isActive').sort({ email: 1 }).lean(),
        AuditEvent.find({})
          .select('eventType category severity action description actor createdAt')
          .sort({ createdAt: -1 }).limit(15).lean(),
        TallySyncRun.find({ status: { $in: ['failed', 'partial'] }, startedAt: { $gte: sevenDaysAgo } })
          .select('status startedAt company companyId tenantId errors')
          .sort({ startedAt: -1 }).limit(10).lean(),
        BankStatement.find({ status: 'failed' })
          .select('filename companyId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
        IngestDocument.find({ status: 'failed' })
          .select('filename companyId createdAt').sort({ createdAt: -1 }).limit(10).lean(),
        healthService.getSystemHealth(),
        // Admin productivity: audit actions per actor in the last 30 days.
        AuditEvent.aggregate([
          { $match: { createdAt: { $gte: thirtyDaysAgo }, 'actor.userId': { $ne: null } } },
          { $group: { _id: '$actor.userId', actions: { $sum: 1 }, lastActionAt: { $max: '$createdAt' } } },
        ]),
        // Per-tenant data volume / product usage.
        BankStatement.aggregate([{ $group: { _id: '$companyId', count: { $sum: 1 } } }]),
        IngestDocument.aggregate([{ $group: { _id: '$companyId', count: { $sum: 1 } } }]),
        TallySyncRun.aggregate([{ $group: { _id: '$companyId', count: { $sum: 1 } } }]),
        GSTReturn.aggregate([{ $group: { _id: '$companyId', count: { $sum: 1 } } }]),
        TDSEntry.aggregate([{ $group: { _id: '$companyId', count: { $sum: 1 } } }]),
      ]);

      const roleCount = (companyId, role) => {
        const match = roleGroups.find(
          (g) => g._id.role === role &&
            (companyId ? String(g._id.companyId) === String(companyId) : !g._id.companyId)
        );
        return match ? match.count : 0;
      };
      const adminFor = (companyId) =>
        admins.find((a) => String(a.companyId) === String(companyId)) || null;
      const invFor = (companyId) =>
        invoiceStats.find((s) => String(s._id) === String(companyId)) || { count: 0, amount: 0 };
      const expFor = (companyId) =>
        expenseStats.find((s) => String(s._id) === String(companyId)) || { count: 0, amount: 0 };
      const cntFor = (arr, companyId) => {
        const hit = arr.find((s) => String(s._id) === String(companyId));
        return hit ? hit.count : 0;
      };

      const tenantRows = companies.map((c) => {
        const admin = adminFor(c._id);
        const inv = invFor(c._id);
        const exp = expFor(c._id);
        const stmts = cntFor(stmtStats, c._id);
        const ingests = cntFor(ingestStats, c._id);
        const tallyRuns = cntFor(tallyStats, c._id);
        const gstReturns = cntFor(gstStats, c._id);
        const tdsEntries = cntFor(tdsStats, c._id);
        const products = [];
        if (inv.count > 0 || exp.count > 0) products.push('bookkeeping');
        if (stmts > 0) products.push('bank_statements');
        if (ingests > 0) products.push('data_ingestion');
        if (tallyRuns > 0) products.push('tally');
        if (gstReturns > 0) products.push('gst');
        if (tdsEntries > 0) products.push('tds');
        const activityDates = [inv.lastAt, exp.lastAt].filter(Boolean).map((d) => new Date(d).getTime());
        return {
          _id: c._id,
          name: c.name || c.legalName || 'Unnamed',
          gstin: c.gstin || '',
          status: c.status || 'active',
          createdAt: c.createdAt,
          admin: admin
            ? { _id: admin._id, name: admin.name, email: admin.email, lastLogin: admin.lastLogin, isActive: admin.isActive }
            : null,
          users: {
            admin: admins.filter((a) => String(a.companyId) === String(c._id)).length,
            accountant: roleCount(c._id, 'accountant'),
            viewer: roleCount(c._id, 'viewer'),
            total: 1 + roleCount(c._id, 'accountant') + roleCount(c._id, 'viewer'),
          },
          invoices: inv.count,
          expenses: exp.count,
          volume: {
            invoices: inv.count,
            invoiceValue: Math.round((inv.amount || 0) * 100) / 100,
            expenses: exp.count,
            expenseValue: Math.round((exp.amount || 0) * 100) / 100,
            statements: stmts,
            ingestDocs: ingests,
            tallyRuns,
            gstReturns,
            tdsEntries,
            totalRecords: inv.count + exp.count + stmts + ingests + tallyRuns + gstReturns + tdsEntries,
          },
          products,
          lastActivityAt: activityDates.length ? new Date(Math.max(...activityDates)).toISOString() : null,
        };
      });

      const sumRole = (role) =>
        roleGroups.filter((g) => g._id.role === role).reduce((sum, g) => sum + g.count, 0);

      // Admin leaderboard: sub-accounts owned, own audit activity (30d), tenant data under them.
      const activityByUser = new Map(
        adminActivityAgg.map((a) => [String(a._id), a])
      );
      const adminLeaderboard = admins
        .map((a) => {
          const tenant = tenantRows.find((t) => String(t._id) === String(a.companyId));
          const act = activityByUser.get(String(a._id));
          return {
            _id: a._id,
            name: a.name,
            email: a.email,
            companyName: tenant ? tenant.name : 'Unknown',
            isActive: a.isActive,
            lastLogin: a.lastLogin,
            subAccounts: tenant ? tenant.users.accountant + tenant.users.viewer : 0,
            actions30d: act ? act.actions : 0,
            lastActionAt: act && act.lastActionAt ? act.lastActionAt : null,
            tenantRecords: tenant ? tenant.volume.totalRecords : 0,
            products: tenant ? tenant.products : [],
          };
        })
        .sort((x, y) =>
          y.actions30d - x.actions30d ||
          (new Date(y.lastLogin || 0) - new Date(x.lastLogin || 0))
        );

      const companyName = (companyId) => {
        if (!companyId) return null;
        const c = companies.find((x) => String(x._id) === String(companyId));
        return c ? (c.name || c.legalName || 'Unnamed') : null;
      };
      const userById = (userId) =>
        userId ? allUsers.find((u) => String(u._id) === String(userId)) || null : null;

      const accounts = allUsers.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        companyName: companyName(u.companyId) || 'Platform',
        lastLogin: u.lastLogin,
        isActive: u.isActive,
      }));

      const feed = recentEvents.map((e) => {
        const actorUser = userById(e.actor?.userId);
        return {
          _id: e._id,
          eventType: e.eventType,
          category: e.category,
          severity: e.severity,
          description: e.description,
          actor: {
            email: e.actor?.email || actorUser?.email || null,
            name: e.actor?.name || actorUser?.name || null,
            role: e.actor?.role || actorUser?.role || null,
          },
          companyName: companyName(actorUser?.companyId) || 'Platform',
          createdAt: e.createdAt,
        };
      });

      const syncTenant = (s) => companyName(s.companyId) || s.company || s.tenantId || 'Unknown';
      const neverSignedIn = admins
        .filter((a) => !a.lastLogin)
        .map((a) => ({ email: a.email, name: a.name, companyName: companyName(a.companyId) || 'Unknown' }));
      const dormantTenants = tenantRows
        .map((t) => ({
          name: t.name,
          daysSinceActivity: t.lastActivityAt
            ? Math.floor((Date.now() - new Date(t.lastActivityAt).getTime()) / 86400000)
            : null,
        }))
        .filter((t) => t.daysSinceActivity === null || t.daysSinceActivity > 30);
      const failedDocuments = [
        ...failedBankDocs.map((d) => ({ kind: 'bank_statement', filename: d.filename || 'Unnamed', companyName: companyName(d.companyId) || 'Unknown', createdAt: d.createdAt })),
        ...failedIngestDocs.map((d) => ({ kind: 'ingest', filename: d.filename || 'Unnamed', companyName: companyName(d.companyId) || 'Unknown', createdAt: d.createdAt })),
      ];

      res.json({
        success: true,
        data: {
          totals: {
            companies: companies.length,
            admins: sumRole('sub_admin'),
            accountants: sumRole('accountant'),
            viewers: sumRole('viewer'),
            platformUsers: sumRole('admin'),
            invoices: invoiceStats.reduce((sum, s) => sum + s.count, 0),
            expenses: expenseStats.reduce((sum, s) => sum + s.count, 0),
          },
          companies: tenantRows,
          adminLeaderboard,
          accounts,
          recentEvents: feed,
          attention: {
            failedSyncs: failedSyncs.map((s) => ({
              _id: s._id,
              status: s.status,
              startedAt: s.startedAt,
              companyName: syncTenant(s),
              error: s.errors?.[0]?.message || s.errors?.[0]?.error || null,
            })),
            neverSignedIn,
            dormantTenants,
            failedDocuments,
          },
          health,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error('Platform stats error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new MultiCompanyController();
