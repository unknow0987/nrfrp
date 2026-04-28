import { Router } from 'express';
import { query } from '../db/pool';
import { requireAdmin, auditLog, AuthReq } from '../middleware/auth';
import { cacheDel, publishEvent } from '../db/redis';

export const adminRouter = Router();
adminRouter.use(requireAdmin as any);

// Dashboard stats (fresh, no cache)
adminRouter.get('/dashboard', async (req, res) => {
  try {
    const [stats, pending, fraud, monthly, fundsByCategory] = await Promise.all([
      query('SELECT * FROM platform_stats'),
      query(`SELECT
        (SELECT COUNT(*) FROM users WHERE status='pending' AND role='donor') as donors,
        (SELECT COUNT(*) FROM needy_cases WHERE status='pending') as cases,
        (SELECT COUNT(*) FROM users WHERE status='pending' AND role='volunteer') as volunteers,
        (SELECT COUNT(*) FROM needy_cases WHERE array_length(fraud_flags,1) > 0) as fraud_flags`),
      query(`SELECT id, type, urgency, fraud_flags, district, created_at FROM needy_cases
             WHERE array_length(fraud_flags,1) > 0 ORDER BY created_at DESC LIMIT 10`),
      query(`SELECT DATE_TRUNC('month', created_at) as month,
                    SUM(CASE WHEN type='money' THEN amount ELSE 0 END) as money_raised,
                    COUNT(*) as count
             FROM donations WHERE created_at >= NOW() - INTERVAL '6 months' GROUP BY 1 ORDER BY 1`),
      query(`SELECT category, SUM(amount) as total FROM fund_transactions
             WHERE is_verified=true GROUP BY category ORDER BY total DESC`)
    ]);

    res.json({
      stats: stats.rows[0],
      pending: pending.rows[0],
      fraudAlerts: fraud.rows,
      monthly: monthly.rows,
      fundsByCategory: fundsByCategory.rows,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// User management
adminRouter.get('/users', async (req, res) => {
  const { role, status, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params: any[] = [];
  let where = 'WHERE 1=1';
  if (role) { params.push(role); where += ` AND u.role=$${params.length}`; }
  if (status) { params.push(status); where += ` AND u.status=$${params.length}`; }
  params.push(limit, offset);
  const result = await query(
    `SELECT u.id, u.email, u.role, u.status, u.created_at,
            COALESCE(d.org_name, v.display_name) as name
     FROM users u LEFT JOIN donors d ON u.id=d.id LEFT JOIN volunteers v ON u.id=v.id
     ${where} ORDER BY u.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );
  res.json({ users: result.rows });
});

adminRouter.patch('/users/:id/status', async (req: AuthReq, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const before = await query('SELECT status FROM users WHERE id=$1', [id]);
  await query('UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2', [status, id]);
  await auditLog(req.user!.id, `user_${status}`, 'user', id, before.rows[0], { status }, req.ip || '');
  await publishEvent('admin:alert', { type: 'user_status', userId: id, status });
  res.json({ success: true });
});

// Needy case management
adminRouter.get('/cases', async (req, res) => {
  const { status, urgency, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const params: any[] = [];
  let where = 'WHERE 1=1';
  if (status) { params.push(status); where += ` AND nc.status=$${params.length}`; }
  if (urgency) { params.push(urgency); where += ` AND nc.urgency=$${params.length}`; }
  params.push(limit, offset);
  const result = await query(
    `SELECT nc.*, u.email FROM needy_cases nc JOIN users u ON nc.user_id=u.id
     ${where} ORDER BY CASE nc.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
     nc.created_at ASC LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );
  res.json({ cases: result.rows });
});

adminRouter.patch('/cases/:id/approve', async (req: AuthReq, res) => {
  const { id } = req.params;
  const { urgency, help_types, expires_days = 90 } = req.body;
  const result = await query(
    `UPDATE needy_cases SET status='active', urgency=$1, help_types=$2,
     approved_by=$3, approved_at=NOW(), expires_at=NOW()+($4 || ' days')::interval, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [urgency, help_types, req.user!.id, expires_days, id]
  );
  await auditLog(req.user!.id, 'case_approved', 'needy_case', id, null, result.rows[0], req.ip || '');
  await cacheDel('public:stats');
  await publishEvent('case:update', { type: 'approved', caseId: id });
  await publishEvent('stats:update', { refresh: true });
  res.json({ case: result.rows[0] });
});

adminRouter.patch('/cases/:id/reject', async (req: AuthReq, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  await query(`UPDATE needy_cases SET status='closed', updated_at=NOW() WHERE id=$1`, [id]);
  await auditLog(req.user!.id, 'case_rejected', 'needy_case', id, null, { reason }, req.ip || '');
  await publishEvent('case:update', { type: 'rejected', caseId: id });
  res.json({ success: true });
});

// Drives
adminRouter.get('/drives', async (req, res) => {
  const result = await query(`SELECT d.*, u.email as created_by_email FROM drives d LEFT JOIN users u ON d.created_by=u.id ORDER BY d.created_at DESC`);
  res.json({ drives: result.rows });
});

adminRouter.post('/drives', async (req: AuthReq, res) => {
  const { name, type, description, area, radius_km, fund_target, start_date, end_date, volunteer_slots } = req.body;
  const result = await query(
    `INSERT INTO drives (name,type,description,area,radius_km,fund_target,start_date,end_date,volunteer_slots,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name, type, description, area, radius_km, fund_target, start_date, end_date, volunteer_slots, req.user!.id]
  );
  await auditLog(req.user!.id, 'drive_created', 'drive', result.rows[0].id, null, result.rows[0], req.ip || '');
  await cacheDel('public:stats');
  await publishEvent('drive:update', { type: 'created', drive: result.rows[0] });
  res.json({ drive: result.rows[0] });
});

adminRouter.patch('/drives/:id/close', async (req: AuthReq, res) => {
  const { beneficiaries_count } = req.body;
  const result = await query(
    `UPDATE drives SET status='completed', beneficiaries_count=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
    [beneficiaries_count, req.params.id]
  );
  await cacheDel('public:stats');
  await publishEvent('drive:update', { type: 'completed', drive: result.rows[0] });
  res.json({ drive: result.rows[0] });
});

// Notices
adminRouter.get('/notices', async (req, res) => {
  const result = await query(`SELECT * FROM notices ORDER BY created_at DESC`);
  res.json({ notices: result.rows });
});

adminRouter.post('/notices', async (req: AuthReq, res) => {
  const { title, description, urgency_level, drive_id, fund_target, area } = req.body;
  const result = await query(
    `INSERT INTO notices (title,description,urgency_level,drive_id,fund_target,area,is_published,published_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),$7) RETURNING *`,
    [title, description, urgency_level, drive_id || null, fund_target || 0, area, req.user!.id]
  );
  await publishEvent('notice:new', result.rows[0]);
  res.json({ notice: result.rows[0] });
});

adminRouter.patch('/notices/:id', async (req: AuthReq, res) => {
  const { title, description, urgency_level, is_published } = req.body;
  const result = await query(
    `UPDATE notices SET title=COALESCE($1,title), description=COALESCE($2,description),
     urgency_level=COALESCE($3,urgency_level), is_published=COALESCE($4,is_published), updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [title, description, urgency_level, is_published, req.params.id]
  );
  await publishEvent('notice:update', result.rows[0]);
  res.json({ notice: result.rows[0] });
});

// Fund transactions
adminRouter.get('/funds', async (req, res) => {
  const result = await query(`
    SELECT ft.*, d.name as drive_name, u.email as verified_by_email
    FROM fund_transactions ft
    LEFT JOIN drives d ON ft.drive_id=d.id
    LEFT JOIN users u ON ft.verified_by=u.id
    ORDER BY ft.created_at DESC LIMIT 100
  `);
  res.json({ transactions: result.rows });
});

adminRouter.post('/funds', async (req: AuthReq, res) => {
  const { drive_id, case_id, amount, description, category, vendor_name } = req.body;
  const result = await query(
    `INSERT INTO fund_transactions (drive_id,case_id,amount,description,category,vendor_name,is_verified,verified_by,verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7,NOW()) RETURNING *`,
    [drive_id || null, case_id || null, amount, description, category, vendor_name, req.user!.id]
  );
  // Update drive collected amount
  if (drive_id) {
    await query(`UPDATE drives SET fund_collected=fund_collected+$1, updated_at=NOW() WHERE id=$2`, [amount, drive_id]);
  }
  await cacheDel('public:stats');
  await publishEvent('fund:new', result.rows[0]);
  await publishEvent('stats:update', { refresh: true });
  res.json({ transaction: result.rows[0] });
});

// Audit log
adminRouter.get('/audit', async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const result = await query(
    `SELECT al.*, u.email as user_email FROM audit_log al LEFT JOIN users u ON al.user_id=u.id
     ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ logs: result.rows });
});

// Get single case with full proof details (admin only)
adminRouter.get('/cases/:id', async (req: AuthReq, res) => {
  try {
    const result = await query(`
      SELECT nc.*, u.email, u.created_at as user_joined,
             v.display_name as volunteer_name
      FROM needy_cases nc 
      JOIN users u ON nc.user_id=u.id
      LEFT JOIN volunteers v ON nc.assigned_volunteer=v.id
      WHERE nc.id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Case not found' });
    
    // Generate presigned URLs for proof documents (15 min TTL)
    const c = result.rows[0];
    const proofUrls: any = {};
    
    if (c.id_doc_s3_key) {
      proofUrls.id_doc = `/api/admin/proof-url?key=${encodeURIComponent(c.id_doc_s3_key)}`;
    }
    if (c.evidence_s3_keys && c.evidence_s3_keys.length > 0) {
      proofUrls.evidence = c.evidence_s3_keys.map((k: string) =>
        `/api/admin/proof-url?key=${encodeURIComponent(k)}`
      );
    }
    if (c.volunteer_report_s3) {
      proofUrls.volunteer_report = `/api/admin/proof-url?key=${encodeURIComponent(c.volunteer_report_s3)}`;
    }

    await auditLog(req.user!.id, 'case_proof_viewed', 'needy_case', req.params.id, null, { viewed_by: req.user!.id }, req.ip || '');
    res.json({ case: c, proofUrls });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Generate S3 presigned URL for proof docs (admin only, 15min TTL)
adminRouter.get('/proof-url', async (req: AuthReq, res) => {
  const { key } = req.query as { key: string };
  if (!key) return res.status(400).json({ error: 'Key required' });
  
  try {
    const AWS_KEY = process.env.AWS_ACCESS_KEY_ID;
    const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY;
    const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
    const S3_BUCKET = process.env.S3_BUCKET || 'nrfrp-docs';

    if (!AWS_KEY || !AWS_SECRET || AWS_KEY === 'YOUR_AWS_KEY') {
      // Dev mode: return placeholder
      return res.json({ url: null, dev_mode: true, message: 'AWS S3 not configured — file would be here in production' });
    }

    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET } });
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 900 });
    
    await auditLog(req.user!.id, 'proof_url_generated', 'document', null, null, { key }, req.ip || '');
    res.json({ url, expires_in: 900 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Upload proof for needy case (store S3 key)
adminRouter.patch('/cases/:id/proof-keys', async (req: AuthReq, res) => {
  const { id_doc_s3_key, evidence_s3_keys, volunteer_report_s3 } = req.body;
  await query(
    `UPDATE needy_cases SET 
       id_doc_s3_key=COALESCE($1,id_doc_s3_key),
       evidence_s3_keys=COALESCE($2,evidence_s3_keys),
       volunteer_report_s3=COALESCE($3,volunteer_report_s3),
       updated_at=NOW()
     WHERE id=$4`,
    [id_doc_s3_key||null, evidence_s3_keys||null, volunteer_report_s3||null, req.params.id]
  );
  res.json({ success: true });
});

// Get all volunteers for task assignment
adminRouter.get('/volunteers', async (req, res) => {
  const result = await query(`
    SELECT v.*, u.email, u.status,
           (SELECT COUNT(*) FROM tasks t WHERE t.volunteer_id=v.id AND t.status='created') as pending_tasks
    FROM volunteers v JOIN users u ON v.id=u.id
    WHERE u.status='active'
    ORDER BY v.rating DESC, v.tasks_completed DESC
  `);
  res.json({ volunteers: result.rows });
});

// Create task and assign to volunteer
adminRouter.post('/tasks', async (req: AuthReq, res) => {
  const { case_id, volunteer_id, type, title, description, pickup_address, delivery_address, priority, deadline } = req.body;
  const result = await query(
    `INSERT INTO tasks (case_id,volunteer_id,type,title,description,pickup_address,delivery_address,priority,deadline,status,assigned_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'notified',NOW()) RETURNING *`,
    [case_id||null, volunteer_id||null, type, title, description||null, pickup_address||null, delivery_address||null, priority||'normal', deadline||null]
  );
  if (volunteer_id) {
    await publishEvent('task:update', { type: 'new_assignment', taskId: result.rows[0].id, volunteerId: volunteer_id });
  }
  await auditLog(req.user!.id, 'task_created', 'task', result.rows[0].id, null, result.rows[0], req.ip || '');
  res.json({ task: result.rows[0] });
});

// Get all tasks
adminRouter.get('/tasks', async (req, res) => {
  const { status } = req.query;
  let where = status ? `WHERE t.status=$1` : '';
  const params = status ? [status] : [];
  const result = await query(`
    SELECT t.*, v.display_name as volunteer_name, nc.district, nc.urgency as case_urgency
    FROM tasks t
    LEFT JOIN volunteers v ON t.volunteer_id=v.id
    LEFT JOIN needy_cases nc ON t.case_id=nc.id
    ${where} ORDER BY t.created_at DESC LIMIT 100
  `, params);
  res.json({ tasks: result.rows });
});

// Rate a completed task
adminRouter.patch('/tasks/:id/rate', async (req: AuthReq, res) => {
  const { rating, notes } = req.body;
  const result = await query(
    `UPDATE tasks SET admin_rating=$1, admin_notes=$2, status='completed', completed_at=NOW() WHERE id=$3 RETURNING *`,
    [rating, notes||null, req.params.id]
  );
  if (result.rows[0]?.volunteer_id) {
    await query(
      `UPDATE volunteers SET 
         rating = (rating * rating_count + $1) / (rating_count + 1),
         rating_count = rating_count + 1,
         tasks_completed = tasks_completed + 1
       WHERE id=$2`,
      [rating, result.rows[0].volunteer_id]
    );
  }
  res.json({ task: result.rows[0] });
});
