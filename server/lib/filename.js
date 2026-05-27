function normalizeProjectName(name) {
  // Strip everything except alphanumerics — used in filenames
  return name.replace(/[^A-Za-z0-9]/g, '').trim();
}

function formatDateForFilename(date) {
  // DD-MM-YYYY — filesystem-safe version of the SA date convention
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatDateForFolder(date) {
  // YYYY-MM-DD — used for folder names so they sort chronologically
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function formatDateForDisplay(date) {
  // DD/MM/YYYY — South African convention for display inside the docx
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

module.exports = { normalizeProjectName, formatDateForFilename, formatDateForFolder, formatDateForDisplay };
