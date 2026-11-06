// "Download PDF" for a Weekly SD report week, on the agent page and the
// customer portal: draws src/weeklyPdf.js content with jsPDF in the browser,
// in the same look as the report PDF (exportPdf.js). jsPDF loads on first use.
import { weeklyPdfContent, weeklyPdfFileName } from '../../../src/weeklyPdf.js';
import { pdfSafe } from '../../../src/pdfReport.js';
import { logoFormat, logoSize } from '../../../src/logos.js';

// A fixed light palette (the PDF is printed and shared), as in exportPdf.js.
const INK = [23, 43, 77];
const MUTED = [98, 111, 134];
const BRAND = [12, 102, 228];
const RULE = [220, 223, 228];
const FILL = [244, 245, 247];

const W = 210;
const H = 297;
const M = 16;
const CW = W - 2 * M;
const BOTTOM = H - 18;
const lh = (size) => size * 0.3528 * 1.35;

/** The PDF document for one week. `JsPdf` is jsPDF's constructor (tests pass it). */
export function buildWeeklyPdf(JsPdf, c, { product = 'Customer Insights', logos = null } = {}) {
  const doc = new JsPdf({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: pdfSafe(`${c.title}: ${c.subtitle}`), creator: pdfSafe(product) });
  let y = M;
  let onNewPage = null;
  const font = (size, style = 'normal', rgb = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...rgb); };
  const split = (text, width) => doc.splitTextToSize(pdfSafe(text), width);
  const newPage = () => { doc.addPage(); y = M; if (onNewPage) onNewPage(); };
  const room = (h) => { if (y + h > BOTTOM) newPage(); };

  function paragraph(text, { size = 9.5, style = 'normal', rgb = INK, x = M, width = CW - (x - M), gap = 1.5 } = {}) {
    if (!text) return;
    font(size, style, rgb);
    for (const line of split(text, width)) { room(lh(size)); doc.text(line, x, y + lh(size) * 0.78); y += lh(size); }
    y += gap;
  }
  function heading(text, size = 13) {
    onNewPage = null;
    room(24);
    y += 4;
    font(size, 'bold');
    doc.text(pdfSafe(text), M, y + lh(size) * 0.78);
    y += lh(size) + 1;
    if (size >= 13) { doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(M, y, M + 18, y); y += 4; } else y += 1;
  }
  function bulletList(lines) {
    for (const line of lines) {
      font(9.5); room(lh(9.5)); doc.text('•', M + 1, y + lh(9.5) * 0.78);
      paragraph(line, { x: M + 5, gap: 0.8 });
    }
    y += 1.5;
  }
  function table(t) {
    if (t.caption) paragraph(t.caption, { size: 9.5, style: 'bold', gap: 1 });
    const total = t.columns.reduce((s, col) => s + (col.weight || 1), 0);
    let x = M;
    const cols = t.columns.map((col) => { const w = (CW * (col.weight || 1)) / total; const out = { ...col, x, w }; x += w; return out; });
    const size = cols.length > 6 ? 8 : 8.8;
    const header = () => {
      font(7.6, 'bold', MUTED);
      const heights = cols.map((col) => split(col.label, col.w - 2).length);
      const hh = Math.max(...heights) * lh(7.6) + 2;
      cols.forEach((col) => split(col.label, col.w - 2).forEach((l, i) => doc.text(l, col.align === 'right' ? col.x + col.w - 1 : col.x, y + lh(7.6) * (i + 0.78), { align: col.align === 'right' ? 'right' : 'left' })));
      y += hh; doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 1;
    };
    room(lh(7.6) * 2 + lh(size) * 2 + 4);
    header();
    onNewPage = header;
    for (const raw of t.rows) {
      const row = Array.isArray(raw) ? { cells: raw } : raw;
      font(size, row.bold ? 'bold' : 'normal');
      const lines = row.cells.map((cell, i) => (t.wrap || i === 0 ? split(cell ?? '', cols[i].w - 2) : [pdfSafe(cell ?? '')]));
      const rh = Math.max(...lines.map((l) => l.length)) * lh(size) + 1.2;
      room(rh);
      font(size, row.bold ? 'bold' : 'normal'); // a page break redraws the header in its own font
      lines.forEach((ls, i) => ls.forEach((l, k) => doc.text(l, cols[i].align === 'right' ? cols[i].x + cols[i].w - 1 : cols[i].x, y + lh(size) * (k + 0.78), { align: cols[i].align === 'right' ? 'right' : 'left' })));
      y += rh;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M, y, W - M, y); y += 0.8;
    }
    onNewPage = null;
    y += 3;
  }
  function kpis(list) {
    const gap = 4;
    const boxW = (CW - gap * (list.length - 1)) / list.length;
    room(22);
    list.forEach((k, i) => {
      const x = M + i * (boxW + gap);
      doc.setFillColor(...FILL); doc.roundedRect(x, y, boxW, 19, 1.5, 1.5, 'F');
      font(7.8, 'normal', MUTED); doc.text(pdfSafe(k.label), x + 3, y + 5.2);
      font(14, 'bold'); doc.text(pdfSafe(k.value), x + 3, y + 11.8);
      if (k.hint) { font(7.2, 'normal', MUTED); doc.text(split(k.hint, boxW - 6)[0] || '', x + 3, y + 16.2); }
    });
    y += 24;
  }
  function section(s, level = 13) {
    heading(s.title, level);
    if (s.kpis) kpis(s.kpis);
    for (const t of s.tables || []) table(t);
    if (s.bullets) bulletList(s.bullets);
    for (const g of s.groups || []) section(g, 10.5);
    for (const note of s.notes || []) paragraph(note, { size: 8.2, rgb: MUTED });
  }

  // Logos: the company's top left, the customer's top right.
  const LOGO_H = 14;
  let logoRow = 0;
  for (const [logo, right] of [[logos?.company, false], [logos?.customer, true]]) {
    if (!logo?.dataUrl) continue;
    try {
      const { width, height } = logoSize(logo, LOGO_H, CW / 2 - 6);
      doc.addImage(logo.dataUrl, logoFormat(logo), right ? W - M - width : M, y, width, height);
      logoRow = Math.max(logoRow, height);
    } catch { /* an unreadable image is left out */ }
  }
  if (logoRow) y += logoRow + 6;

  font(9, 'bold', BRAND); doc.text('WEEKLY SD REPORT', M, y + lh(9) * 0.78); y += lh(9) + 1;
  paragraph(c.title, { size: 20, style: 'bold', gap: 0 });
  paragraph(c.subtitle, { size: 10, rgb: MUTED, gap: 0.5 });
  paragraph(`${c.organizations}${c.built ? ` · built ${c.built}` : ''}`, { size: 8.5, rgb: MUTED, gap: 3 });
  for (const s of c.sections) section(s);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    font(7.5, 'normal', MUTED);
    doc.text(pdfSafe(`${c.title} · ${c.subtitle}`), M, H - 9);
    doc.text(`${p} / ${pages}`, W - M, H - 9, { align: 'right' });
  }
  return doc;
}

/** Builds and downloads the week's PDF. `logos` is optional: { company, customer }. */
export async function downloadWeeklyPdf(record, { logos = null, product = 'Customer Insights' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = buildWeeklyPdf(jsPDF, weeklyPdfContent(record), { logos, product });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(doc.output('blob'));
  link.download = weeklyPdfFileName(record);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
