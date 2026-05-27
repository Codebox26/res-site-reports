const express = require('express');
const router = express.Router();
const supabase = require('../db');
const { normalizeProjectName, formatDateForFilename } = require('../lib/filename');

// ── Middleware: require SYNC_API_KEY header ────────────────────────────────────
function requireSyncKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SYNC_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing sync API key' });
  }
  next();
}

// ── GET /api/sync/pending ─────────────────────────────────────────────────────
// Returns submissions that haven't been acknowledged by this laptop yet
router.get('/pending', requireSyncKey, async (req, res) => {
  const { laptopId, since } = req.query;

  if (!laptopId) {
    return res.status(400).json({ error: 'laptopId query parameter is required' });
  }

  try {
    let query = supabase
      .from('submissions')
      .select(`
        id,
        project_id,
        report_date,
        docx_url,
        photo_urls,
        submitted_at,
        synced_by,
        projects!inner(name)
      `)
      .order('submitted_at', { ascending: true });

    // Filter by time window if provided
    if (since) {
      query = query.gte('submitted_at', since);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filter out submissions already acknowledged by this laptop
    const pending = (data || []).filter(sub => {
      const syncedBy = sub.synced_by || [];
      return !syncedBy.includes(laptopId);
    });

    // Shape the response for the sync helper
    const result = pending.map(sub => {
      const projectName = sub.projects?.name || sub.project_id;
      const normalizedName = normalizeProjectName(projectName);
      const dateStr = formatDateForFilename(sub.report_date);
      const docxFilename = `RES_Daily_Site_Report_${normalizedName}_${dateStr}.docx`;

      return {
        submissionId: sub.id,
        projectName,
        reportDate: sub.report_date,
        docxUrl: sub.docx_url,
        docxFilename,
        photoUrls: sub.photo_urls || [],
        submittedAt: sub.submitted_at,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /sync/pending error:', err);
    res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

// ── POST /api/sync/acknowledge ────────────────────────────────────────────────
// Called by sync helper after successfully downloading a submission
router.post('/acknowledge', requireSyncKey, async (req, res) => {
  const { submissionId, laptopId, status } = req.body;

  if (!submissionId || !laptopId || !status) {
    return res.status(400).json({ error: 'submissionId, laptopId and status are required' });
  }

  try {
    // Append this laptop to the synced_by array (Postgres jsonb array append)
    const { data: existing, error: fetchErr } = await supabase
      .from('submissions')
      .select('synced_by')
      .eq('id', submissionId)
      .single();

    if (fetchErr) throw fetchErr;

    const syncedBy = existing?.synced_by || [];
    if (!syncedBy.includes(laptopId)) {
      syncedBy.push(laptopId);
    }

    const { error: updateErr } = await supabase
      .from('submissions')
      .update({ synced_by: syncedBy })
      .eq('id', submissionId);

    if (updateErr) throw updateErr;

    // Log to sync_log table
    await supabase.from('sync_log').insert({
      submission_id: submissionId,
      laptop_id: laptopId,
      status,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /sync/acknowledge error:', err);
    res.status(500).json({ error: 'Failed to acknowledge sync' });
  }
});

module.exports = router;
