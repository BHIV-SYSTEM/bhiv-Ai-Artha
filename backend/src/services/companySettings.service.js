import CompanySettings from '../models/CompanySettings.js';
import { getScope } from '../utils/companyScope.js';
import logger from '../config/logger.js';

const DEFAULTS = {
  companyName: 'My Company',
  gstSettings: {
    isRegistered: true,
    filingFrequency: 'monthly',
  },
  tdsSettings: {
    isTANActive: true,
    autoCalculateTDS: true,
  },
  accountingSettings: {
    financialYearStart: {
      month: 4,
      day: 1,
    },
    baseCurrency: 'INR',
    decimalPlaces: 2,
  },
};

const UPDATABLE_FIELDS = [
  'companyName', 'name', 'legalName', 'address', 'phone', 'email', 'website',
  'gstin', 'pan', 'tan', 'cin', 'bankDetails', 'invoiceSettings', 'financialYear',
  'gstSettings', 'tdsSettings', 'accountingSettings',
  'logo', 'branding', 'notificationPreferences',
];

/** Fields with regex validators where '' should clear the value (null). */
const TAX_FIELDS = ['gstin', 'pan', 'tan'];

function currentWorkspace() {
  const scope = getScope();
  return scope && scope.workspace ? scope.workspace : null;
}

class CompanySettingsService {
/**
 * Get company settings for the current workspace (company members share one
 * document; a user without a company gets their own personal document).
 * Outside any request scope (scripts/jobs) falls back to reading the legacy
 * singleton through the native collection (its string _id cannot go through
 * mongoose casting anymore) or to a plain defaults object.
 */
async getSettings(options = {}) {
  const ws = currentWorkspace();

  if (ws) {
    let query = CompanySettings.findOne({ companyId: ws });
    if (options.session) query = query.session(options.session);
    let settings = await query;
    if (!settings) {
      settings = await CompanySettings.create({
        companyId: ws,
        name: DEFAULTS.companyName,
        ...DEFAULTS,
      });
      logger.info('Workspace company settings created');
    }
    return settings;
  }

  // No request scope: legacy singleton (native read, no cast) or defaults.
  try {
    const raw = await CompanySettings.collection.findOne({ _id: 'company_settings' });
    if (raw) return { ...DEFAULTS, ...raw, name: raw.name || raw.companyName || DEFAULTS.companyName };
  } catch (err) {
    logger.warn('Legacy company settings read failed:', err.message);
  }
  return { ...DEFAULTS, name: DEFAULTS.companyName };
}

/**
 * Update company settings for the current workspace (upserts the workspace
 * document). Empty tax IDs are stored as null so validators pass.
 */
async updateSettings(updateData) {
  const filtered = {};
  for (const field of UPDATABLE_FIELDS) {
    if (updateData[field] !== undefined) {
      filtered[field] = updateData[field];
    }
  }
  for (const field of TAX_FIELDS) {
    if (filtered[field] === '') filtered[field] = null;
  }
  if (filtered.name && !filtered.companyName) filtered.companyName = filtered.name;
  if (filtered.companyName && !filtered.name) filtered.name = filtered.companyName;

  const ws = currentWorkspace();
  if (ws) {
    const settings = await CompanySettings.findOneAndUpdate(
      { companyId: ws },
      { $set: filtered },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    logger.info('Company settings updated for workspace');
    return settings;
  }

  // No scope: update legacy singleton natively (string _id bypasses cast).
  const result = await CompanySettings.collection.findOneAndUpdate(
    { _id: 'company_settings' },
    { $set: filtered },
    { upsert: true, returnDocument: 'after' }
  );
  logger.info('Company settings updated (legacy singleton)');
  return { ...DEFAULTS, ...(result.value || {}), ...filtered };
}

/**
 * Map storage nulls to '' so the settings form's zod schema accepts them.
 */
toClientShape(settings) {
  if (!settings) return settings;
  const data = settings.toObject ? settings.toObject() : { ...settings };
  for (const field of TAX_FIELDS) {
    if (data[field] == null) data[field] = '';
  }
  if (!data.name) data.name = data.companyName || '';
  if (data.financialYear && (data.financialYear.startMonth == null || data.financialYear.startDay == null)) {
    data.financialYear = {
      startMonth: data.financialYear.startMonth ?? 4,
      startDay: data.financialYear.startDay ?? 1,
    };
  }
  return data;
}

/**
 * Get current financial year
 */
getCurrentFinancialYear() {
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const currentYear = today.getFullYear();

  // FY starts in April (month 4)
  if (currentMonth >= 4) {
    return {
      startYear: currentYear,
      endYear: currentYear + 1,
      label: `FY${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
    };
  } else {
    return {
      startYear: currentYear - 1,
      endYear: currentYear,
      label: `FY${currentYear - 1}-${currentYear.toString().slice(-2)}`,
    };
  }
}

/**
 * Get current quarter
 */
getCurrentQuarter() {
  const today = new Date();
  const month = today.getMonth() + 1;

  if (month >= 4 && month <= 6) return 'Q1';
  if (month >= 7 && month <= 9) return 'Q2';
  if (month >= 10 && month <= 12) return 'Q3';
  return 'Q4';
}
}

export default new CompanySettingsService();
