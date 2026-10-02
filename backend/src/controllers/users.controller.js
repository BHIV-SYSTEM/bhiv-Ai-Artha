import mongoose from 'mongoose';
import User from '../models/User.js';
import Company from '../models/Company.js';
import logger from '../config/logger.js';
import notificationEvent from '../services/notificationEvent.service.js';

const ALLOWED_ROLES = ['admin', 'sub_admin', 'accountant', 'viewer'];
/** Roles a sub-admin (client company admin) is allowed to manage. */
const SUB_ADMIN_MANAGEABLE_ROLES = ['accountant', 'viewer'];

function serializeUser(doc) {
  if (!doc) return null;
  const u = doc.toObject ? doc.toObject() : doc;
  const company = u.companyId && typeof u.companyId === 'object' && u.companyId.name
    ? u.companyId
    : null;
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department || '',
    status: u.isActive ? 'active' : 'inactive',
    lastLogin: u.lastLogin,
    companyId: company ? company._id : (u.companyId || null),
    companyName: company ? company.name : '',
  };
}

/** Can `actor` administer `target`? (role + company rules) */
function canAdminister(actor, target) {
  if (actor.role === 'admin') return true;
  if (actor.role === 'sub_admin') {
    if (!actor.companyId) return false;
    const sameCompany = target.companyId &&
      String(target.companyId) === String(actor.companyId);
    return sameCompany && SUB_ADMIN_MANAGEABLE_ROLES.includes(target.role);
  }
  return false;
}

/**
 * @desc    Current user profile
 * @route   GET /api/v1/users/me
 */
export const getMe = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        id: req.user._id,
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        roles: req.user.roles,
        companyId: req.user.companyId || null,
        allowedApps: req.user.allowedApps,
      },
    });
  } catch (error) {
    logger.error('Get me error:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
};

/**
 * @desc    Update current user profile (local fields only)
 * @route   PUT /api/v1/users/me
 */
export const updateMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const { name, phone } = req.body;
    if (name !== undefined && String(name).trim()) user.name = String(name).trim();
    if (phone !== undefined) user.phone = String(phone).trim();
    await user.save();
    res.json({ success: true, data: serializeUser(user) });
  } catch (error) {
    logger.error('Update me error:', error);
    res.status(500).json({ success: false, message: 'Could not update profile' });
  }
};

/**
 * @desc    List users
 * @route   GET /api/v1/users
 */
export const getUsers = async (req, res) => {
  try {
    const query = {};
    if (req.user.role === 'sub_admin') {
      // Sub-admins see only the accounts inside their own company.
      query.companyId = req.user.companyId || null;
      if (!req.user.companyId) query._id = req.user._id;
    }
    const users = await User.find(query)
      .populate('companyId', 'name')
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      success: true,
      count: users.length,
      data: users.map((u) => serializeUser(u)),
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
};

/**
 * @desc    Get user by id
 * @route   GET /api/v1/users/:id
 */
export const getUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    const user = await User.findById(req.params.id).populate('companyId', 'name');
    if (!user || !canAdminister(req.user, user)) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: serializeUser(user) });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ success: false, message: 'Error fetching user' });
  }
};

/**
 * @desc    Create user (admin)
 * @route   POST /api/v1/users
 */
export const createUser = async (req, res) => {
  try {
    const { name, email, role, password, department, status, companyId } = req.body;
    if (!name || !email || !role || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, role, and password are required',
      });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    // Exactly one owner admin may exist. Admins create sub-admins instead.
    if (role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only the Super Admin exists. Create an Admin instead.',
      });
    }

    // Role rules: super admin creates sub_admin/employees; sub-admins only employees.
    if (req.user.role !== 'admin' && !SUB_ADMIN_MANAGEABLE_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'You can only create accountant or viewer accounts',
      });
    }

    let assignedCompanyId = null;
    if (req.user.role === 'sub_admin') {
      // Sub-admin employees always join the sub-admin's own company.
      assignedCompanyId = req.user.companyId || null;
    } else if (companyId) {
      if (!mongoose.Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: 'Invalid company id' });
      }
      const company = await Company.findById(companyId);
      if (!company) {
        return res.status(400).json({ success: false, message: 'Company not found' });
      }
      assignedCompanyId = company._id;
    }

    if (role === 'sub_admin' && !assignedCompanyId) {
      return res.status(400).json({
        success: false,
        message: 'An Admin must be assigned to a company',
      });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role,
      companyId: assignedCompanyId,
      password,
      department: department ? String(department).trim() : '',
      isActive: status !== 'inactive',
    });

    notificationEvent.userCreated(user, req.user).catch(() => {});

    res.status(201).json({ success: true, data: serializeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    logger.error('Create user error:', error);
    const message = process.env.NODE_ENV === 'production' ? 'Could not create user' : (error.message || 'Could not create user');
    res.status(500).json({ success: false, message });
  }
};

/**
 * @desc    Update user (admin)
 * @route   PUT /api/v1/users/:id
 */
export const updateUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    const user = await User.findById(req.params.id);
    if (!user || !canAdminister(req.user, user)) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { name, email, role, password, department, status, companyId } = req.body;
    if (name !== undefined) user.name = String(name).trim();
    if (email !== undefined) user.email = String(email).trim().toLowerCase();
    if (role !== undefined) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }
      // Never allow promoting anyone to the owner-admin role.
      if (role === 'admin' && user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'The Super Admin role cannot be assigned. Only one Super Admin exists.',
        });
      }
      if (req.user.role !== 'admin' && !SUB_ADMIN_MANAGEABLE_ROLES.includes(role)) {
        return res.status(403).json({
          success: false,
          message: 'You can only assign accountant or viewer roles',
        });
      }
      user.role = role;
    }
    if (department !== undefined) user.department = String(department).trim();
    if (status !== undefined) user.isActive = status !== 'inactive';
    // Company assignment is a super-admin action.
    if (companyId !== undefined && req.user.role === 'admin') {
      if (companyId === null || companyId === '') {
        user.companyId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
          return res.status(400).json({ success: false, message: 'Invalid company id' });
        }
        const company = await Company.findById(companyId);
        if (!company) {
          return res.status(400).json({ success: false, message: 'Company not found' });
        }
        user.companyId = company._id;
      }
    }
    if (password && String(password).length > 0) {
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ success: false, message: 'Password must contain uppercase, lowercase, and a number' });
      }
      user.password = password;
    }

    await user.save();
    res.json({ success: true, data: serializeUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    logger.error('Update user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Could not update user' });
  }
};

/**
 * @desc    Delete user (admin)
 * @route   DELETE /api/v1/users/:id
 */
export const deleteUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }
    const user = await User.findById(req.params.id);
    if (!user || !canAdminister(req.user, user)) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User removed' });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Could not delete user' });
  }
};
