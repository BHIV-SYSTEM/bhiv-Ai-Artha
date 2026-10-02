import multiCompanyService from '../services/multiCompany.service.js';
import logger from '../config/logger.js';
import { allowCrossCompany } from '../utils/companyScope.js';

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
}

export default new MultiCompanyController();
