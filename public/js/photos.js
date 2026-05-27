/**
 * photos.js — photo capture, compression, EXIF reading, and preview management.
 *
 * Reads EXIF data BEFORE compression because compression strips EXIF tags.
 * Compresses to ~1 MB max at 1920px longest side to save mobile data.
 */

// Processed photos stored as { blob, preview (object URL), metadata }
let selectedPhotos = [];

const MAX_PHOTOS = 8;

// ── EXIF reading (minimal, no library dependency) ────────────────────────────
// We only need GPS lat/lon and DateTimeOriginal from JPEG EXIF.
function readExif(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const view = new DataView(e.target.result);
      try {
        const exif = parseExifFromDataView(view);
        resolve(exif);
      } catch {
        resolve({ gps: null, timestamp: null });
      }
    };
    reader.onerror = () => resolve({ gps: null, timestamp: null });
    // Only read first 64KB — EXIF is always near the start of a JPEG
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

function parseExifFromDataView(view) {
  // Verify JPEG SOI marker
  if (view.getUint16(0) !== 0xFFD8) return { gps: null, timestamp: null };

  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);

    if (marker === 0xFFE1) {
      // APP1 — check for 'Exif\0\0'
      const exifHeader = view.getUint32(offset + 4);
      if (exifHeader === 0x45786966) { // 'Exif'
        return parseExifIFD(view, offset + 10);
      }
    }

    if (marker === 0xFFDA) break; // Start of scan, no more app segments
    offset += 2 + length;
  }
  return { gps: null, timestamp: null };
}

function parseExifIFD(view, start) {
  // Determine byte order
  const byteOrder = view.getUint16(start);
  const littleEndian = byteOrder === 0x4949;

  const ifdOffset = view.getUint32(start + 4, littleEndian);
  const result = { gps: null, timestamp: null };

  readIFD(view, start, start + ifdOffset, littleEndian, result);
  return result;
}

function readIFD(view, tiffStart, ifdStart, le, result) {
  try {
    const entryCount = view.getUint16(ifdStart, le);
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = ifdStart + 2 + i * 12;
      const tag = view.getUint16(entryOffset, le);
      const type = view.getUint16(entryOffset + 2, le);
      const count = view.getUint32(entryOffset + 4, le);
      const valueOffset = view.getUint32(entryOffset + 8, le);

      // Tag 0x8825 = GPS IFD pointer
      if (tag === 0x8825) {
        readGPSIFD(view, tiffStart, tiffStart + valueOffset, le, result);
      }

      // Tag 0x9003 = DateTimeOriginal
      if (tag === 0x9003 && type === 2) {
        const strOffset = count <= 4 ? entryOffset + 8 : tiffStart + valueOffset;
        let str = '';
        for (let j = 0; j < count - 1; j++) {
          str += String.fromCharCode(view.getUint8(strOffset + j));
        }
        result.timestamp = str;
      }
    }
  } catch { /* malformed EXIF is common */ }
}

function readGPSIFD(view, tiffStart, gpsStart, le, result) {
  try {
    const count = view.getUint16(gpsStart, le);
    let latRef = 'N', lonRef = 'E';
    let lat = null, lon = null;

    for (let i = 0; i < count; i++) {
      const off = gpsStart + 2 + i * 12;
      const tag = view.getUint16(off, le);
      const valueOffset = view.getUint32(off + 8, le);

      if (tag === 1) { // GPSLatitudeRef
        latRef = String.fromCharCode(view.getUint8(off + 8));
      } else if (tag === 2) { // GPSLatitude
        lat = readRational3(view, tiffStart + valueOffset, le);
      } else if (tag === 3) { // GPSLongitudeRef
        lonRef = String.fromCharCode(view.getUint8(off + 8));
      } else if (tag === 4) { // GPSLongitude
        lon = readRational3(view, tiffStart + valueOffset, le);
      }
    }

    if (lat !== null && lon !== null) {
      result.gps = {
        lat: (latRef === 'S' ? -1 : 1) * dmsToDecimal(...lat),
        lon: (lonRef === 'W' ? -1 : 1) * dmsToDecimal(...lon),
      };
    }
  } catch { /* skip GPS parsing errors */ }
}

function readRational3(view, offset, le) {
  return [
    view.getUint32(offset, le) / view.getUint32(offset + 4, le),
    view.getUint32(offset + 8, le) / view.getUint32(offset + 12, le),
    view.getUint32(offset + 16, le) / view.getUint32(offset + 20, le),
  ];
}

function dmsToDecimal(d, m, s) {
  return d + m / 60 + s / 3600;
}

// ── Image compression via Canvas ─────────────────────────────────────────────
// Using canvas instead of a CDN lib to avoid external dependencies on slow mobile.
function compressImage(file, maxSizeMB = 1, maxDimension = 1920) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Try quality 0.85 first; if still > maxSizeMB, try 0.70, then 0.55
      const tryCompress = (quality) => {
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('Compression failed'));
          if (blob.size <= maxSizeMB * 1024 * 1024 || quality < 0.4) {
            resolve(blob);
          } else {
            tryCompress(quality - 0.15);
          }
        }, 'image/jpeg', quality);
      };

      tryCompress(0.85);
    };

    img.onerror = reject;
    img.src = url;
  });
}

// ── Main processPhoto function ────────────────────────────────────────────────
async function processPhoto(file) {
  // Read EXIF BEFORE compression (compression strips EXIF data)
  const exif = await readExif(file);

  // Compress
  const blob = await compressImage(file, 1, 1920);

  return {
    blob,
    metadata: {
      originalName: file.name,
      gps: exif.gps,
      capturedAt: exif.timestamp,
    }
  };
}

// ── Photo UI management ───────────────────────────────────────────────────────
function initPhotoUI(uploadAreaId, gridId, counterId) {
  const uploadArea = document.getElementById(uploadAreaId);
  const fileInput = uploadArea?.querySelector('input[type="file"]');
  const grid = document.getElementById(gridId);
  const counter = document.getElementById(counterId);

  if (!uploadArea || !fileInput) return;

  // Click on the upload area triggers file picker
  uploadArea.addEventListener('click', () => {
    if (selectedPhotos.length < MAX_PHOTOS) fileInput.click();
  });

  // Prevent click on area when at limit
  uploadArea.addEventListener('click', () => {
    if (selectedPhotos.length >= MAX_PHOTOS) {
      alert(`Maximum ${MAX_PHOTOS} photos allowed.`);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    await handleNewFiles(files, grid, counter);
    fileInput.value = ''; // Reset so same file can be selected again
  });

  // Drag and drop support
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    await handleNewFiles(files, grid, counter);
  });
}

async function handleNewFiles(files, grid, counter) {
  const available = MAX_PHOTOS - selectedPhotos.length;
  const toProcess = files.slice(0, available);

  for (const file of toProcess) {
    try {
      const processed = await processPhoto(file);
      const previewUrl = URL.createObjectURL(processed.blob);
      selectedPhotos.push({ ...processed, preview: previewUrl });
      renderPhotoGrid(grid, counter);
    } catch (err) {
      console.error('Photo processing failed:', err);
    }
  }
}

function renderPhotoGrid(grid, counter) {
  if (!grid) return;

  grid.innerHTML = '';

  selectedPhotos.forEach((photo, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `
      <img src="${photo.preview}" alt="Photo ${index + 1}" loading="lazy">
      <button class="remove-photo" data-index="${index}" title="Remove photo">×</button>
    `;
    grid.appendChild(thumb);
  });

  grid.querySelectorAll('.remove-photo').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      URL.revokeObjectURL(selectedPhotos[idx].preview);
      selectedPhotos.splice(idx, 1);
      renderPhotoGrid(grid, counter);
    });
  });

  if (counter) {
    counter.textContent = selectedPhotos.length > 0
      ? `${selectedPhotos.length} photo${selectedPhotos.length !== 1 ? 's' : ''} selected`
      : '';
  }
}

function getSelectedPhotos() {
  return selectedPhotos;
}

function clearSelectedPhotos() {
  selectedPhotos.forEach(p => URL.revokeObjectURL(p.preview));
  selectedPhotos = [];
}

window.initPhotoUI = initPhotoUI;
window.getSelectedPhotos = getSelectedPhotos;
window.clearSelectedPhotos = clearSelectedPhotos;
