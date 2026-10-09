import crypto from 'node:crypto';
import logger from '../config/logger.js';
import invoiceService from '../services/invoice.service.js';
import expenseService from '../services/expense.service.js';
import Invoice from '../models/Invoice.js';
import Expense from '../models/Expense.js';
import User from '../models/User.js';
import SetuIngestEvent from '../models/SetuIngestEvent.js';
import { runWithScope } from '../utils/companyScope.js';
import {
  BizError,
  buildOrderConfirmedData,
  buildPurchaseApprovedData,
  entityOf,
  getIngestSecret,
  invoiceNumberForOrder,
  normalizePayment,
  orderCancelReason,
  parseTenantMap,
  verifySignature,
  validateEnvelope,
} from '../services/setuEventContract.service.js';

const newTraceId = () =>
  `TRC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8)}`;

async function handleOrderConfirmed(payload, ctx) {
  const data = buildOrderConfirmedData(payload);
  const existing = await Invoice.findOne({ invoiceNumber: data.invoiceNumber });
  if (existing) {
    return { idempotent: true, entity: entityOf('invoice', existing) };
  }
  const invoice = await invoiceService.createInvoice(data, ctx.userId);
  return { idempotent: false, entity: entityOf('invoice', invoice) };
}

async function handleOrderCancelled(payload, ctx) {
  const orderNumber = String(payload.orderNumber || '').trim();
  if (!orderNumber) throw new BizError(400, 'missing_field', 'payload.orderNumber is required');
  const invoiceNumber = invoiceNumberForOrder(orderNumber);
  const existing = await Invoice.findOne({ invoiceNumber });
  if (!existing) {
    return { idempotent: false, skipped: 'invoice_not_found', entity: null };
  }
  if (existing.status === 'cancelled') {
    return { idempotent: true, entity: entityOf('invoice', existing) };
  }
  try {
    await invoiceService.cancelInvoice(existing._id, orderCancelReason(payload), ctx.userId);
  } catch (err) {
    if (/payments/i.test(err.message || '')) {
      throw new BizError(409, 'cancel_blocked', err.message);
    }
    throw err;
  }
  const reloaded = await Invoice.findById(existing._id);
  return { idempotent: false, entity: entityOf('invoice', reloaded) };
}

async function handlePaymentReceived(payload, ctx) {
  const { invoiceNumber, payment } = normalizePayment(payload, ctx.eventId);
  const invoice = await Invoice.findOne({ invoiceNumber });
  if (!invoice) {
    throw new BizError(409, 'invoice_not_found', `No invoice ${invoiceNumber} for this company`);
  }
  const duplicate = (invoice.payments || []).some(
    (p) => String(p.reference) === String(payment.reference)
  );
  if (duplicate) {
    return { idempotent: true, entity: entityOf('invoice', invoice) };
  }
  await invoiceService.recordPayment(invoice._id, payment, ctx.userId);
  const reloaded = await Invoice.findById(invoice._id);
  return { idempotent: false, entity: entityOf('invoice', reloaded) };
}

async function handlePurchaseApproved(payload, ctx) {
  const data = buildPurchaseApprovedData(payload);
  const existing = await Expense.findOne({ description: data.description });
  if (existing) {
    return { idempotent: true, entity: entityOf('expense', existing) };
  }
  const expense = await expenseService.createExpense(data, ctx.userId);
  return { idempotent: false, entity: entityOf('expense', expense) };
}

const HANDLERS = {
  'order.confirmed': handleOrderConfirmed,
  'order.cancelled': handleOrderCancelled,
  'payment.received': handlePaymentReceived,
  'supplier.purchase-approved': handlePurchaseApproved,
};

export async function dispatchSetuEvent(event, ctx = {}) {
  const handler = HANDLERS[event.event_type];
  if (!handler) throw new BizError(400, 'unsupported_event', `Unsupported event_type '${event.event_type}'`);
  return handler(event.payload, { userId: ctx.userId || null, eventId: event.event_id, event });
}

export const processSetuEvent = async (req, res) => {
  const traceId =
    typeof req.headers['x-trace-id'] === 'string' && req.headers['x-trace-id']
      ? req.headers['x-trace-id']
      : newTraceId();

  const fail = (status, code, message) =>
    res.status(status).json({ success: false, code, message, trace_id: traceId });

  try {
    const secret = getIngestSecret();
    if (!secret) return fail(503, 'ingest_not_configured', 'SETU HMAC secret is not configured');

    const signature = req.headers['x-setu-signature'] || req.headers['x-hmac-signature'];
    if (!signature) return fail(401, 'missing_signature', 'Missing webhook signature');
    if (!verifySignature(req.body, signature, secret)) {
      return fail(401, 'invalid_signature', 'Signature verification failed');
    }

    const check = validateEnvelope(req.body);
    if (!check.valid) return fail(400, 'invalid_envelope', check.message);

    const event = req.body;

    const tenantMap = parseTenantMap();
    const mapping = tenantMap[event.tenant_id];
    if (!mapping || !mapping.user_id) {
      return fail(503, 'tenant_not_provisioned', `Tenant '${event.tenant_id}' is not provisioned in ARTHA`);
    }

    const serviceUser = await User.findOne({ _id: mapping.user_id, isActive: true }).select(
      '_id email role companyId'
    );
    if (!serviceUser) {
      return fail(503, 'tenant_not_provisioned', `Service user for tenant '${event.tenant_id}' is not active`);
    }

    const replayById = await SetuIngestEvent.findOne({ eventId: event.event_id });
    if (replayById) {
      return res.json({
        success: true,
        data: {
          event_id: event.event_id,
          event_type: event.event_type,
          ...replayById.result,
          idempotent: true,
        },
        trace_id: traceId,
      });
    }
    if (event.idempotency_key) {
      const replayByKey = await SetuIngestEvent.findOne({
        tenantId: event.tenant_id,
        eventType: event.event_type,
        idempotencyKey: event.idempotency_key,
        status: 'PROCESSED',
      }).sort({ createdAt: 1 });
      if (replayByKey) {
        return res.json({
          success: true,
          data: {
            event_id: event.event_id,
            event_type: event.event_type,
            ...replayByKey.result,
            idempotent: true,
          },
          trace_id: traceId,
        });
      }
    }

    const result = await runWithScope(
      {
        workspace: serviceUser.companyId || serviceUser._id,
        userId: serviceUser._id,
        role: serviceUser.role || 'accountant',
        crossCompany: false,
      },
      () => dispatchSetuEvent(event, { userId: serviceUser._id })
    );

    try {
      await SetuIngestEvent.create({
        eventId: event.event_id,
        tenantId: event.tenant_id,
        eventType: event.event_type,
        idempotencyKey: event.idempotency_key || null,
        status: 'PROCESSED',
        result: { idempotent: result.idempotent, skipped: result.skipped || null, entity: result.entity || null },
        traceId,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        logger.warn(`SETU ingest duplicate event store for ${event.event_id} (concurrent replay)`);
      } else {
        logger.warn(`SETU ingest event store failed for ${event.event_id}: ${err.message}`);
      }
    }

    return res.json({
      success: true,
      data: {
        event_id: event.event_id,
        event_type: event.event_type,
        idempotent: Boolean(result.idempotent),
        skipped: result.skipped || null,
        entity: result.entity || null,
      },
      trace_id: traceId,
    });
  } catch (err) {
    if (err instanceof BizError) {
      return fail(err.status, err.code, err.message);
    }
    logger.error(`SETU ingest error: ${err.message}`, { traceId, stack: err.stack });
    return fail(500, 'ingest_error', err.message || 'Event processing failed');
  }
};
