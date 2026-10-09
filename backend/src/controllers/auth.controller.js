import User from '../models/User.js';
import logger from '../config/logger.js';
import { signAccessToken } from '../utils/authToken.js';
import { getBlackholeCookieOptions, clearBlackholeCookie } from '../middleware/auth.js';
import activationCodeService from '../services/activationCode.service.js';
import auditService from '../services/audit.service.js';

const COOKIE_NAME = 'blackhole_token';

function getCookieOptions() {
  return getBlackholeCookieOptions();
}

export const login = async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email, isActive: true }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signAccessToken(user);

    res.cookie(COOKIE_NAME, token, getCookieOptions());

    // Fire-and-forget: auth must never fail or slow down on audit.
    auditService.recordLogin({
      userId: user._id,
      actor: {
        userId: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
      entityType: 'User',
      entityId: String(user._id),
      details: { email: user.email },
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          roles: [user.role],
        },
      },
    });
  } catch (err) {
    logger.error('login:', err.message);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

export const signup = async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    const phone = (req.body?.phone || '').trim();
    const role = (req.body?.role || 'viewer').toLowerCase();
    const activationCode = (req.body?.activationCode || '').trim();

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ success: false, message: 'Password must contain uppercase, lowercase, and a number' });
    }

    const validRoles = ['viewer', 'accountant', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    let finalRole = 'viewer';
    let activationRecord = null;

    if (role === 'admin' || role === 'accountant') {
      if (!activationCode) {
        return res.status(400).json({
          success: false,
          message: `Activation code is required for ${role} accounts`,
        });
      }
      const verification = activationCodeService.verify(activationCode, role);
      if (!verification.valid) {
        return res.status(400).json({
          success: false,
          message: verification.message,
        });
      }
      finalRole = role;
      activationRecord = verification;
    }

    const existing = await User.findOne({ email }).select('_id');
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || undefined,
      role: finalRole,
      isActive: true,
      activationCode: activationRecord ? activationRecord.codeHash : undefined,
      activatedAt: activationRecord ? new Date() : undefined,
    });

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signAccessToken(user);

    res.cookie(COOKIE_NAME, token, getCookieOptions());

    return res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          roles: [user.role],
        },
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }
    logger.error('signup:', err.message);
    return res.status(500).json({ success: false, message: 'Signup failed' });
  }
};

export const logout = async (req, res) => {
  clearBlackholeCookie(res);
  if (req.user?._id) {
    auditService.recordLogout({
      userId: req.user._id,
      actor: {
        userId: req.user._id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
      entityType: 'User',
      entityId: String(req.user._id),
      details: { email: req.user.email },
    }).catch(() => {});
  }
  return res.json({ success: true, message: 'Logged out' });
};
