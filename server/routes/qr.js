const express = require('express');
const QRCode = require('qrcode');
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

// ── GET /api/qr/:projectId ────────────────────────────────────────────────────
// Returns a PNG QR code encoding the app URL with project pre-selected.
// Note: the QR does NOT encode the PIN in the URL (security: PIN must be typed).
// The URL just pre-selects the project in the dropdown.
router.get('/:projectId', requireAdmin, async (req, res) => {
  const { projectId } = req.params;

  try {
    // Verify project exists
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single();

    if (error || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Build the URL that the QR code points to
    // Using the request host so this works on any deployment URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const appUrl = `${protocol}://${host}/?project=${encodeURIComponent(projectId)}`;

    const qrPng = await QRCode.toBuffer(appUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#1F3864',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="QR_${project.name.replace(/[^A-Za-z0-9]/g, '_')}.png"`);
    res.send(qrPng);

  } catch (err) {
    console.error('GET /qr error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
