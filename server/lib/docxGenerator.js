const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  ImageRun,
  VerticalAlign,
  HeightRule,
} = require('docx');

const { formatDateForDisplay } = require('./filename');
const { getWorksPlannedLabel } = require('./friday');

// RES navy colour used in header row
const NAVY = '1F3864';
const BLACK = '000000';
const WHITE = 'FFFFFF';

// A4 dimensions in DXA (twentieths of a point). 1cm ≈ 567 DXA.
// Full page width minus margins: A4 = 11906 DXA wide, margins 1440 each side → 9026 usable.
const PAGE_WIDTH_DXA = 9026;

// Standard cell margin applied to every cell
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

// Thin single border for all cells
function border(color = BLACK) {
  return {
    top:    { style: BorderStyle.SINGLE, size: 6, color },
    bottom: { style: BorderStyle.SINGLE, size: 6, color },
    left:   { style: BorderStyle.SINGLE, size: 6, color },
    right:  { style: BorderStyle.SINGLE, size: 6, color },
  };
}

// Clear shading (white background) — NEVER use SOLID as it breaks rendering
function clearShading() {
  return { type: ShadingType.CLEAR, color: 'auto', fill: 'FFFFFF' };
}

// Header shading (navy)
function navyShading() {
  return { type: ShadingType.CLEAR, color: 'auto', fill: NAVY };
}

// Helper: build a paragraph with runs
function para(runs, alignment = AlignmentType.LEFT) {
  const runObjects = runs.map(r => {
    if (typeof r === 'string') return new TextRun({ text: r, font: 'Arial', size: 22 });
    return new TextRun({ font: 'Arial', size: 22, ...r });
  });
  return new Paragraph({ children: runObjects, alignment });
}

// A cell spanning the full table width
function fullWidthCell(paragraphs, shadingFn = clearShading, columnSpan = 2) {
  return new TableCell({
    columnSpan,
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    shading: shadingFn(),
    borders: border(),
    margins: CELL_MARGINS,
    children: paragraphs,
  });
}

// A half-width cell (two-column rows)
function halfCell(paragraphs) {
  return new TableCell({
    width: { size: Math.floor(PAGE_WIDTH_DXA / 2), type: WidthType.DXA },
    shading: clearShading(),
    borders: border(),
    margins: CELL_MARGINS,
    children: paragraphs,
  });
}

// Format sub-contractors array as readable text
function formatSubcontractors(subs) {
  if (!subs || subs.length === 0) return 'None';
  return subs
    .map(s => {
      const crew = parseInt(s.crew, 10) || 0;
      return `${s.company} : ${s.lead} + ${crew}`;
    })
    .join('\n');
}

// Convert a pixel/point width to EMUs for ImageRun (1 cm = 360000 EMU)
// Target width: ~8 cm = 2880000 EMU
const TARGET_WIDTH_EMU = 2880000;

async function generateDocx(data, photoBuffers = []) {
  const {
    projectName,
    reportDate,
    arrivalTime,
    departureTime,
    representative,
    teamOnSite,
    subcontractors,
    worksCompleted,
    worksPlanned,
    worksPlannedLabel,
    hseIssues = 'None',
    comments = 'None',
  } = data;

  const displayDate = formatDateForDisplay(reportDate);
  const label = worksPlannedLabel || getWorksPlannedLabel(reportDate, null);

  // ── Row 1: Full-width header ──────────────────────────────────────────────
  const headerRow = new TableRow({
    height: { value: 600, rule: HeightRule.ATLEAST },
    children: [
      fullWidthCell(
        [para([{ text: 'DAILY SITE REPORT', bold: true, size: 28, color: WHITE }], AlignmentType.CENTER)],
        navyShading,
        2
      )
    ]
  });

  // ── Row 2: Project / Date ─────────────────────────────────────────────────
  const projectDateRow = new TableRow({
    children: [
      halfCell([para([{ text: 'Project Name: ', bold: true }, projectName])]),
      halfCell([para([{ text: 'Date: ', bold: true }, displayDate])]),
    ]
  });

  // ── Row 3: Arrival / Departure ───────────────────────────────────────────
  const timesRow = new TableRow({
    children: [
      halfCell([para([{ text: 'RES Arrival time on site: ', bold: true }, arrivalTime || ''])]),
      halfCell([para([{ text: 'RES Departure time: ', bold: true }, departureTime || ''])]),
    ]
  });

  // ── Row 4: Representative ────────────────────────────────────────────────
  const repRow = new TableRow({
    children: [
      fullWidthCell([para([{ text: 'RES Team Representative: ', bold: true }, representative || ''])], clearShading, 2)
    ]
  });

  // ── Row 5: Team on site ───────────────────────────────────────────────────
  const teamRow = new TableRow({
    children: [
      fullWidthCell([para([{ text: 'RES Team on site: ', bold: true }, teamOnSite || ''])], clearShading, 2)
    ]
  });

  // ── Row 6: Sub-contractors ────────────────────────────────────────────────
  const subText = formatSubcontractors(subcontractors);
  const subParas = subText.split('\n').map(line =>
    para([{ text: 'Sub-contractors on site: ', bold: true }, line])
  );
  // First line has the label; subsequent lines are indented
  const subParagraphs = subText.split('\n').map((line, i) =>
    i === 0
      ? para([{ text: 'Sub-contractors on site: ', bold: true }, line])
      : para([{ text: '                                          ' + line }])
  );

  const subRow = new TableRow({
    children: [
      fullWidthCell(subParagraphs, clearShading, 2)
    ]
  });

  // ── Row 7: Works Completed / Works Planned (side-by-side headers) ────────
  const worksHeaderRow = new TableRow({
    height: { value: 400, rule: HeightRule.ATLEAST },
    children: [
      halfCell([para([{ text: 'Works Completed Today', bold: true, size: 24 }], AlignmentType.CENTER)]),
      halfCell([para([{ text: `Works Planned ${label}:`, bold: true, size: 24 }], AlignmentType.CENTER)]),
    ]
  });

  // ── Row 8: Works Completed / Works Planned (content) ────────────────────
  // Split multi-line text into separate paragraphs
  function textToParas(text) {
    if (!text) return [para([''])];
    return text.split('\n').map(line => para([line]));
  }

  const worksContentRow = new TableRow({
    height: { value: 1800, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: Math.floor(PAGE_WIDTH_DXA / 2), type: WidthType.DXA },
        shading: clearShading(),
        borders: border(),
        margins: CELL_MARGINS,
        verticalAlign: VerticalAlign.TOP,
        children: textToParas(worksCompleted),
      }),
      new TableCell({
        width: { size: Math.floor(PAGE_WIDTH_DXA / 2), type: WidthType.DXA },
        shading: clearShading(),
        borders: border(),
        margins: CELL_MARGINS,
        verticalAlign: VerticalAlign.TOP,
        children: textToParas(worksPlanned),
      }),
    ]
  });

  // ── Row 9: HSE issues ─────────────────────────────────────────────────────
  const hseRow = new TableRow({
    children: [
      fullWidthCell(
        [para([{ text: 'HSE issues: ', bold: true }, hseIssues || 'None'])],
        clearShading, 2
      )
    ]
  });

  // ── Row 10: Comments ──────────────────────────────────────────────────────
  const commentsRow = new TableRow({
    children: [
      fullWidthCell(
        [para([{ text: 'Comments: ', bold: true }, comments || 'None'])],
        clearShading, 2
      )
    ]
  });

  const rows = [
    headerRow,
    projectDateRow,
    timesRow,
    repRow,
    teamRow,
    subRow,
    worksHeaderRow,
    worksContentRow,
    hseRow,
    commentsRow,
  ];

  // ── Photo rows: 2 photos per row, ~8 cm each ─────────────────────────────
  if (photoBuffers && photoBuffers.length > 0) {
    // Photos header row
    rows.push(new TableRow({
      children: [
        fullWidthCell(
          [para([{ text: 'Site Photos', bold: true, size: 24 }], AlignmentType.CENTER)],
          clearShading, 2
        )
      ]
    }));

    // Pair photos into rows of 2
    for (let i = 0; i < photoBuffers.length; i += 2) {
      const left = photoBuffers[i];
      const right = photoBuffers[i + 1] || null;

      function photoCell(buf) {
        if (!buf) {
          // Empty cell placeholder when we have an odd number of photos
          return new TableCell({
            width: { size: Math.floor(PAGE_WIDTH_DXA / 2), type: WidthType.DXA },
            shading: clearShading(),
            borders: border(),
            margins: CELL_MARGINS,
            children: [new Paragraph({ children: [] })],
          });
        }
        return new TableCell({
          width: { size: Math.floor(PAGE_WIDTH_DXA / 2), type: WidthType.DXA },
          shading: clearShading(),
          borders: border(),
          margins: CELL_MARGINS,
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: buf,
                  transformation: {
                    width: Math.round(TARGET_WIDTH_EMU / 9144), // convert EMU→pt for docx lib
                    height: Math.round(TARGET_WIDTH_EMU / 9144), // square placeholder; aspect handled below
                  },
                  type: 'jpg',
                })
              ],
              alignment: AlignmentType.CENTER,
            })
          ],
        });
      }

      rows.push(new TableRow({ children: [photoCell(left), photoCell(right)] }));
    }
  }

  const table = new Table({
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [
      Math.floor(PAGE_WIDTH_DXA / 2),
      PAGE_WIDTH_DXA - Math.floor(PAGE_WIDTH_DXA / 2),
    ],
    rows,
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            // A4: 210mm × 297mm in DXA (1 mm = 56.69 DXA)
            width: 11906,
            height: 16838,
          },
          margin: {
            top: 720,    // ~1.27 cm
            bottom: 720,
            left: 1440,  // ~2.54 cm
            right: 1440,
          }
        }
      },
      children: [table],
    }],
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22 }
        }
      }
    }
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateDocx };
