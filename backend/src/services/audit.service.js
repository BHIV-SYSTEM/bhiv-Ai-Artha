import crypto from 'crypto';
import AuditEvent from '../models/AuditEvent.js';
import logger from '../config/logger.js';

class AuditService {
  constructor() {
    this._initialized = false;
    this._initPromise = null;
  }

  async init() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    await this._initPromise;
    this._initialized = true;
  }

  async _doInit() {
    try {
      const lastEvent = await AuditEvent.findOne({}).sort({ chainPosition: -1 }).select('hash chainPosition');
      if (lastEvent) {
        this._lastHash = lastEvent.hash;
        this._chainPosition = lastEvent.chainPosition;
      } else {
        this._lastHash = '0';
        this._chainPosition = 0;
      }
    } catch (err) {
      logger.error('AuditService init failed:', err);
      this._lastHash = '0';
      this._chainPosition = 0;
    }
  }

  async _getNextPositionAndHash(eventData) {
    await this.init();

    const lastHash = this._lastHash || '0';
    const nextPosition = (this._chainPosition || 0) + 1;

    const hash = this.computeHash(eventData, lastHash);

    this._lastHash = hash;
    this._chainPosition = nextPosition;

    return { previousHash: lastHash, chainPosition: nextPosition, hash };
  }

  computeHash(eventData, previousHash) {
    const payload = JSON.stringify({
      eventId: eventData.eventId,
      eventType: eventData.eventType,
      entityType: eventData.entityType,
      entityId: eventData.entityId,
      action: eventData.action,
      actorId: eventData.actor?.userId?.toString(),
      timestamp: eventData.createdAt?.toISOString?.() || new Date().toISOString(),
      previousHash,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Legacy callers pass `{ eventType, userId, details }` while the model
   * requires `action`, `description` and `actor.userId`. Fill the gaps here
   * (single choke point) instead of touching every call site.
   */
  _normalize(data) {
    const actorUserId = data.actor?.userId || data.userId;
    const action = data.action || data.eventType;
    let description = data.description;
    if (!description) {
      const detail = data.details && Object.keys(data.details).length
        ? Object.entries(data.details).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
        : '';
      description = detail ? `${action}: ${detail}` : `${data.entityType} ${action}`;
      if (description.length > 500) description = `${description.slice(0, 497)}...`;
    }
    let category = data.category;
    if (!category) {
      if (/^(GSTR|FORM\d|GST_|TDS_)/.test(data.eventType)) category = 'compliance';
      else if (/^(INVOICE|EXPENSE|JOURNAL|BANK|RECONCILIATION|BALANCE_SHEET|CASH_FLOW|PROFIT_LOSS|TRIAL_BALANCE)/.test(data.eventType)) category = 'financial';
      else category = 'system';
    }
    return {
      ...data,
      actorUserId,
      action,
      description,
      category,
      actor: { ...data.actor, userId: actorUserId },
    };
  }

  async recordEvent(rawData) {
    try {
      const data = this._normalize(rawData);
      await this.init();

      if (!data.actorUserId) {
        logger.warn('Audit event skipped: no actor user', {
          eventType: data.eventType,
          entityType: data.entityType,
          entityId: String(data.entityId),
        });
        return null;
      }

      const eventId = AuditEvent.generateEventId();

      const tempEvent = {
        eventId,
        eventType: data.eventType,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        actor: data.actor,
        createdAt: new Date(),
      };

      const { previousHash, chainPosition, hash } = await this._getNextPositionAndHash(tempEvent);

      const event = new AuditEvent({
        eventId,
        eventType: data.eventType,
        category: data.category,
        severity: data.severity || 'info',
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        description: data.description,
        actor: {
          userId: data.actor.userId,
          email: data.actor.email,
          name: data.actor.name,
          role: data.actor.role,
          ip: data.actor.ip,
          userAgent: data.actor.userAgent,
        },
        before: data.before || null,
        after: data.after || null,
        financialImpact: data.financialImpact || undefined,
        traceId: data.traceId,
        parentEventId: data.parentEventId,
        correlationId: data.correlationId,
        regulatoryRequired: data.regulatoryRequired || false,
        retentionDays: data.retentionDays || 2555,
        previousHash,
        chainPosition,
        hash,
      });

      await event.save();
      return event;
    } catch (err) {
      logger.error('Audit event recording failed:', err);
      return null;
    }
  }

  async verifyChain() {
    const events = await AuditEvent.find({}).sort({ chainPosition: 1 });
    if (events.length === 0) return { isValid: true, totalEntries: 0, errors: [] };

    const errors = [];
    let expectedPrevHash = '0';

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const computedHash = this.computeHash(event.toObject(), event.previousHash);

      if (event.previousHash !== expectedPrevHash) {
        errors.push({
          position: event.chainPosition,
          eventId: event.eventId,
          issue: 'Chain linkage broken',
          expectedPrevHash,
          actualPrevHash: event.previousHash,
        });
      }

      if (computedHash !== event.hash) {
        errors.push({
          position: event.chainPosition,
          eventId: event.eventId,
          issue: 'Hash mismatch',
          expectedHash: computedHash,
          actualHash: event.hash,
        });
      }

      expectedPrevHash = event.hash;
    }

    return {
      isValid: errors.length === 0,
      totalEntries: events.length,
      errors,
      chainLength: events.length,
    };
  }

  async getEntityAuditTrail(entityType, entityId, options = {}) {
    const { limit = 50, offset = 0, startDate, endDate } = options;
    const query = { entityType, entityId };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [events, total] = await Promise.all([
      AuditEvent.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit)
        .populate('actor.userId', 'name email role'),
      AuditEvent.countDocuments(query),
    ]);

    return { events, total, hasMore: offset + limit < total };
  }

  async getAuditSummary(filters = {}) {
    const { startDate, endDate, category, eventType } = filters;
    const match = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }
    if (category) match.category = category;
    if (eventType) match.eventType = eventType;

    const [byType, byCategory, bySeverity, byUser, dailyActivity] = await Promise.all([
      AuditEvent.aggregate([
        { $match: match },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditEvent.aggregate([
        { $match: match },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
      AuditEvent.aggregate([
        { $match: match },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      AuditEvent.aggregate([
        { $match: match },
        { $group: { _id: '$actor.userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      AuditEvent.aggregate([
        { $match: match },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    return { byType, byCategory, bySeverity, byUser, dailyActivity };
  }

  async recordUserAction(data) {
    return this.recordEvent({ ...data, eventType: 'USER_ACTION', category: data.category || 'system' });
  }

  async recordApproval(data) {
    return this.recordEvent({ ...data, eventType: 'APPROVAL', category: 'financial', severity: 'info' });
  }

  async recordRejection(data) {
    return this.recordEvent({ ...data, eventType: 'REJECTION', category: 'financial', severity: 'warning' });
  }

  async recordRoleChange(data) {
    return this.recordEvent({
      ...data, eventType: 'ROLE_CHANGE', category: 'admin', severity: 'warning',
      regulatoryRequired: true,
    });
  }

  async recordConfigChange(data) {
    return this.recordEvent({
      ...data, eventType: 'CONFIG_CHANGE', category: 'admin', severity: 'info',
      regulatoryRequired: true,
    });
  }

  async recordCorrection(data) {
    return this.recordEvent({
      ...data, eventType: 'CORRECTION', category: 'financial', severity: 'warning',
      regulatoryRequired: true,
    });
  }

  async recordReversal(data) {
    return this.recordEvent({
      ...data, eventType: 'REVERSAL', category: 'financial', severity: 'warning',
      regulatoryRequired: true,
    });
  }

  async recordFiling(data) {
    return this.recordEvent({
      ...data, eventType: 'FILING', category: 'compliance', severity: 'info',
      regulatoryRequired: true,
    });
  }

  async recordLogin(data) {
    return this.recordEvent({ ...data, eventType: 'LOGIN', category: 'security', severity: 'info' });
  }

  async recordLogout(data) {
    return this.recordEvent({ ...data, eventType: 'LOGOUT', category: 'security', severity: 'info' });
  }

  async exportAuditTrail(filters = {}, _format = 'json') {
    const events = await AuditEvent.find(filters).sort({ createdAt: 1 }).lean();
    return events;
  }
}

export default new AuditService();
