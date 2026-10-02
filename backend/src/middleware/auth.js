import jwt from 'jsonwebtoken';
import logger from '../config/logger.js';
import { getResolvedUrls } from '../config/urls.js';
import { runWithScope } from '../utils/companyScope.js';

const COOKIE_NAME = 'blackhole_token';
const JWT_SECRET_ENV_CANDIDATES = [
  'JWT_SECRET',
  'BHIV_JWT_SECRET',
  'AUTH_JWT_SECRET',
  'BLACKHOLE_JWT_SECRET',
];

let _UserModel = null;

async function getUserModel() {
  if (!_UserModel) {
    try {
      const mod = await import('../models/User.js');
      _UserModel = mod.default;
    } catch {
      return null;
    }
  }
  return _UserModel;
}

function getJwtVerificationSecrets() {
  const unique = new Set();
  const secrets = [];

  for (const envName of JWT_SECRET_ENV_CANDIDATES) {
    const value = process.env[envName];
    if (!value || typeof value !== 'string') continue;
    const secret = value.trim();
    if (!secret || unique.has(secret)) continue;
    unique.add(secret);
    secrets.push(secret);
  }

  return secrets;
}

export function verifyBlackholeToken(token) {
  const secrets = getJwtVerificationSecrets();
  if (!secrets.length) {
    const err = new Error(
      `Missing JWT verification secret. Set one of: ${JWT_SECRET_ENV_CANDIDATES.join(', ')}`
    );
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }

  let lastError = null;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Token verification failed');
}

/** Where to send browsers when not authenticated (SPA login). */
export function getAppLoginUrl() {
  const explicit = (process.env.APP_LOGIN_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;
  const { SPA_URL } = getResolvedUrls();
  return `${SPA_URL}/login`;
}

/**
 * Legacy HTTP-only cookie options (cleared on logout). Prefer `Authorization: Bearer <jwt>`.
 */
export function getBlackholeCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  const { SPA_URL, API_PUBLIC_URL } = getResolvedUrls();
  let crossSite = false;
  try {
    if (SPA_URL && API_PUBLIC_URL) {
      crossSite = new URL(SPA_URL).origin !== new URL(API_PUBLIC_URL).origin;
    }
  } catch {
    /* ignore invalid URLs */
  }
  if (isProduction && crossSite) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function clearBlackholeCookie(res) {
  const o = getBlackholeCookieOptions();
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: o.sameSite, secure: o.secure });
}

function extractAccessToken(req) {
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  return req.cookies?.[COOKIE_NAME] || null;
}

/**
 * Optional: JWT `allowedApps` must include this id (e.g. artha).
 */
export function requireAllowedApp(appId) {
  const id = appId || process.env.APP_ID || process.env.BHIV_APP_ID;
  return (req, res, next) => {
    if (!id) return next();
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const apps = req.user.allowedApps || [];
    if (!apps.includes(id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this application',
        code: 'app_not_allowed',
      });
    }
    next();
  };
}

/**
 * Protect routes — `Authorization: Bearer <jwt>` (preferred) or legacy `blackhole_token` cookie.
 */
export const protect = async (req, res, next) => {
  try {
    const token = extractAccessToken(req);
    const loginUrl = getAppLoginUrl();

    if (!token) {
      if (req.accepts('json') === 'json') {
        return res.status(401).json({
          success: false,
          message: 'Not authenticated',
          redirect: loginUrl,
        });
      }
      return res.redirect(loginUrl);
    }

    try {
      const decoded = verifyBlackholeToken(token);

      const User = await getUserModel();
      if (User) {
        const user = await User.findById(decoded.user_id).select('_id email name role roles companyId isActive allowedApps');
        if (!user) {
          clearBlackholeCookie(res);
          if (req.accepts('json') === 'json') {
            return res.status(401).json({
              success: false,
              message: 'User not found',
              redirect: loginUrl,
            });
          }
          return res.redirect(loginUrl);
        }
        if (!user.isActive) {
          clearBlackholeCookie(res);
          if (req.accepts('json') === 'json') {
            return res.status(403).json({
              success: false,
              message: 'Account is disabled',
              redirect: loginUrl,
            });
          }
          return res.redirect(loginUrl);
        }

        req.user = {
          _id: user._id,
          user_id: user._id,
          email: user.email,
          name: user.name || user.email?.split('@')[0] || 'User',
          roles: user.roles || [user.role],
          role: user.role,
          companyId: user.companyId || null,
          allowedApps: user.allowedApps || [],
          isActive: user.isActive,
        };
      } else {
        req.user = {
          _id: decoded.user_id,
          user_id: decoded.user_id,
          email: decoded.email,
          name: decoded.name || decoded.email?.split('@')[0] || 'User',
          roles: decoded.roles || [],
          role: decoded.roles?.[0] || 'user',
          companyId: decoded.companyId || null,
          allowedApps: decoded.allowedApps || [],
          isActive: true,
        };
      }

      const appId = process.env.APP_ID || process.env.BHIV_APP_ID;
      if (appId && !(req.user.allowedApps || []).includes(appId)) {
        if (req.accepts('json') === 'json') {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to this application',
            code: 'app_not_allowed',
          });
        }
        return res.redirect(`${getResolvedUrls().SPA_URL}/login?error=app_not_allowed`);
      }

      // Everything downstream of `protect` runs inside the user's workspace
      // scope so the companyScope plugin can isolate all data access.
      const workspace = req.user.companyId || req.user._id;
      req.workspaceId = workspace;
      return runWithScope(
        {
          workspace,
          userId: req.user._id,
          role: req.user.role,
          crossCompany: false,
        },
        next
      );
    } catch (err) {
      logger.error('JWT verification failed:', err.message);
      clearBlackholeCookie(res);
      if (req.accepts('json') === 'json') {
        return res.status(401).json({
          success: false,
          message: 'Token is invalid or expired',
          redirect: loginUrl,
        });
      }
      return res.redirect(loginUrl);
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const userRoles = req.user.roles || [];
    // A sub-admin is the client company's admin: full in-app access within
    // their own company workspace (data isolation still applies).
    const effectiveRoles = userRoles.includes('sub_admin')
      ? [...new Set([...userRoles, 'admin', 'accountant', 'viewer'])]
      : userRoles;
    const hasRole = roles.some(
      (r) => effectiveRoles.includes(r) || req.user.role === r,
    );

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};

const auth = protect;
export default auth;
