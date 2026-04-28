import { Router } from 'express';
import { query } from '../db/pool';
import { requireRole, requireAuth, AuthReq } from '../middleware/auth';
import { publishEvent } from '../db/redis';

export const needyRouter = Router();

// Register new case
needyRouter.post('/register', requireAuth as any, async (req: AuthReq, res) => {
  try {
    const { type, urgency, help_types, family_size, description, lat, lng, district, state,
            org_name, reg_number } = req.body;

    const existing = await query(
      `SELECT id FROM needy_cases WHERE user_id=$1 AND status NOT IN ('closed','expired') LIMIT 1`,
      [req.user!.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already have an active case. Close it before registering a new one.' });
    }

    const result = await query(
      `INSERT INTO needy_cases (user_id, type, urgency, help_types, family_size, description, lat, lng, district, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.id, type, urgency || 'normal', help_types || [], family_size || 1,
       description, lat || null, lng || null, district || null, state || null]
    );

    // Update user status to needy role
    await query(`UPDATE users SET role='needy', updated_at=NOW() WHERE id=$1 AND role NOT IN ('admin')`, [req.user!.id]);

    await publishEvent('case:update', { type: 'new', urgency, caseId: result.rows[0].id });
    await publishEvent('admin:alert', { type: 'new_case', urgency, caseId: result.rows[0].id });
    res.json({ case: result.rows[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Get my case (logged-in user)
needyRouter.get('/my-case', requireAuth as any, async (req: AuthReq, res) => {
  const result = await query(
    `SELECT nc.* FROM needy_cases nc
     WHERE nc.user_id=$1 AND nc.status NOT IN ('expired')
     ORDER BY nc.created_at DESC LIMIT 1`,
    [req.user!.id]
  );
  res.json({ case: result.rows[0] || null });
});

// Upload proof document keys (from frontend after S3 upload)
needyRouter.patch('/my-case/proof', requireAuth as any, async (req: AuthReq, res) => {
  const { case_id, id_doc_s3_key, evidence_s3_keys } = req.body;
  // Verify this case belongs to this user
  const check = await query(`SELECT id FROM needy_cases WHERE id=$1 AND user_id=$2`, [case_id, req.user!.id]);
  if (!check.rows[0]) return res.status(403).json({ error: 'Not your case' });
  
  await query(
    `UPDATE needy_cases SET 
       id_doc_s3_key=COALESCE($1,id_doc_s3_key),
       evidence_s3_keys=COALESCE($2::text[],evidence_s3_keys),
       status='step2', updated_at=NOW()
     WHERE id=$3`,
    [id_doc_s3_key||null, evidence_s3_keys?.length ? evidence_s3_keys : null, case_id]
  );
  await publishEvent('admin:alert', { type: 'proof_uploaded', caseId: case_id });
  res.json({ success: true });
});

// Active cases (volunteer/admin can see list but NOT proofs)
needyRouter.get('/active', requireRole('volunteer', 'admin') as any, async (req: AuthReq, res) => {
  const { district, urgency, page = 1 } = req.query;
  const offset = (Number(page) - 1) * 20;
  const params: any[] = ['active'];
  let where = `WHERE nc.status=$1`;
  if (urgency) { params.push(urgency); where += ` AND nc.urgency=$${params.length}`; }
  if (district) { params.push(`%${district}%`); where += ` AND nc.district ILIKE $${params.length}`; }
  params.push(20, offset);
  const result = await query(
    `SELECT nc.id, nc.type, nc.urgency, nc.help_types, nc.family_size,
            nc.district, nc.state, nc.description, nc.created_at, nc.expires_at
     FROM needy_cases nc ${where}
     ORDER BY CASE nc.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END
     LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );
  res.json({ cases: result.rows });
});
