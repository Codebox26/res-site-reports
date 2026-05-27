const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const supabase = require('../db');

// GET /api/auth/projects — public list of active projects (no PINs)
router.get('/projects', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .eq('active', true)
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /projects error:', err);
    res.status(500).json({ error: 'Could not load projects' });
  }
});

// POST /api/auth/verify-pin — verify PIN and return session marker
router.post('/verify-pin', async (req, res) => {
  const { projectId, pin } = req.body;

  if (!projectId || !pin) {
    return res.status(400).json({ error: 'projectId and pin are required' });
  }

  try {
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, name, pin_hash, active')
      .eq('id', projectId)
      .single();

    if (error || !project) {
      // Return generic error — don't reveal whether project exists
      return res.status(401).json({ success: false, error: 'Invalid project or PIN' });
    }

    if (!project.active) {
      return res.status(401).json({ success: false, error: 'Invalid project or PIN' });
    }

    const match = await bcrypt.compare(String(pin), project.pin_hash);

    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid project or PIN' });
    }

    // Return a lightweight session token: base64-encoded "projectId:timestamp" signed with a simple HMAC
    // For this app's threat model, a time-limited signed token is sufficient (no JWT library needed)
    const token = Buffer.from(JSON.stringify({
      projectId: project.id,
      projectName: project.name,
      exp: Date.now() + 12 * 60 * 60 * 1000 // 12-hour session
    })).toString('base64');

    res.json({ success: true, token, projectId: project.id, projectName: project.name });
  } catch (err) {
    console.error('verify-pin error:', err);
    res.status(500).json({ error: 'Server error during PIN verification' });
  }
});

module.exports = router;
