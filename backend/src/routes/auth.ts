import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool';
import { signToken, auditLog } from '../middleware/auth';

export const authRouter = Router();

function hashPhone(phone: string) {
  return crypto.createHash('sha256').update(phone).digest('hex');
}

// Request OTP (mock - in prod uses AWS SNS)
authRouter.post('/otp/request', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const phoneHash = hashPhone(phone);
  // In dev, OTP is always 123456
  const otp = process.env.NODE_ENV === 'production'
    ? Math.floor(100000 + Math.random() * 900000).toString()
    : '123456';

  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

  await query(
    `INSERT INTO otp_store (phone_hash, otp_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
    [phoneHash, otpHash]
  );

  // In production: send via AWS SNS
  console.log(`[OTP] ${phone}: ${otp} (dev mode)`);

  res.json({ success: true, message: process.env.NODE_ENV === 'production' ? 'OTP sent' : 'Dev OTP: 123456' });
});

// Verify OTP and login/register
authRouter.post('/otp/verify', async (req, res) => {
  const { phone, otp, role, email } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  const phoneHash = hashPhone(phone);
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

  const otpResult = await query(
    `SELECT id FROM otp_store WHERE phone_hash=$1 AND otp_hash=$2 AND used=false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phoneHash, otpHash]
  );

  if (otpResult.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  // Mark OTP used
  await query('UPDATE otp_store SET used=true WHERE id=$1', [otpResult.rows[0].id]);

  // Find or create user
  let userResult = await query('SELECT id, role, status, email FROM users WHERE phone_hash=$1', [phoneHash]);

  let user = userResult.rows[0];

  if (!user) {
    if (!role) return res.status(400).json({ error: 'Role required for new user registration' });
    const newUser = await query(
      `INSERT INTO users (phone_hash, email, role, status) VALUES ($1, $2, $3, $4) RETURNING id, role, status, email`,
      [phoneHash, email || null, role, role === 'volunteer' || role === 'needy' ? 'pending' : 'pending']
    );
    user = newUser.rows[0];

    // Create role-specific record
    if (role === 'donor') {
      await query(`INSERT INTO donors (id, type, is_anonymous) VALUES ($1, 'individual', false)`, [user.id]);
    } else if (role === 'volunteer') {
      await query(`INSERT INTO volunteers (id, display_name) VALUES ($1, $2)`, [user.id, email || 'Volunteer']);
    }
  }

  if (user.status === 'blacklisted') return res.status(403).json({ error: 'Account blocked' });

  const token = signToken({ id: user.id, role: user.role, email: user.email });
  await auditLog(user.id, 'login', 'user', user.id, null, null, req.ip || '');

  res.json({ token, user: { id: user.id, role: user.role, status: user.status, email: user.email } });
});

// Admin login (phone + TOTP)
authRouter.post('/admin/login', async (req, res) => {
  const { phone, totp } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const phoneHash = hashPhone(phone);
  const userResult = await query(
    `SELECT id, role, status, email, mfa_secret, failed_login_attempts FROM users WHERE phone_hash=$1 AND role='admin'`,
    [phoneHash]
  );

  if (!userResult.rows[0]) return res.status(401).json({ error: 'Invalid credentials' });
  const user = userResult.rows[0];

  if (user.failed_login_attempts >= 5) return res.status(423).json({ error: 'Account locked after 5 failed attempts' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended' });

  // In dev skip TOTP if no secret set
  if (user.mfa_secret && totp) {
    const speakeasy = require('speakeasy');
    const valid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: totp, window: 1 });
    if (!valid) {
      await query('UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id=$1', [user.id]);
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }
  }

  await query('UPDATE users SET failed_login_attempts=0, last_login_ip=$1 WHERE id=$2', [req.ip, user.id]);
  await auditLog(user.id, 'admin_login', 'user', user.id, null, { ip: req.ip }, req.ip || '');

  const token = signToken({ id: user.id, role: user.role, email: user.email }, '4h');
  res.json({ token, user: { id: user.id, role: user.role, email: user.email } });
});
