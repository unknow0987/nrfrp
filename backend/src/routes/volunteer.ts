import { Router } from 'express';
import { query } from '../db/pool';
import { requireRole, AuthReq } from '../middleware/auth';
import { publishEvent } from '../db/redis';

export const volunteerRouter = Router();
const auth = requireRole('volunteer', 'admin') as any;

volunteerRouter.get('/dashboard', auth, async (req: AuthReq, res) => {
  try {
    const [profile, tasks, stats] = await Promise.all([
      query(`SELECT v.*, u.email, u.status, u.created_at as joined_at
             FROM volunteers v JOIN users u ON v.id=u.id WHERE v.id=$1`, [req.user!.id]),
      query(`SELECT t.*, d.name as drive_name, nc.district, nc.urgency as case_urgency
             FROM tasks t
             LEFT JOIN drives d ON t.drive_id=d.id
             LEFT JOIN needy_cases nc ON t.case_id=nc.id
             WHERE t.volunteer_id=$1 AND t.status NOT IN ('completed','verified')
             ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, t.created_at ASC`,
            [req.user!.id]),
      query(`SELECT tasks_completed, rating, rating_count, is_champion, tier
             FROM volunteers WHERE id=$1`, [req.user!.id])
    ]);
    res.json({ profile: profile.rows[0] || null, tasks: tasks.rows, stats: stats.rows[0] || {} });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

volunteerRouter.patch('/tasks/:id/accept', auth, async (req: AuthReq, res) => {
  try {
    const result = await query(
      `UPDATE tasks SET status='accepted', accepted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND volunteer_id=$2 RETURNING *`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found or not assigned to you' });
    await publishEvent('task:update', { type: 'accepted', taskId: req.params.id, volunteerId: req.user!.id });
    res.json({ task: result.rows[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

volunteerRouter.patch('/tasks/:id/complete', auth, async (req: AuthReq, res) => {
  try {
    const { volunteer_notes, proof_lat, proof_lng } = req.body;
    const result = await query(
      `UPDATE tasks SET status='proof_uploaded', completed_at=NOW(),
       volunteer_notes=$1, proof_lat=$2, proof_lng=$3, updated_at=NOW()
       WHERE id=$4 AND volunteer_id=$5 RETURNING *`,
      [volunteer_notes || null, proof_lat || null, proof_lng || null, req.params.id, req.user!.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Task not found' });
    await publishEvent('task:update', { type: 'completed', taskId: req.params.id, volunteerId: req.user!.id });
    res.json({ task: result.rows[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

volunteerRouter.get('/tasks/available', auth, async (req: AuthReq, res) => {
  try {
    const { page = 1 } = req.query;
    const offset = (Number(page) - 1) * 20;
    const result = await query(
      `SELECT t.id, t.type, t.title, t.description, t.priority,
              t.pickup_address, t.delivery_address, t.deadline, t.created_at,
              d.name as drive_name, nc.district, nc.urgency as case_urgency
       FROM tasks t
       LEFT JOIN drives d ON t.drive_id=d.id
       LEFT JOIN needy_cases nc ON t.case_id=nc.id
       WHERE t.status IN ('created','notified') AND (t.volunteer_id IS NULL OR t.volunteer_id=$1)
       ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, t.created_at ASC
       LIMIT 20 OFFSET $2`,
      [req.user!.id, offset]
    );
    res.json({ tasks: result.rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

volunteerRouter.get('/tasks/history', auth, async (req: AuthReq, res) => {
  try {
    const result = await query(
      `SELECT t.*, d.name as drive_name FROM tasks t
       LEFT JOIN drives d ON t.drive_id=d.id
       WHERE t.volunteer_id=$1 AND t.status IN ('completed','verified')
       ORDER BY t.completed_at DESC LIMIT 50`,
      [req.user!.id]
    );
    res.json({ tasks: result.rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

volunteerRouter.patch('/profile', auth, async (req: AuthReq, res) => {
  try {
    const { display_name, skills, service_radius, home_lat, home_lng, vehicle_type, vehicle_capacity, is_public } = req.body;
    await query(
      `UPDATE volunteers SET display_name=$1, skills=$2, service_radius=$3,
       home_lat=$4, home_lng=$5, vehicle_type=$6, vehicle_capacity=$7, is_public=$8
       WHERE id=$9`,
      [display_name, skills || [], service_radius || 10, home_lat || null, home_lng || null,
       vehicle_type || null, vehicle_capacity || null, is_public || false, req.user!.id]
    );
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
