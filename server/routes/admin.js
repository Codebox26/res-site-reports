const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const supabase = require('../db');

// ── Middleware: verify admin token from header ────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Admin authentication required' });

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (!payload.admin || !payload.exp) return res.status(401).json({ error: 'Invalid token' });
    if (Date.now() > payload.exp) return res.status(401).json({ error: 'Admin session expired' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { adminPin } = req.body;
  if (!adminPin) return res.status(400).json({ error: 'adminPin is required' });

  const correctPin = process.env.ADMIN_PIN;
  if (!correctPin) return res.status(500).json({ error: 'Admin PIN not configured on server' });

  // Direct string compare (ADMIN_PIN is a plain env var, not bcrypt-hashed)
  if (String(adminPin) !== String(correctPin)) {
    return res.status(401).json({ error: 'Invalid admin PIN' });
  }

  const token = Buffer.from(JSON.stringify({
    admin: true,
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8-hour admin session
  })).toString('base64');

  res.json({ success: true, token });
});

// ── POST /api/admin/projects — create a new project ──────────────────────────
router.post('/projects', requireAdmin, async (req, res) => {
  const { id, name, pin } = req.body;

  if (!id || !name || !pin) {
    return res.status(400).json({ error: 'id, name and pin are required' });
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: 'Project ID must be lowercase letters, numbers and hyphens only' });
  }

  try {
    const pinHash = await bcrypt.hash(String(pin), 12);

    const { data, error } = await supabase
      .from('projects')
      .insert({ id, name, pin_hash: pinHash })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Project ID already exists' });
      throw error;
    }

    res.json({ success: true, project: { id: data.id, name: data.name, active: data.active } });
  } catch (err) {
    console.error('POST /admin/projects error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ── PATCH /api/admin/projects/:id — update project ───────────────────────────
router.patch('/projects/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, pin, active } = req.body;

  try {
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (active !== undefined) updates.active = active;
    if (pin !== undefined) updates.pin_hash = await bcrypt.hash(String(pin), 12);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found' });

    res.json({ success: true, project: { id: data.id, name: data.name, active: data.active } });
  } catch (err) {
    console.error('PATCH /admin/projects error:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ── DELETE /api/admin/projects/:id — soft-delete (deactivate) ────────────────
router.delete('/projects/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('projects')
      .update({ active: false })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/projects error:', err);
    res.status(500).json({ error: 'Failed to deactivate project' });
  }
});

// ── GET /api/admin/projects — list all projects (including inactive) ──────────
router.get('/projects', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /admin/projects error:', err);
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

// ── GET /api/admin/submissions — recent submissions for monitoring ─────────────
router.get('/submissions', requireAdmin, async (req, res) => {
  const { project, from, to } = req.query;

  try {
    let query = supabase
      .from('submissions')
      .select('id, project_id, report_date, representative, submitted_at, docx_url, photo_urls, edit_locked')
      .order('submitted_at', { ascending: false })
      .limit(50);

    if (project) query = query.eq('project_id', project);
    if (from) query = query.gte('report_date', from);
    if (to) query = query.lte('report_date', to);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('GET /admin/submissions error:', err);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

module.exports = router;
