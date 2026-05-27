/**
 * app.js — main application logic for both index.html and report.html.
 * Handles project selection, PIN verification, form submission, and offline queue.
 */

// ── Offline Queue (IndexedDB) ─────────────────────────────────────────────────
const DB_NAME = 'res-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending-submissions';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function queueSubmission(payload) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add({ ...payload, queuedAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPendingSubmissions() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function removePendingSubmission(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Online / Offline detection ────────────────────────────────────────────────
let isOnline = navigator.onLine;
const offlineBadge = document.getElementById('offline-badge');

function updateOnlineStatus() {
  isOnline = navigator.onLine;
  if (offlineBadge) {
    offlineBadge.classList.toggle('visible', !isOnline);
  }
  if (isOnline) {
    syncPendingQueue();
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ── Session storage for project token ────────────────────────────────────────
const SESSION_KEY = 'res_project_session';

function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return null;
    const session = JSON.parse(s);
    // Validate token hasn't expired client-side
    const payload = JSON.parse(atob(session.token));
    if (Date.now() > payload.exp) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Friday detection ──────────────────────────────────────────────────────────
function isFriday(dateStr) {
  // Use local time, not UTC, for day-of-week check
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  return d.getDay() === 5;
}

const FRIDAY_CHOICES = [
  'Tomorrow (Saturday)',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Next Monday'
];

function updateFridayUI(dateValue) {
  const fridayRow = document.getElementById('friday-choice-row');
  const worksLabel = document.getElementById('works-planned-label');
  const worksPlannedChoice = document.getElementById('worksPlannedChoice');

  if (!fridayRow || !worksLabel) return;

  if (isFriday(dateValue)) {
    fridayRow.style.display = '';
    const chosen = worksPlannedChoice?.value || 'Monday';
    if (worksLabel) worksLabel.textContent = `Works Planned ${chosen}:`;
  } else {
    fridayRow.style.display = 'none';
    if (worksLabel) worksLabel.textContent = 'Works Planned Tomorrow:';
  }
}

// ── Sub-contractor UI ─────────────────────────────────────────────────────────
let subCount = 0;

function addSubContractor(data = {}) {
  subCount++;
  const container = document.getElementById('sub-contractors-container');
  if (!container) return;

  const group = document.createElement('div');
  group.className = 'sub-group';
  group.dataset.subId = subCount;
  group.innerHTML = `
    <button type="button" class="sub-remove" title="Remove" onclick="removeSubContractor(this)">×</button>
    <div class="sub-group-grid">
      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:12px">Company</label>
        <input type="text" name="sub_company" placeholder="e.g. RSLP" value="${data.company || ''}">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:12px">Lead</label>
        <input type="text" name="sub_lead" placeholder="e.g. Mica" value="${data.lead || ''}">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label style="font-size:12px">Crew</label>
        <input type="number" name="sub_crew" placeholder="0" min="0" max="99" value="${data.crew || ''}">
      </div>
    </div>
  `;
  container.appendChild(group);
}

function removeSubContractor(btn) {
  btn.closest('.sub-group').remove();
}

function getSubContractors() {
  const container = document.getElementById('sub-contractors-container');
  if (!container) return [];

  return Array.from(container.querySelectorAll('.sub-group')).map(group => ({
    company: group.querySelector('[name="sub_company"]')?.value?.trim() || '',
    lead: group.querySelector('[name="sub_lead"]')?.value?.trim() || '',
    crew: parseInt(group.querySelector('[name="sub_crew"]')?.value || '0', 10),
  })).filter(s => s.company || s.lead);
}

// ── Form validation ───────────────────────────────────────────────────────────
function validateForm() {
  let valid = true;

  const required = [
    { id: 'reportDate',    msg: 'Date is required' },
    { id: 'arrivalTime',   msg: 'Arrival time is required' },
    { id: 'departureTime', msg: 'Departure time is required' },
    { id: 'representative', msg: 'Representative name is required' },
    { id: 'teamOnSite',    msg: 'Team on site is required' },
    { id: 'worksCompleted', msg: 'Works completed is required' },
    { id: 'worksPlanned',  msg: 'Works planned is required' },
  ];

  for (const { id, msg } of required) {
    const el = document.getElementById(id);
    const errEl = document.getElementById(`err-${id}`);
    if (!el) continue;

    const isEmpty = el.value.trim() === '';
    el.classList.toggle('error', isEmpty);
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.toggle('visible', isEmpty);
    }
    if (isEmpty) valid = false;
  }

  // Departure after arrival
  const arrival = document.getElementById('arrivalTime')?.value;
  const departure = document.getElementById('departureTime')?.value;
  const depErrEl = document.getElementById('err-departureTime');

  if (arrival && departure && departure <= arrival) {
    document.getElementById('departureTime')?.classList.add('error');
    if (depErrEl) {
      depErrEl.textContent = 'Departure must be after arrival';
      depErrEl.classList.add('visible');
    }
    valid = false;
  }

  return valid;
}

function clearError(inputId) {
  const el = document.getElementById(inputId);
  const errEl = document.getElementById(`err-${inputId}`);
  el?.classList.remove('error');
  errEl?.classList.remove('visible');
}

// ── Build FormData for submission ─────────────────────────────────────────────
function buildFormData(editSubmissionId = null) {
  const fd = new FormData();

  const textFields = [
    'reportDate', 'arrivalTime', 'departureTime', 'representative',
    'teamOnSite', 'worksCompleted', 'worksPlanned', 'hseIssues', 'comments'
  ];

  for (const field of textFields) {
    const el = document.getElementById(field);
    if (el) fd.append(field, el.value.trim() || '');
  }

  // Friday choice
  const fridayChoice = document.getElementById('worksPlannedChoice');
  if (fridayChoice) fd.append('worksPlannedChoice', fridayChoice.value);

  // Sub-contractors
  fd.append('subcontractors', JSON.stringify(getSubContractors()));

  // Photos
  const photos = window.getSelectedPhotos ? window.getSelectedPhotos() : [];
  for (const photo of photos) {
    fd.append('photos', photo.blob, `photo_${Date.now()}.jpg`);
  }

  return fd;
}

// ── Try to sync queued submissions ────────────────────────────────────────────
async function syncPendingQueue() {
  if (!isOnline) return;

  let pending;
  try {
    pending = await getPendingSubmissions();
  } catch { return; }

  if (!pending.length) return;

  const syncBanner = document.getElementById('sync-banner');
  if (syncBanner) {
    syncBanner.style.display = '';
    syncBanner.textContent = `Syncing ${pending.length} offline submission(s)…`;
  }

  for (const item of pending) {
    try {
      const session = loadSession();
      if (!session) continue;

      const fd = new FormData();
      // Restore all text fields
      for (const [key, val] of Object.entries(item.fields || {})) {
        fd.append(key, val);
      }

      await window.API.submitReport(fd, session.token);
      await removePendingSubmission(item.id);
    } catch (err) {
      console.warn('Queue sync failed for item', item.id, err);
    }
  }

  if (syncBanner) syncBanner.style.display = 'none';
}

// ── Index page: project picker ────────────────────────────────────────────────
async function initIndexPage() {
  const projectList = document.getElementById('project-list');
  const pinSection = document.getElementById('pin-section');
  const pinInput = document.getElementById('pinInput');
  const pinBtn = document.getElementById('pin-submit');
  const pinError = document.getElementById('pin-error');
  const openReportBtn = document.getElementById('open-report-btn');

  if (!projectList) return;

  // Check URL params for QR-code auto-select
  const params = new URLSearchParams(location.search);
  const preSelectedProject = params.get('project');

  let selectedProjectId = null;

  // Load projects
  let projects = [];
  try {
    projects = await window.API.getProjects();
  } catch (err) {
    projectList.innerHTML = `<div class="alert alert-error"><span class="alert-icon">⚠</span>Could not load projects: ${err.message}</div>`;
    return;
  }

  if (!projects.length) {
    projectList.innerHTML = '<p style="color:var(--text-muted);text-align:center">No active projects yet. Ask your admin to add one.</p>';
    return;
  }

  projects.forEach(project => {
    const el = document.createElement('div');
    el.className = 'project-option';
    el.dataset.id = project.id;
    el.innerHTML = `
      <div class="project-option-icon">${project.name.charAt(0).toUpperCase()}</div>
      <div class="project-option-name">${project.name}</div>
    `;
    el.addEventListener('click', () => {
      document.querySelectorAll('.project-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      selectedProjectId = project.id;
      if (pinSection) pinSection.style.display = '';
      pinInput?.focus();
    });
    projectList.appendChild(el);

    // Auto-select from QR code URL param
    if (project.id === preSelectedProject) {
      el.click();
    }
  });

  // PIN submit
  pinBtn?.addEventListener('click', async () => {
    const pin = pinInput?.value?.trim();
    if (!selectedProjectId) {
      if (pinError) { pinError.textContent = 'Please select a project first'; pinError.classList.add('visible'); }
      return;
    }
    if (!pin) {
      if (pinError) { pinError.textContent = 'Please enter your PIN'; pinError.classList.add('visible'); }
      return;
    }

    pinBtn.disabled = true;
    pinBtn.innerHTML = '<span class="spinner"></span> Verifying…';

    try {
      const result = await window.API.verifyPin(selectedProjectId, pin);
      if (result.success) {
        saveSession({ token: result.token, projectId: result.projectId, projectName: result.projectName });
        window.location.href = '/report.html';
      }
    } catch (err) {
      if (pinError) { pinError.textContent = err.message || 'Incorrect PIN'; pinError.classList.add('visible'); }
      pinInput?.select();
    } finally {
      pinBtn.disabled = false;
      pinBtn.innerHTML = 'Open Report';
    }
  });

  // Allow Enter key on PIN input
  pinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pinBtn?.click();
  });

  pinInput?.addEventListener('input', () => {
    if (pinError) pinError.classList.remove('visible');
  });
}

// ── Report page: form ─────────────────────────────────────────────────────────
async function initReportPage() {
  const session = loadSession();

  if (!session) {
    window.location.href = '/?expired=1';
    return;
  }

  // Check for edit mode
  const params = new URLSearchParams(location.search);
  const editMode = params.get('edit') === 'true';
  let editSubmissionId = null;

  // Show project name
  const projectNameDisplay = document.getElementById('project-name-display');
  if (projectNameDisplay) projectNameDisplay.textContent = session.projectName;

  // Default date = today in JHB timezone
  const dateInput = document.getElementById('reportDate');
  if (dateInput && !dateInput.value) {
    const todayJHB = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
    dateInput.value = todayJHB;
    updateFridayUI(todayJHB);
  }

  // Friday UI on date change
  dateInput?.addEventListener('change', (e) => updateFridayUI(e.target.value));

  // Friday dropdown → update label
  const fridayChoice = document.getElementById('worksPlannedChoice');
  fridayChoice?.addEventListener('change', (e) => {
    const worksLabel = document.getElementById('works-planned-label');
    if (worksLabel) worksLabel.textContent = `Works Planned ${e.target.value}:`;
  });

  // Clear errors on input
  document.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', () => clearError(el.id));
  });

  // Add sub-contractor button
  document.getElementById('add-sub-btn')?.addEventListener('click', () => addSubContractor());

  // If edit mode, load existing data
  if (editMode) {
    try {
      const existing = await window.API.getTodaySubmission(session.projectId);
      if (existing && !existing.edit_locked) {
        editSubmissionId = existing.id;
        prefillForm(existing);
        const editBanner = document.getElementById('edit-banner');
        if (editBanner) editBanner.style.display = '';
      } else if (existing?.edit_locked) {
        showLockedBanner();
      }
    } catch (err) {
      console.warn('Could not load edit data:', err);
    }
  }

  // Check if today already has a submission (for UX hint)
  if (!editMode) {
    try {
      const existing = await window.API.getTodaySubmission(session.projectId);
      if (existing) {
        const editHint = document.getElementById('edit-hint');
        if (editHint) {
          editHint.style.display = '';
          editHint.querySelector('a')?.setAttribute('href', '/report.html?edit=true');
        }
      }
    } catch { /* non-fatal */ }
  }

  // Photo UI
  window.initPhotoUI('photo-upload-area', 'photo-grid', 'photo-counter');

  // Form submit
  const submitBtn = document.getElementById('submit-btn');
  const form = document.getElementById('report-form');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    const fd = buildFormData(editSubmissionId);

    try {
      let result;
      if (editSubmissionId) {
        result = await window.API.editReport(editSubmissionId, fd, session.token);
      } else {
        result = await window.API.submitReport(fd, session.token);
      }

      showSuccessScreen(result, session.projectName);
    } catch (err) {
      if (!isOnline || err.message === 'Failed to fetch') {
        // Save to offline queue
        const fields = {};
        for (const [key, val] of fd.entries()) {
          if (typeof val === 'string') fields[key] = val;
        }
        await queueSubmission({ projectId: session.projectId, fields, token: session.token });
        showOfflineSuccess();
      } else {
        const errBanner = document.getElementById('submit-error');
        if (errBanner) {
          errBanner.textContent = err.message || 'Submission failed. Please try again.';
          errBanner.style.display = '';
          errBanner.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = editSubmissionId ? 'Update Report' : 'Submit Report';
    }
  });

  // Try to sync any queued submissions now that we're on this page
  syncPendingQueue();
}

function prefillForm(data) {
  const map = {
    reportDate: data.report_date,
    arrivalTime: data.arrival_time,
    departureTime: data.departure_time,
    representative: data.representative,
    teamOnSite: data.team_on_site,
    worksCompleted: data.works_completed,
    worksPlanned: data.works_planned,
    hseIssues: data.hse_issues,
    comments: data.comments,
  };

  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }

  // Sub-contractors
  if (data.subcontractors?.length) {
    data.subcontractors.forEach(s => addSubContractor(s));
  }

  updateFridayUI(data.report_date);
}

function showSuccessScreen(result, projectName) {
  const form = document.getElementById('report-form');
  const success = document.getElementById('success-screen');
  if (form) form.style.display = 'none';
  if (success) {
    success.style.display = '';
    const docxLink = success.querySelector('#docx-download');
    if (docxLink && result.docxUrl) {
      docxLink.href = result.docxUrl;
      docxLink.style.display = '';
    }
  }
  window.clearSelectedPhotos?.();
}

function showOfflineSuccess() {
  const form = document.getElementById('report-form');
  const success = document.getElementById('success-screen');
  const offlineMsg = document.getElementById('offline-success-msg');
  if (form) form.style.display = 'none';
  if (success) success.style.display = '';
  if (offlineMsg) offlineMsg.style.display = '';
  window.clearSelectedPhotos?.();
}

function showLockedBanner() {
  const banner = document.getElementById('locked-banner');
  if (banner) banner.style.display = '';
  document.getElementById('submit-btn')?.setAttribute('disabled', 'disabled');
}

// ── Auto-init based on which page we're on ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('project-list')) {
    initIndexPage();
  } else if (document.getElementById('report-form')) {
    initReportPage();
  }
});

// Expose for inline HTML usage
window.addSubContractor = addSubContractor;
window.removeSubContractor = removeSubContractor;
window.updateFridayUI = updateFridayUI;
window.isFriday = isFriday;
