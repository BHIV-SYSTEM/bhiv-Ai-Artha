import crypto from 'node:crypto';

export const SETU_EVENT_TYPES = [
  'order.confirmed',
  'order.cancelled',
  'payment.received',
  'supplier.purchase-approved',
];

export const EXPENSE_CATEGORIES = [
  'travel', 'meals', 'supplies', 'utilities', 'rent', 'insurance',
  'marketing', 'professional_services', 'equipment', 'software', 'other',
];

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'check', 'card', 'upi', 'other'];

export const EXPENSE_PAYMENT_METHODS = ['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'other'];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class BizError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getIngestSecret() {
  return process.env.SETU_HMAC_SECRET || process.env.HMAC_SECRET || null;
}

export function computeSignature(body, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

export function verifySignature(body, signature, secret) {
  if (!signature || typeof signature !== 'string') return false;
  const expected = computeSignature(body, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function validateEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'Body must be a JSON object' };
  }
  for (const field of ['event_id', 'event_type', 'tenant_id']) {
    if (typeof body[field] !== 'string' || !body[field].trim()) {
      return { valid: false, message: `${field} is required` };
    }
  }
  if (!SETU_EVENT_TYPES.includes(body.event_type)) {
    return { valid: false, message: `Unsupported event_type '${body.event_type}'` };
  }
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return { valid: false, message: 'payload object is required' };
  }
  if (body.idempotency_key != null && typeof body.idempotency_key !== 'string') {
    return { valid: false, message: 'idempotency_key must be a string' };
  }
  return { valid: true };
}

export function parseTenantMap(raw = process.env.SETU_TENANT_MAP) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function money(value) {
  return num(value).toFixed(2);
}

export function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function invoiceNumberForOrder(orderNumber) {
  return `SETU-${String(orderNumber).trim()}`;
}

export function buildOrderConfirmedData(payload) {
  const orderNumber = String(payload.orderNumber || '').trim();
  if (!orderNumber) throw new BizError(400, 'missing_field', 'payload.orderNumber is required');

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) throw new BizError(400, 'missing_field', 'payload.items must contain at least one item');

  const items = rawItems.map((item) => {
    const quantity = num(item.quantity) || 1;
    const unitPrice = item.unitPrice != null ? num(item.unitPrice) : num(item.amount) / quantity;
    const amount = item.amount != null ? num(item.amount) : quantity * unitPrice;
    return {
      description: String(item.description || 'Item'),
      quantity,
      unitPrice: money(unitPrice),
      amount: money(amount),
      taxRate: 0,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + Number(item.amount), 0);
  const invoiceDate = parseDate(payload.orderDate, new Date());
  const dueDate = parseDate(payload.dueDate, new Date(invoiceDate.getTime() + 15 * 24 * 60 * 60 * 1000));

  const data = {
    invoiceNumber: invoiceNumberForOrder(orderNumber),
    customerName: String(payload.customerName || payload.clientName || 'SETU Client'),
    invoiceDate,
    dueDate,
    items,
    subtotal: money(subtotal),
    taxAmount: '0',
    taxRate: 0,
    totalAmount: money(subtotal),
    status: 'draft',
    source: 'api',
    notes: payload.notes
      ? String(payload.notes)
      : `Created from SETU order ${orderNumber}`,
    provenance: { sourceSystem: 'setu', externalReference: orderNumber },
  };

  if (typeof payload.customerEmail === 'string' && EMAIL_RE.test(payload.customerEmail)) {
    data.customerEmail = payload.customerEmail;
  }
  if (typeof payload.customerGSTIN === 'string' && GSTIN_RE.test(payload.customerGSTIN)) {
    data.customerGSTIN = payload.customerGSTIN;
  }
  if (payload.customerAddress) data.customerAddress = String(payload.customerAddress);
  if (payload.customerState) data.customerState = String(payload.customerState);

  return data;
}

export function buildPurchaseApprovedData(payload) {
  const restockId = String(payload.restockId || payload.referenceId || '').trim();
  if (!restockId) throw new BizError(400, 'missing_field', 'payload.restockId is required');

  const totalAmount = num(payload.totalAmount);
  if (!(totalAmount > 0)) {
    throw new BizError(400, 'invalid_amount', 'payload.totalAmount must be greater than 0');
  }
  const taxAmount = num(payload.taxAmount);

  const category =
    typeof payload.category === 'string' && EXPENSE_CATEGORIES.includes(payload.category)
      ? payload.category
      : 'supplies';
  const paymentMethod =
    typeof payload.paymentMethod === 'string' && EXPENSE_PAYMENT_METHODS.includes(payload.paymentMethod)
      ? payload.paymentMethod
      : 'other';

  return {
    vendor: String(payload.supplierName || payload.vendor || 'SETU Supplier'),
    description: `SETU restock ${restockId}`,
    amount: money(totalAmount),
    taxAmount: taxAmount > 0 ? money(taxAmount) : undefined,
    totalAmount: money(totalAmount + taxAmount),
    category,
    paymentMethod,
    date: parseDate(payload.date, new Date()),
    tags: ['setu'],
  };
}

export function normalizePayment(payload, eventId) {
  const invoiceNumber = payload.invoiceNumber
    ? String(payload.invoiceNumber).trim()
    : payload.orderNumber
      ? invoiceNumberForOrder(payload.orderNumber)
      : null;
  if (!invoiceNumber) {
    throw new BizError(400, 'missing_field', 'payload.invoiceNumber or payload.orderNumber is required');
  }
  const amount = num(payload.amount);
  if (!(amount > 0)) throw new BizError(400, 'invalid_amount', 'payload.amount must be greater than 0');

  const paymentMethod =
    typeof payload.paymentMethod === 'string' && PAYMENT_METHODS.includes(payload.paymentMethod)
      ? payload.paymentMethod
      : 'other';

  return {
    invoiceNumber,
    payment: {
      amount,
      paymentMethod,
      paymentDate: parseDate(payload.paymentDate, new Date()),
      reference: String(payload.reference || eventId),
      notes: payload.notes ? String(payload.notes) : undefined,
    },
  };
}

export function orderCancelReason(payload) {
  return payload.reason ? String(payload.reason) : 'Cancelled in SETU';
}

export function entityOf(type, doc, extra = {}) {
  if (!doc) return null;
  const number =
    doc.invoiceNumber || doc.expenseNumber || doc.orderNumber || null;
  const status = doc.status || null;
  return {
    type,
    id: String(doc._id),
    number,
    status,
    ...extra,
  };
}
