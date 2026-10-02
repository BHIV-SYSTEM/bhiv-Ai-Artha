import Decimal from 'decimal.js';

export const GST_VALIDATION_ERROR_CODE = 'GST_VALIDATION_ERROR';

const ALLOWED_RATES = [0, 5, 12, 18, 28];

// Canonical state names. GSTIN state codes (2-digit), postal abbreviations
// (e.g. DL, MH) and enum-style values (UTTAR_PRADESH) all resolve here so
// interstate vs intra-state detection compares like with like.
const GSTIN_STATE_CODES = {
  '01': 'JAMMU & KASHMIR', '02': 'HIMACHAL PRADESH', '03': 'PUNJAB',
  '04': 'CHANDIGARH', '05': 'UTTARAKHAND', '06': 'HARYANA', '07': 'DELHI',
  '08': 'RAJASTHAN', '09': 'UTTAR PRADESH', '10': 'BIHAR', '11': 'SIKKIM',
  '12': 'ARUNACHAL PRADESH', '13': 'NAGALAND', '14': 'MANIPUR',
  '15': 'MIZORAM', '16': 'TRIPURA', '17': 'MEGHALAYA', '18': 'ASSAM',
  '19': 'WEST BENGAL', '20': 'JHARKHAND', '21': 'ODISHA', '22': 'CHHATTISGARH',
  '23': 'MADHYA PRADESH', '24': 'GUJARAT', '25': 'DADRA & NAGAR HAVELI AND DAMAN & DIU',
  '26': 'DADRA & NAGAR HAVELI AND DAMAN & DIU', '27': 'MAHARASHTRA',
  '29': 'KARNATAKA', '30': 'GOA', '31': 'LAKSHADWEEP', '32': 'KERALA',
  '33': 'TAMIL NADU', '34': 'PUDUCHERRY', '35': 'ANDAMAN & NICOBAR ISLANDS',
  '36': 'TELANGANA', '37': 'ANDHRA PRADESH', '38': 'LADAKH',
};

const STATE_ALIASES = {
  AP: 'ANDHRA PRADESH', AR: 'ARUNACHAL PRADESH', AS: 'ASSAM', BR: 'BIHAR',
  CH: 'CHANDIGARH', CG: 'CHHATTISGARH', DH: 'DELHI', DL: 'DELHI', DN: 'DELHI',
  GA: 'GOA', GJ: 'GUJARAT', HR: 'HARYANA', HP: 'HIMACHAL PRADESH',
  JK: 'JAMMU & KASHMIR', JH: 'JHARKHAND', KA: 'KARNATAKA', KL: 'KERALA',
  LA: 'LADAKH', LD: 'LAKSHADWEEP', MP: 'MADHYA PRADESH', MH: 'MAHARASHTRA',
  MN: 'MANIPUR', ML: 'MEGHALAYA', MZ: 'MIZORAM', NL: 'NAGALAND',
  OD: 'ODISHA', OR: 'ODISHA', PB: 'PUNJAB', PY: 'PUDUCHERRY',
  RJ: 'RAJASTHAN', SK: 'SIKKIM', TN: 'TAMIL NADU', TR: 'TRIPURA',
  TS: 'TELANGANA', UA: 'UTTARAKHAND', UK: 'UTTARAKHAND', UP: 'UTTAR PRADESH',
  WB: 'WEST BENGAL', DD: 'DADRA & NAGAR HAVELI AND DAMAN & DIU',
};

const normalizeState = (state) => {
  const raw = String(state || '').trim().toUpperCase();
  if (!raw) return '';
  if (GSTIN_STATE_CODES[raw]) return GSTIN_STATE_CODES[raw];
  if (STATE_ALIASES[raw]) return STATE_ALIASES[raw];
  return raw.replace(/[_\s]+/g, ' ').trim();
};

const isAllowedRate = (rate) => {
  if (rate === null || rate === undefined || rate === '') return false;
  const rateDecimal = new Decimal(rate);
  return ALLOWED_RATES.some((allowed) => rateDecimal.equals(new Decimal(allowed)));
};

export const buildGSTValidationError = (message, details = {}) => {
  const error = new Error(message);
  error.code = GST_VALIDATION_ERROR_CODE;
  error.details = details;
  return error;
};

export const calculateGSTBreakdown = (input) => {
  const {
    transaction_type,
    amount,
    gst_rate,
    supplier_state,
    company_state,
  } = input || {};

  if (!transaction_type || !['sale', 'purchase'].includes(transaction_type)) {
    throw buildGSTValidationError('Invalid transaction type for GST', {
      field: 'transaction_type',
      value: transaction_type,
    });
  }

  if (amount === null || amount === undefined || amount === '') {
    throw buildGSTValidationError('GST amount is required', {
      field: 'amount',
      value: amount,
    });
  }

  if (!isAllowedRate(gst_rate)) {
    throw buildGSTValidationError('Invalid GST rate', {
      field: 'gst_rate',
      value: gst_rate,
      allowed: ALLOWED_RATES,
    });
  }

  const supplierState = normalizeState(supplier_state);
  const companyState = normalizeState(company_state);

  if (!supplierState || !companyState) {
    throw buildGSTValidationError('GST state values are required', {
      supplier_state,
      company_state,
    });
  }

  const taxableValue = new Decimal(amount);

  if (taxableValue.isNegative()) {
    throw buildGSTValidationError('GST amount cannot be negative', {
      field: 'amount',
      value: amount,
    });
  }

  const rateDecimal = new Decimal(gst_rate);
  const gstAmount = taxableValue.times(rateDecimal).dividedBy(100).toDecimalPlaces(2);
  const isInterstate = supplierState !== companyState;

  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);

  if (isInterstate) {
    igst = gstAmount;
  } else {
    cgst = gstAmount.dividedBy(2).toDecimalPlaces(2);
    sgst = gstAmount.minus(cgst);
  }

  const totalAmount = taxableValue.plus(gstAmount).toDecimalPlaces(2);

  return {
    taxable_value: taxableValue.toDecimalPlaces(2).toString(),
    cgst: cgst.toString(),
    sgst: sgst.toString(),
    igst: igst.toString(),
    total_amount: totalAmount.toString(),
    transaction_type,
    gst_rate: rateDecimal.toNumber(),
    supplier_state: supplierState,
    company_state: companyState,
    is_interstate: isInterstate,
  };
};

export const validateGSTDetailShape = (detail) => {
  if (!detail || typeof detail !== 'object') {
    throw buildGSTValidationError('GST detail is missing', {
      field: 'gstDetails',
    });
  }

  const requiredFields = [
    'transaction_type',
    'gst_rate',
    'supplier_state',
    'company_state',
    'taxable_value',
    'cgst',
    'sgst',
    'igst',
  ];

  const missingFields = requiredFields.filter((field) => detail[field] === undefined || detail[field] === null);
  if (missingFields.length) {
    throw buildGSTValidationError('GST detail has missing fields', {
      missingFields,
    });
  }

  if (!isAllowedRate(detail.gst_rate)) {
    throw buildGSTValidationError('Invalid GST rate in detail', {
      field: 'gst_rate',
      value: detail.gst_rate,
      allowed: ALLOWED_RATES,
    });
  }

  return true;
};

export const GST_ENGINE = {
  calculateGSTBreakdown,
  validateGSTDetailShape,
  normalizeState,
  isAllowedRate,
  allowedRates: () => [...ALLOWED_RATES],
};
