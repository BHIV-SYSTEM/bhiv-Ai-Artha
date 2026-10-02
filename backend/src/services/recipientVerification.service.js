import User from '../models/User.js';
import CompanySettings from '../models/CompanySettings.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class RecipientVerificationService {
  /**
   * A recipient is verified only when BOTH conditions hold for the same
   * workspace: an active ARTHA user exists with the invoice's customer
   * email, and that user's workspace has the invoice's customer GSTIN
   * registered in CompanySettings (gstin or gstinRegistrations).
   */
  async verify({ customerEmail, customerGSTIN } = {}) {
    const email = String(customerEmail || '').trim().toLowerCase();
    const gstin = String(customerGSTIN || '').trim().toUpperCase();

    const result = {
      verified: false,
      emailMatched: Boolean(email),
      gstMatched: Boolean(gstin),
      matchedWorkspaces: [],
      customerEmail: email,
      customerGSTIN: gstin,
    };

    if (!email || !gstin) return result;

    const users = await User.find({ email, isActive: true })
      .select('_id companyId name email')
      .lean();
    if (!users.length) {
      result.emailMatched = false;
      return result;
    }

    const escaped = escapeRegex(gstin);
    const settingsDocs = await CompanySettings.collection
      .find({
        $or: [
          { gstin: { $regex: `^${escaped}$`, $options: 'i' } },
          { 'gstinRegistrations.gstin': { $regex: `^${escaped}$`, $options: 'i' } },
        ],
      })
      .toArray();

    const owningWorkspaces = new Set(
      settingsDocs.filter((doc) => doc.companyId).map((doc) => String(doc.companyId))
    );
    if (!owningWorkspaces.size) {
      result.gstMatched = false;
      return result;
    }

    for (const user of users) {
      const workspace = user.companyId || user._id;
      if (owningWorkspaces.has(String(workspace))) {
        result.verified = true;
        result.matchedWorkspaces.push(workspace);
      }
    }

    if (!result.verified) {
      result.gstMatched = false;
    }

    return result;
  }
}

export default new RecipientVerificationService();
