import { Router } from 'express';
import { query } from '../db/pool';
import { requireRole, AuthReq } from '../middleware/auth';
import { cacheDel, publishEvent } from '../db/redis';

export const donorRouter = Router();
const requireDonor = requireRole('donor', 'admin') as any;

// Get donor dashboard
donorRouter.get('/dashboard', requireDonor, async (req: AuthReq, res) => {
  try {
    const [profile, stats, history, drives] = await Promise.all([
      query(`SELECT u.email, d.display_name, d.type, d.org_name, d.is_anonymous, d.total_donated, u.status, u.created_at
             FROM donors d JOIN users u ON d.id=u.id WHERE d.id=$1`, [req.user!.id]),
      query(`SELECT
               COUNT(*) as total_donations,
               COALESCE(SUM(CASE WHEN type='money' THEN amount ELSE 0 END),0) as total_money,
               COUNT(CASE WHEN status='used' THEN 1 END) as used_count,
               COUNT(CASE WHEN is_recurring THEN 1 END) as recurring_count
             FROM donations WHERE donor_id=$1`, [req.user!.id]),
      query(`SELECT d.*, dr.name as drive_name FROM donations d LEFT JOIN drives dr ON d.drive_id=dr.id
             WHERE d.donor_id=$1 ORDER BY d.created_at DESC LIMIT 20`, [req.user!.id]),
      query(`SELECT id, name, type, area, fund_target, fund_collected, status, end_date, beneficiaries_count
             FROM drives WHERE status='active' ORDER BY created_at DESC LIMIT 6`)
    ]);
    res.json({
      profile: profile.rows[0],
      stats: stats.rows[0],
      history: history.rows,
      drives: drives.rows
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Create donation
donorRouter.post('/', requireDonor, async (req: AuthReq, res) => {
  try {
    const { type, amount, quantity, unit, description, case_id, drive_id, is_anonymous, is_recurring, recurring_day } = req.body;

    const result = await query(
      `INSERT INTO donations (donor_id, type, amount, quantity, unit, description, case_id, drive_id,
       is_anonymous, is_recurring, recurring_day, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING *`,
      [req.user!.id, type, amount || null, quantity || null, unit || null, description || null,
       case_id || null, drive_id || null, is_anonymous || false, is_recurring || false, recurring_day || null]
    );

    // Update donor total
    if (type === 'money' && amount) {
      await query(`UPDATE donors SET total_donated=total_donated+$1 WHERE id=$2`, [amount, req.user!.id]);
    }

    // Update drive fund_collected
    if (drive_id && type === 'money' && amount) {
      await query(`UPDATE drives SET fund_collected=fund_collected+$1, updated_at=NOW() WHERE id=$2`, [amount, drive_id]);
    }

    await cacheDel('public:stats');
    await publishEvent('donation:new', {
      id: result.rows[0].id,
      type,
      amount,
      driveId: drive_id,
      donorId: req.user!.id
    });
    await publishEvent('stats:update', { refresh: true });

    res.json({ donation: result.rows[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Update profile
donorRouter.patch('/profile', requireDonor, async (req: AuthReq, res) => {
  const { display_name, is_anonymous } = req.body;
  await query(`UPDATE donors SET display_name=$1, is_anonymous=$2 WHERE id=$3`, [display_name, is_anonymous, req.user!.id]);
  res.json({ success: true });
});
