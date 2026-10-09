import auditService from '../services/audit.service.js';

// authorize('admin') expands sub_admin into 'admin' for route access; these
// endpoints return platform-wide, unscoped data, so check the RAW role here.
function requireSuperAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({
      success: false,
      message: 'Only the super admin can access platform-wide audit data',
    });
    return false;
  }
  return true;
}

class AuditController {
  async getEntityAuditTrail(req, res) {
    try {
      const { entityType, entityId } = req.params;
      const result = await auditService.getEntityAuditTrail(entityType, entityId, {
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getAuditSummary(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      const summary = await auditService.getAuditSummary(req.query);
      res.json({ success: true, data: summary });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async verifyAuditChain(req, res) {
    try {
      const result = await auditService.verifyChain();
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async exportAuditTrail(req, res) {
    try {
      if (!requireSuperAdmin(req, res)) return;
      const events = await auditService.exportAuditTrail(req.query);
      res.json({ success: true, data: events });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new AuditController();
