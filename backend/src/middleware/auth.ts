import { Request, Response, NextFunction } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import { query } from '../db/pool';

export interface AuthReq extends Request {
  user?: { id: string; role: string; email?: string };
}

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'devsecret_change_in_production';

export function signToken(payload: string | object | Buffer, expiresIn: string | number = '8h') {
  return jwt.sign(payload, JWT_SECRET, { 
     expiresIn: (process.env.JWT_EXPIRES || expiresIn) as any 
  });
}

export const requireAuth = (req: AuthReq, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.id, role: decoded.role, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: string[]) => (req: AuthReq, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Role required: ${roles.join(' or ')}` });
    }
    next();
  });
};

export const requireAdmin = requireRole('admin');

export async function auditLog(userId: string | null, action: string, resourceType: string, resourceId: string | null, before: any, after: any, ip: string) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, before_state, after_state, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, resourceType, resourceId,
       before ? JSON.stringify(before) : null,
       after ? JSON.stringify(after) : null,
       ip]
    );
  } catch (e) {
    console.error('[Audit] Failed:', e);
  }
}
