import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

/** Verify an HS256 JWT with the shared secret (no external dependency). */
function verifyHs256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (!safeEqual(expected, s)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Auth for a pluggable gateway:
 *   - `X-API-Key: <NOTIFICATION_API_KEY>`  → server-to-server (host product backend)
 *   - `Authorization: Bearer <JWT>`        → optional, when NOTIFICATION_JWT_SECRET is set;
 *     claims: sub = user_id, tenant_id = tenant_id
 *
 * `GET /push/vapid-key` and `GET /health` stay public (browser bootstrap).
 */
export function requireAuth(req, res, next) {
  const apiKey = req.get('x-api-key');
  if (config.apiKey && apiKey && safeEqual(apiKey, config.apiKey)) {
    req.auth = { type: 'api-key' };
    return next();
  }

  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer && config.jwtSecret) {
    const claims = verifyHs256(bearer, config.jwtSecret);
    if (claims) {
      req.auth = {
        type: 'jwt',
        user_id: claims.sub || claims.user_id,
        tenant_id: claims.tenant_id,
      };
      return next();
    }
  }

  res.status(401).json({
    success: false,
    error: 'unauthorized',
    message: 'Provide X-API-Key (server-to-server) or a valid Authorization: Bearer JWT.',
  });
}

export default requireAuth;
