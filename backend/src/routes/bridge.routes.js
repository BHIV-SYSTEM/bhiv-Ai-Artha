import express from 'express';
import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import { verifyBlackholeToken } from '../middleware/auth.js';
import User from '../models/User.js';
import Company from '../models/Company.js';

/**
 * POST /api/v1/bridge/provision — SETU single sign-on identity provisioning.
 *
 * Server-to-server only. Authenticated with a bridge ADMIN token: a JWT signed
 * with the shared ARTHA JWT secret that carries `scope: 'setu_client_admin'`.
 * Browser sessions can never reach this route.
 *
 * Given { email, name, role, companyId } it find-or-creates the ARTHA user so
 * each SETU person gets THEIR OWN ARTHA identity inside the tenant's company
 * (no more shared service account — which also enforces per-account data
 * privacy, because ARTHA's companyScope isolates every workspace).
 *
 * Role rules mirror ARTHA's own:
 *   - sub_admin  → the company Admin (can manage that company's accountants/viewers)
 *   - accountant → employee
 *   - viewer     → read-only employee
 * The Super Admin role can never be provisioned or mutated here.
 */

const router = express.Router();
const ALLOWED_ROLES = ['sub_admin', 'accountant', 'viewer'];

const genPassword = () =>
  // ≥8 chars, upper + lower + digit + symbol (satisfies ARTHA password rules).
  // The user never sees it — they arrive via the SSO cookie.
  `Setu!${randomBytes(9).toString('base64url')}`;

router.post('/provision', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    let decoded;
    try {
      decoded = verifyBlackholeToken(token);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid bridge token' });
    }
    if (decoded?.scope !== 'setu_client_admin') {
      return res.status(403).json({ success: false, message: 'Bridge provisioning scope required' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim() || email.split('@')[0];
    const role = String(req.body?.role || '').trim();
    const companyId = String(req.body?.companyId || '').trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
      });
    }
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, message: 'Valid companyId is required' });
    }
    const company = await Company.findById(companyId).select('_id').lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    let user = await User.findOne({ email });

    if (user) {
      // Never mutate the Super Admin; keep other existing users in step with
      // the caller's role mapping (SETU admin ↔ company Admin, etc.).
      if (user.role !== 'admin') {
        let dirty = false;
        if (user.role !== role) { user.role = role; dirty = true; }
        if (String(user.companyId || '') !== companyId) { user.companyId = companyId; dirty = true; }
        if (!user.isActive) { user.isActive = true; dirty = true; }
        if (dirty) await user.save();
      }
    } else {
      try {
        user = await User.create({
          email,
          name,
          role,
          companyId,
          password: genPassword(),
          isActive: true,
          activatedAt: new Date(),
        });
      } catch (err) {
        if (err?.code === 11000) {
          user = await User.findOne({ email }); // lost a creation race — reuse
        } else {
          throw err;
        }
      }
    }

    if (!user) {
      return res.status(500).json({ success: false, message: 'Provisioning failed' });
    }

    return res.json({
      success: true,
      data: {
        user_id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId ? String(user.companyId) : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Provisioning failed' });
  }
});

export default router;
