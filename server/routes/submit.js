const express = require('express');
const multer = require('multer');
const router = express.Router();
const supabase = require('../db');
const { generateDocx } = require('../lib/docxGenerator');
const { normalizeProjectName, formatDateForFilename, formatDateForFolder } = require('../lib/filename');
const { getWorksPlannedLabel } = require('../lib/friday');

// Photos are held in memory (Render's disk is ephemeral — we upload straight to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 8 }, // 2 MB per photo, max 8
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  }
});

// ── Middleware: validate project token from header or body ────────────────────
function requireProjectAuth(req, res, next) {
  const tokenHeader = req.headers['x-project-token'];
  const tokenBody = req.body?.projectToken;
  const raw = tokenHeader || tokenBody;

  if (!raw) {
    return res.status(401).json({ error: 'No project token provided' });
  }

  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!payload.projectId || !payload.projectName || !payload.exp) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Session expired. Please re-enter your PIN.' });
    }
    req.projectId = payload.projectId;
    req.projectName = payload.projectName;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Helper: get today's date string in Africa/Johannesburg ────────────────────
function todayJHB() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }); // YYYY-MM-DD
}

// ── POST /api/submit ──────────────────────────────────────────────────────────
router.post('/', upload.array('photos', 8), requireProjectAuth, async (req, res) => {
  try {
    const body = req.body;
    const projectId = req.projectId;
    const projectName = req.projectName;

    // Validate required fields
    const required = ['reportDate', 'arrivalTime', 'departureTime', 'representative', 'teamOnSite', 'worksCompleted', 'worksPlanned'];
    for (const field of required) {
      if (!body[field] || String(body[field]).trim() === '') {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }

    // Departure must be after arrival
    if (body.arrivalTime >= body.departureTime) {
      return res.status(400).json({ error: 'Departure time must be after arrival time' });
    }

    // Parse subcontractors (sent as JSON string from the form)
    let subcontractors = [];
    try {
      subcontractors = body.subcontractors ? JSON.parse(body.subcontractors) : [];
    } catch {
      subcontractors = [];
    }

    const reportDate = body.reportDate;
    const worksPlannedLabel = getWorksPlannedLabel(reportDate, body.worksPlannedChoice);

    // ── Upload photos to Supabase Storage ─────────────────────────────────
    const photoUrls = [];
    const photoBuffers = [];
    const dateFolder = formatDateForFolder(reportDate);
    const storageBase = `reports/${projectId}/${dateFolder}`;

    for (let i = 0; i < (req.files || []).length; i++) {
      const file = req.files[i];
      const filename = `photo_${i + 1}.jpg`;
      const storagePath = `${storageBase}/${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from('reports')
        .upload(storagePath, file.buffer, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadErr) {
        console.error(`Photo upload error for ${filename}:`, uploadErr);
        continue; // Skip failed photos but don't fail the whole submission
      }

      const { data: { publicUrl } } = supabase.storage.from('reports').getPublicUrl(storagePath);
      photoUrls.push(publicUrl);
      photoBuffers.push(file.buffer);
    }

    // ── Generate DOCX ──────────────────────────────────────────────────────
    const docxBuffer = await generateDocx({
      projectName,
      reportDate,
      arrivalTime: body.arrivalTime,
      departureTime: body.departureTime,
      representative: body.representative,
      teamOnSite: body.teamOnSite,
      subcontractors,
      worksCompleted: body.worksCompleted,
      worksPlanned: body.worksPlanned,
      worksPlannedLabel,
      hseIssues: body.hseIssues || 'None',
      comments: body.comments || 'None',
    }, photoBuffers);

    // ── Upload DOCX ────────────────────────────────────────────────────────
    const normalizedName = normalizeProjectName(projectName);
    const dateStr = formatDateForFilename(reportDate);
    const docxFilename = `RES_Daily_Site_Report_${normalizedName}_${dateStr}.docx`;
    const docxPath = `${storageBase}/${docxFilename}`;

    const { error: docxErr } = await supabase.storage
      .from('reports')
      .upload(docxPath, docxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true
      });

    if (docxErr) {
      console.error('DOCX upload error:', docxErr);
      return res.status(500).json({ error: 'Failed to save report document' });
    }

    const { data: { publicUrl: docxUrl } } = supabase.storage.from('reports').getPublicUrl(docxPath);

    // ── Insert into submissions table ──────────────────────────────────────
    const submittedFromIp = req.ip || req.connection?.remoteAddress || 'unknown';

    const { data: submission, error: dbErr } = await supabase
      .from('submissions')
      .insert({
        project_id: projectId,
        report_date: reportDate,
        arrival_time: body.arrivalTime,
        departure_time: body.departureTime,
        representative: body.representative,
        team_on_site: body.teamOnSite,
        subcontractors,
        works_completed: body.worksCompleted,
        works_planned: body.worksPlanned,
        works_planned_label: worksPlannedLabel,
        hse_issues: body.hseIssues || 'None',
        comments: body.comments || 'None',
        docx_url: docxUrl,
        photo_urls: photoUrls,
        submitted_from_ip: submittedFromIp,
      })
      .select()
      .single();

    if (dbErr) {
      console.error('DB insert error:', dbErr);
      return res.status(500).json({ error: 'Failed to save submission record' });
    }

    res.json({
      success: true,
      submissionId: submission.id,
      docxUrl,
      photoUrls,
      savedPath: docxPath,
    });

  } catch (err) {
    console.error('POST /submit error:', err);
    res.status(500).json({ error: 'Submission failed: ' + err.message });
  }
});

// ── GET /api/submit/today/:projectId — fetch today's submission if editable ──
router.get('/today/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const today = todayJHB();

  try {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('project_id', projectId)
      .eq('report_date', today)
      .eq('edit_locked', false)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found

    res.json(data || null);
  } catch (err) {
    console.error('GET /today error:', err);
    res.status(500).json({ error: 'Could not fetch today\'s submission' });
  }
});

// ── PUT /api/submit/:submissionId — edit a same-day submission ────────────────
router.put('/:submissionId', upload.array('photos', 8), requireProjectAuth, async (req, res) => {
  const { submissionId } = req.params;
  const projectId = req.projectId;
  const projectName = req.projectName;

  try {
    // Verify the submission belongs to this project, is from today, and isn't locked
    const today = todayJHB();
    const { data: existing, error: fetchErr } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .eq('project_id', projectId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (existing.edit_locked) {
      return res.status(403).json({ error: 'This submission is locked and cannot be edited' });
    }

    if (existing.report_date !== today) {
      return res.status(403).json({ error: 'Only today\'s submissions can be edited' });
    }

    const body = req.body;
    let subcontractors = [];
    try {
      subcontractors = body.subcontractors ? JSON.parse(body.subcontractors) : [];
    } catch {
      subcontractors = [];
    }

    const reportDate = body.reportDate || existing.report_date;
    const worksPlannedLabel = getWorksPlannedLabel(reportDate, body.worksPlannedChoice);

    // Keep existing photos unless new ones are uploaded
    let photoUrls = existing.photo_urls || [];
    const photoBuffers = [];
    const dateFolder = formatDateForFolder(reportDate);
    const storageBase = `reports/${projectId}/${dateFolder}`;

    if (req.files && req.files.length > 0) {
      photoUrls = [];
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const filename = `photo_${i + 1}.jpg`;
        const storagePath = `${storageBase}/${filename}`;

        await supabase.storage.from('reports').upload(storagePath, file.buffer, {
          contentType: 'image/jpeg', upsert: true
        });

        const { data: { publicUrl } } = supabase.storage.from('reports').getPublicUrl(storagePath);
        photoUrls.push(publicUrl);
        photoBuffers.push(file.buffer);
      }
    }

    // Re-generate DOCX
    const docxBuffer = await generateDocx({
      projectName,
      reportDate,
      arrivalTime: body.arrivalTime || existing.arrival_time,
      departureTime: body.departureTime || existing.departure_time,
      representative: body.representative || existing.representative,
      teamOnSite: body.teamOnSite || existing.team_on_site,
      subcontractors,
      worksCompleted: body.worksCompleted || existing.works_completed,
      worksPlanned: body.worksPlanned || existing.works_planned,
      worksPlannedLabel,
      hseIssues: body.hseIssues || existing.hse_issues || 'None',
      comments: body.comments || existing.comments || 'None',
    }, photoBuffers);

    const normalizedName = normalizeProjectName(projectName);
    const dateStr = formatDateForFilename(reportDate);
    const docxFilename = `RES_Daily_Site_Report_${normalizedName}_${dateStr}.docx`;
    const docxPath = `${storageBase}/${docxFilename}`;

    await supabase.storage.from('reports').upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true
    });

    const { data: { publicUrl: docxUrl } } = supabase.storage.from('reports').getPublicUrl(docxPath);

    const { data: updated, error: updateErr } = await supabase
      .from('submissions')
      .update({
        arrival_time: body.arrivalTime,
        departure_time: body.departureTime,
        representative: body.representative,
        team_on_site: body.teamOnSite,
        subcontractors,
        works_completed: body.worksCompleted,
        works_planned: body.worksPlanned,
        works_planned_label: worksPlannedLabel,
        hse_issues: body.hseIssues || 'None',
        comments: body.comments || 'None',
        docx_url: docxUrl,
        photo_urls: photoUrls,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', submissionId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    res.json({ success: true, submissionId: updated.id, docxUrl, photoUrls });

  } catch (err) {
    console.error('PUT /submit error:', err);
    res.status(500).json({ error: 'Edit failed: ' + err.message });
  }
});

module.exports = router;
