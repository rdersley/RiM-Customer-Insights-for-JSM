// "Export PDF": draws the report with jsPDF in the browser and downloads it
// like the CSV. Content and wording come from src/pdfReport.js. jsPDF is
// loaded on first use so the page itself stays small.
import { pdfContent, pdfFileName, pdfSafe, portalPdfContent, portalPdfFileName } from '../../../src/pdfReport.js';
import { logoFormat, logoSize } from '../../../src/logos.js';

// A fixed light palette: the PDF is printed and shared, so it doesn't follow
// the agent's screen theme. Colours match the UI kit's light tokens.
const INK = [23, 43, 77];
const MUTED = [98, 111, 134];
const BRAND = [12, 102, 228];
const RULE = [220, 223, 228];
const FILL = [244, 245, 247];
const MORE = [174, 46, 36]; // more tickets than before
const FEWER = [31, 132, 90];
const WHITE = [255, 255, 255];

const W = 210; // A4, millimetres
const H = 297;
const M = 16;
const CW = W - 2 * M;
const BOTTOM = H - 18;
const lineHeight = (size) => size * 0.3528 * 1.35;
const changeColour = (text) => (text.startsWith('+') || text === 'New' ? MORE : text.startsWith('-') ? FEWER : MUTED);

/** The PDF document for a report. `JsPdf` is jsPDF's constructor (tests pass it directly). */
export function buildPdf(JsPdf, c, { product = 'Customer Insights', version = '', logos = null } = {}) {
  // "Tickets" for agents; the portal says "Requests".
  const noun = c.noun || 'Ticket';
  const nouns = `${noun}s`;
  const doc = new JsPdf({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: pdfSafe(`${product}: ${c.title}, ${c.period}`), creator: pdfSafe(`${product} ${version}`.trim()) });
  let y = M;
  let onNewPage = null; // redraws a table header after a page break

  const font = (size, style = 'normal', rgb = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...rgb); };
  const split = (text, width) => doc.splitTextToSize(pdfSafe(text), width);
  const newPage = () => { doc.addPage(); y = M; if (onNewPage) onNewPage(); };
  const room = (h) => { if (y + h > BOTTOM) newPage(); };
  const write = (lines, x, size) => lines.forEach((line, i) => doc.text(line, x, y + lineHeight(size) * (i + 0.78)));

  function paragraph(text, { size = 10, style = 'normal', rgb = INK, x = M, width = CW - (x - M), gap = 2 } = {}) {
    if (!text) return;
    font(size, style, rgb);
    for (const line of split(text, width)) {
      room(lineHeight(size));
      write([line], x, size);
      y += lineHeight(size);
    }
    y += gap;
  }

  function heading(text) {
    onNewPage = null;
    room(22); // keep a heading with the start of its section
    y += 4;
    font(13, 'bold');
    write([pdfSafe(text)], M, 13);
    y += lineHeight(13) + 1;
    doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(M, y, M + 18, y);
    y += 4;
  }

  // ---- Logos: the company's top left, the customer's top right ------------------
  const LOGO_H = 14;
  let logoRow = 0;
  for (const [logo, right] of [[logos?.company, false], [logos?.customer, true]]) {
    if (!logo?.dataUrl) continue;
    try {
      const { width, height } = logoSize(logo, LOGO_H, CW / 2 - 6);
      doc.addImage(logo.dataUrl, logoFormat(logo), right ? W - M - width : M, y, width, height);
      logoRow = Math.max(logoRow, height);
    } catch { /* an unreadable image is left out rather than failing the PDF */ }
  }
  if (logoRow) y += logoRow + 6;

  // ---- Title -----------------------------------------------------------------
  font(9, 'bold', BRAND);
  write([pdfSafe(product.toUpperCase())], M, 9);
  y += lineHeight(9) + 1;
  paragraph(c.title, { size: 20, style: 'bold', gap: 0 });
  paragraph(`${c.period} · generated ${c.generated}`, { size: 10, rgb: MUTED, gap: 4 });

  if (c.notes.length) {
    font(8.5, 'normal', MUTED);
    const lines = c.notes.flatMap((n) => split(n, CW - 8));
    const h = lines.length * lineHeight(8.5) + 5;
    doc.setFillColor(...FILL); doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'F');
    y += 2.5; write(lines, M + 4, 8.5); y += h - 2.5 + 4;
  }

  // ---- Headline numbers ------------------------------------------------------
  const gap = 4;
  const boxW = (CW - gap * (c.kpis.length - 1)) / c.kpis.length;
  room(22);
  c.kpis.forEach((k, i) => {
    const x = M + i * (boxW + gap);
    doc.setFillColor(...FILL); doc.roundedRect(x, y, boxW, 20, 1.5, 1.5, 'F');
    font(8, 'normal', MUTED); doc.text(pdfSafe(k.label), x + 3.5, y + 5.5);
    font(15, 'bold', i === 1 ? changeColour(k.value) : INK); doc.text(pdfSafe(k.value), x + 3.5, y + 12.5);
    if (k.hint) { font(7.5, 'normal', MUTED); doc.text(split(k.hint, boxW - 7)[0] || '', x + 3.5, y + 17); }
  });
  y += 26;

  // ---- AI summary --------------------------------------------------------------
  if (c.overview || c.actions.length) {
    heading('Summary');
    paragraph(c.overview, { size: 10, gap: 3 });
    if (c.actions.length) {
      paragraph('Suggested follow-ups', { size: 10, style: 'bold', gap: 1 });
      for (const action of c.actions) {
        font(10); room(lineHeight(10)); doc.text('•', M + 1, y + lineHeight(10) * 0.78);
        paragraph(action, { x: M + 5, gap: 1 });
      }
      y += 2;
    }
  }

  // ---- Volume chart ------------------------------------------------------------
  if (c.volume.points.length) {
    heading(`${noun} activity`);
    const chartH = 38;
    room(chartH + 10);
    const points = c.volume.points;
    const max = Math.max(1, ...points.map((p) => p.count));
    const axisW = 10;
    const slot = (CW - axisW) / points.length;
    font(7.5, 'normal', MUTED);
    doc.text(String(max), M + axisW - 2, y + 2, { align: 'right' });
    doc.text('0', M + axisW - 2, y + chartH, { align: 'right' });
    doc.setDrawColor(...RULE); doc.setLineWidth(0.2);
    doc.line(M + axisW, y, W - M, y); doc.line(M + axisW, y + chartH, W - M, y + chartH);
    const every = Math.max(1, Math.ceil(points.length / 12));
    points.forEach((p, i) => {
      const h = (p.count / max) * chartH;
      const x = M + axisW + i * slot;
      // Text colour shares the PDF fill colour, so set it for every bar.
      if (h > 0) { doc.setFillColor(...BRAND); doc.rect(x + slot * 0.15, y + chartH - h, slot * 0.7, h, 'F'); }
      if (i % every === 0) doc.text(p.date.slice(5), x + slot / 2, y + chartH + 4, { align: 'center' });
    });
    y += chartH + 6;
    paragraph(`${nouns} per ${c.volume.unit}.`, { size: 8, rgb: MUTED });
  }

  // ---- Categories (AI) ----------------------------------------------------------
  if (c.categories?.length) {
    heading('Issue categories');
    const cols = [{ label: 'Share', x: 132 }, { label: nouns, x: 150 }, { label: 'Before', x: 168 }, { label: 'Change', x: W - M }];
    const nameW = 112;
    const header = () => {
      font(8, 'bold', MUTED);
      doc.text('Category', M, y + 4);
      cols.forEach((col) => doc.text(col.label, col.x, y + 4, { align: 'right' }));
      y += 6; doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 1.5;
    };
    header();
    onNewPage = header;
    for (const cat of c.categories) {
      font(10, 'bold');
      const name = split(cat.title, nameW);
      font(8, 'normal', MUTED);
      const details = split(cat.patterns, nameW);
      room(name.length * lineHeight(10) + details.length * lineHeight(8) + 3);
      font(10, 'bold'); write(name, M, 10);
      const base = y + lineHeight(10) * 0.78;
      font(9, 'normal', MUTED); doc.text(pdfSafe(cat.share), cols[0].x, base, { align: 'right' });
      font(10, 'normal'); doc.text(pdfSafe(cat.count), cols[1].x, base, { align: 'right' });
      font(10, 'normal', MUTED); doc.text(pdfSafe(cat.previous), cols[2].x, base, { align: 'right' });
      font(10, 'bold', changeColour(cat.change)); doc.text(pdfSafe(cat.change), cols[3].x, base, { align: 'right' });
      y += name.length * lineHeight(10);
      font(8, 'normal', MUTED); write(details, M, 8);
      y += details.length * lineHeight(8) + 1.5;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 1.5;
    }
    onNewPage = null;
  }

  // ---- Issues table ------------------------------------------------------------
  if (c.issues.length) {
    heading('Recurring issues');
    const cols = [{ label: nouns, x: 132 }, { label: 'Before', x: 150 }, { label: 'Change', x: 168 }, { label: 'Trend', x: W - M }];
    const nameW = 112;
    const header = () => {
      font(8, 'bold', MUTED);
      doc.text('Issue', M, y + 4);
      cols.forEach((col) => doc.text(col.label, col.x, y + 4, { align: 'right' }));
      y += 6; doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 1.5;
    };
    header();
    onNewPage = header;
    for (const issue of c.issues) {
      font(10, 'bold');
      const name = split(issue.name, nameW);
      font(8, 'normal', MUTED);
      const details = [issue.where, [issue.resolution, issue.peak ? `mostly ${issue.peak}` : ''].filter(Boolean).join(' · ')]
        .filter(Boolean).flatMap((t) => split(t, nameW));
      const h = name.length * lineHeight(10) + details.length * lineHeight(8) + 3;
      room(h);
      font(10, 'bold'); write(name, M, 10);
      font(10, 'normal'); doc.text(pdfSafe(issue.count), cols[0].x, y + lineHeight(10) * 0.78, { align: 'right' });
      font(10, 'normal', MUTED); doc.text(pdfSafe(issue.previous), cols[1].x, y + lineHeight(10) * 0.78, { align: 'right' });
      font(10, 'bold', changeColour(issue.change)); doc.text(pdfSafe(issue.change), cols[2].x, y + lineHeight(10) * 0.78, { align: 'right' });
      font(9, 'normal', MUTED); doc.text(pdfSafe(issue.trend), cols[3].x, y + lineHeight(10) * 0.78, { align: 'right' });
      y += name.length * lineHeight(10);
      font(8, 'normal', MUTED); write(details, M, 8);
      y += details.length * lineHeight(8) + 1.5;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 1.5;
    }
    onNewPage = null;
    if (c.moreIssues) paragraph(`${c.moreIssues} smaller issue${c.moreIssues === 1 ? '' : 's'} not shown.`, { size: 8, rgb: MUTED });
  }

  // ---- Example tickets -----------------------------------------------------------
  const withExamples = c.issues.filter((i) => i.examples.length);
  if (withExamples.length) {
    heading(`Example ${nouns.toLowerCase()}`);
    for (const issue of withExamples) {
      room(lineHeight(10.5) + lineHeight(9) * 2);
      paragraph(issue.name, { size: 10.5, style: 'bold', gap: 0.5 });
      paragraph(issue.summary, { size: 9, rgb: MUTED, gap: 0.5 });
      if (issue.combines) paragraph(`Combines: ${issue.combines.join(', ')}`, { size: 8, rgb: MUTED, gap: 0.5 });
      for (const t of issue.examples) {
        font(9, 'bold', BRAND); room(lineHeight(9)); doc.text(pdfSafe(t.key), M + 2, y + lineHeight(9) * 0.78);
        paragraph(`${t.summary}${t.status ? ` (${t.status})` : ''}`, { size: 9, x: M + 26, gap: 0.3 });
      }
      y += 3;
    }
  }

  // ---- Tickets per 100 crew ------------------------------------------------------
  if (c.crew) {
    heading('Tickets per 100 crew');
    paragraph(c.crew.summary, { size: 9, rgb: MUTED, gap: 2 });
    const cols = [{ label: 'Crew', x: 100 }, { label: nouns, x: 122 }, { label: 'Per 100 crew', x: 150 }, { label: 'Vs average', x: 172 }, { label: 'Previous', x: W - M }];
    const header = () => {
      font(8, 'bold', MUTED);
      doc.text(pdfSafe(c.crew.field), M, y + 4);
      cols.forEach((col) => doc.text(col.label, col.x, y + 4, { align: 'right' }));
      y += 6; doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 1;
    };
    header();
    onNewPage = header;
    for (const b of c.crew.bases) {
      room(lineHeight(9.5) + 1.5);
      const base = y + lineHeight(9.5) * 0.78;
      font(9.5, 'bold'); doc.text(split(b.value, 80)[0] || '', M, base);
      font(9.5, 'normal', MUTED); doc.text(pdfSafe(b.crew), cols[0].x, base, { align: 'right' });
      font(9.5, 'normal'); doc.text(pdfSafe(b.tickets), cols[1].x, base, { align: 'right' });
      font(9.5, 'bold'); doc.text(pdfSafe(b.rate), cols[2].x, base, { align: 'right' });
      const ratio = parseFloat(b.ratio);
      font(9.5, 'bold', ratio >= 1.5 ? MORE : ratio <= 0.5 ? FEWER : MUTED); doc.text(pdfSafe(b.ratio), cols[3].x, base, { align: 'right' });
      font(9, 'normal', MUTED); doc.text(pdfSafe(b.previous), cols[4].x, base, { align: 'right' });
      y += lineHeight(9.5) + 0.5;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M, y, W - M, y); y += 1;
    }
    onNewPage = null;
    y += 2;
    if (c.crew.more) paragraph(`${c.crew.more} more bases with lower rates are not shown.`, { size: 8, rgb: MUTED });
    for (const note of c.crew.notes) paragraph(note, { size: 8, rgb: MUTED });
  }

  // ---- Breakdowns ----------------------------------------------------------------
  for (const b of c.breakdowns) {
    heading(`By ${b.label}`);
    const header = () => {
      font(8, 'bold', MUTED);
      doc.text(pdfSafe(b.label), M, y + 4);
      doc.text(nouns, 120, y + 4, { align: 'right' });
      doc.text('Change', 140, y + 4, { align: 'right' });
      doc.text('Resolution', 146, y + 4);
      y += 6; doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 1;
    };
    header();
    onNewPage = header;
    for (const v of b.values) {
      font(9.5);
      const name = split(v.value, 84);
      const h = name.length * lineHeight(9.5) + 1.5;
      room(h);
      write(name, M, 9.5);
      const base = y + lineHeight(9.5) * 0.78;
      doc.text(pdfSafe(v.count), 120, base, { align: 'right' });
      font(9.5, 'bold', changeColour(v.change)); doc.text(pdfSafe(v.change), 140, base, { align: 'right' });
      font(8.5, 'normal', MUTED); doc.text(split(v.resolution, W - M - 146)[0] || '', 146, base);
      y += h;
    }
    onNewPage = null;
    if (b.estimated) paragraph('Estimated from the sample.', { size: 8, rgb: MUTED, gap: 0 });
    paragraph(b.withoutValue, { size: 8, rgb: MUTED });
  }

  // ---- When tickets arrive ---------------------------------------------------------
  if (c.timeOfDay) {
    const t = c.timeOfDay;
    heading(`When ${nouns.toLowerCase()} arrive`);
    paragraph(`Busiest hours ${t.busiestHours || '–'} · busiest day ${t.busiestDay} · ${t.outOfHours} outside 08:00–18:00 Mon–Fri. Times in ${t.timeZone}.`, { size: 9.5, gap: 3 });
    const labelW = 10;
    const cell = (CW - labelW) / 24;
    const cellH = 5;
    room(7 * cellH + 8);
    const max = Math.max(1, ...t.grid.flat());
    font(7, 'normal', MUTED);
    t.grid.forEach((row, d) => {
      doc.text(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d], M, y + d * cellH + 3.5);
      row.forEach((n, h) => {
        const share = n / max;
        doc.setFillColor(...WHITE.map((w, i) => Math.round(w + (BRAND[i] - w) * (n ? 0.12 + 0.88 * share : 0.04))));
        doc.rect(M + labelW + h * cell + 0.2, y + d * cellH + 0.2, cell - 0.4, cellH - 0.4, 'F');
      });
    });
    for (let h = 0; h < 24; h += 3) doc.text(String(h).padStart(2, '0'), M + labelW + h * cell + cell / 2, y + 7 * cellH + 3.5, { align: 'center' });
    y += 7 * cellH + 8;
  }

  // ---- Data quality ------------------------------------------------------------------
  if (c.dataQuality.length) {
    heading('Data quality');
    for (const d of c.dataQuality) paragraph(d.text, { size: 9.5, gap: 1.5 });
  }

  // ---- Footer on every page ------------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, H - 12, W - M, H - 12);
    font(7.5, 'normal', MUTED);
    doc.text(split(`${product}${version ? ` ${version}` : ''} · ${c.title} · ${c.period}`, CW - 30)[0] || '', M, H - 8);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}

/** Builds and downloads the PDF. Arguments are as for pdfContent, plus product and version. */
export async function exportPdf({ product, version, logos, ...args }) {
  await download(pdfContent(args), pdfFileName(args.report), { product, version, logos });
}

/** The customer portal's "Download PDF": the published report as customers see it. */
export async function exportPortalPdf(snapshot, { product, version, logos } = {}) {
  await download(portalPdfContent(snapshot), portalPdfFileName(snapshot), { product, version, logos });
}

async function download(content, fileName, options) {
  const { jsPDF } = await import('jspdf');
  const doc = buildPdf(jsPDF, content, options);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(doc.output('blob'));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
