import { Router } from 'express';
import { query } from '../db/pool';
import { cacheGet, cacheSet } from '../db/redis';
import { publishEvent } from '../db/redis';

export const publicRouter = Router();

// Live platform stats (cached 30s)
publicRouter.get('/stats', async (req, res) => {
  try {
    const cached = await cacheGet('public:stats');
    if (cached) return res.json(JSON.parse(cached));

    const result = await query('SELECT * FROM platform_stats');
    const monthly = await query(`
      SELECT DATE_TRUNC('month', created_at) as month,
             SUM(CASE WHEN type='money' THEN amount ELSE 0 END) as money_raised,
             COUNT(*) as donation_count
      FROM donations WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1
    `);

    const data = { stats: result.rows[0], monthly: monthly.rows };
    await cacheSet('public:stats', JSON.stringify(data), 30);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Notices (public board)
publicRouter.get('/notices', async (req, res) => {
  try {
    const { filter = 'all', limit = 20, offset = 0 } = req.query;

    let where = 'WHERE n.is_published = true';
    if (filter !== 'all') where += ` AND n.urgency_level = '${filter}'`;

    const result = await query(`
      SELECT n.*, d.fund_collected, d.fund_target as drive_target,
             d.volunteers_assigned, d.beneficiaries_count
      FROM notices n
      LEFT JOIN drives d ON n.drive_id = d.id
      ${where}
      ORDER BY CASE n.urgency_level WHEN 'urgent' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
               n.published_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ notices: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Fund transparency ledger
publicRouter.get('/ledger', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const result = await query(`
      SELECT ft.*, d.name as drive_name,
             CASE WHEN nc.type LIKE 'individual%' THEN 'Individual case'
                  WHEN nc.type = 'organisation' THEN 'Organisation case'
                  ELSE NULL END as case_type
      FROM fund_transactions ft
      LEFT JOIN drives d ON ft.drive_id = d.id
      LEFT JOIN needy_cases nc ON ft.case_id = nc.id
      WHERE ft.is_verified = true
      ORDER BY ft.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const total = await query(`SELECT COUNT(*) FROM fund_transactions WHERE is_verified=true`);

    res.json({ transactions: result.rows, total: parseInt(total.rows[0].count) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Drives list
publicRouter.get('/drives', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, type, description, area, fund_target, fund_collected,
             volunteers_assigned, beneficiaries_count, status, start_date, end_date
      FROM drives
      WHERE status IN ('active','completed')
      ORDER BY CASE status WHEN 'active' THEN 1 ELSE 2 END, created_at DESC
    `);
    res.json({ drives: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Donation log (masked)
publicRouter.get('/donations', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await query(`
      SELECT
        d.type, d.amount, d.quantity, d.unit, d.status,
        CASE WHEN d.is_anonymous OR don.is_anonymous THEN 'Anonymous donor'
             WHEN don.org_name IS NOT NULL THEN 'Org: ' || don.org_name
             ELSE 'Anonymous donor' END as donor_name,
        dr.name as drive_name, d.created_at,
        CASE WHEN nc.type LIKE 'individual%' THEN 'Individual case'
             WHEN nc.type = 'organisation' THEN nc.type
             ELSE NULL END as case_ref
      FROM donations d
      LEFT JOIN donors don ON d.donor_id = don.id
      LEFT JOIN drives dr ON d.drive_id = dr.id
      LEFT JOIN needy_cases nc ON d.case_id = nc.id
      WHERE d.status IN ('used','delivered','collected','in_transit')
      ORDER BY d.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ donations: result.rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
