// A small Excel (.xlsx) writer: sheets of rows with bold headings, numbers,
// percentages and column widths. No dependencies, so it runs in the browser
// and in tests. An .xlsx file is a zip of XML parts; this writes the zip
// uncompressed ("stored"), which every spreadsheet program reads.
//
// workbook([{ name, columns: [width…], rows: [[cell…]…], freeze, autoFilter, merges }]) → Uint8Array
// A cell is a string, a number, null (empty), or { v, style } with style
// 'bold' | 'title' | 'percent' | 'decimal' | 'wrap' | 'header' | 'datetime' |
// 'date' | 'boldPercent' | 'top' (top-aligned, beside wrapped text), and for a
// boxed table: 'boxLabel' | 'boxLabelBold' (shaded) | 'boxHeader' | 'box' |
// 'boxBold' | 'boxDecimal' | 'boxPercent' | 'boxGood' (green) | 'boxBad' (red).
// Percentages are given as numbers out of 100
// (42.5 → 42.5%); dates as Excel date numbers. `freeze`: rows kept in view at
// the top; `autoFilter`: a range such as 'A1:Z40'; `merges`: ranges such as 'A1:H1'.

const STYLES = { bold: 1, title: 2, percent: 3, decimal: 4, wrap: 5, header: 6, datetime: 7, date: 8, boldPercent: 9, top: 10,
  boxLabel: 11, boxLabelBold: 12, boxHeader: 13, box: 14, boxBold: 15, boxDecimal: 16, boxPercent: 17, boxGood: 18, boxBad: 19 };
const PERCENT = new Set(['percent', 'boldPercent', 'boxPercent', 'boxGood', 'boxBad']);
const encoder = new TextEncoder();

const escapeXml = (s) => String(s)
  // Characters XML 1.0 can't hold at all.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A column letter for a 0-based index: 0 → A, 26 → AA. */
export function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); }
  return name;
}

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique. */
export function sheetName(name, used = new Set()) {
  const base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n += 1) out = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  used.add(out.toLowerCase());
  return out;
}

function cellXml(cell, ref) {
  const { v, style } = cell !== null && typeof cell === 'object' ? cell : { v: cell };
  if (v === null || v === undefined || v === '') return style ? `<c r="${ref}" s="${STYLES[style] || 0}"/>` : '';
  const s = STYLES[style] ? ` s="${STYLES[style]}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${PERCENT.has(style) ? v / 100 : v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v).slice(0, 32767))}</t></is></c>`;
}

function sheetXml({ columns = [], rows = [], freeze = 0, autoFilter = '', merges = [] }) {
  const view = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const filter = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  const merged = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const cols = columns.length ? `<cols>${columns.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number(w) || 12}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((row, r) => `<row r="${r + 1}">${(row || []).map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${body}</sheetData>${filter}${merged}</worksheet>`;
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font>'
  + '<font><sz val="11"/><color rgb="FF00B050"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/></font></fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA9DB"/></bottom><diagonal/></border>'
  + '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="20">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>'
  // Boxed table (thin border all round): label (shaded), header, values, green/red changes.
  + '<xf numFmtId="0" fontId="0" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="3" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="164" fontId="4" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'
  + '</cellXfs></styleSheet>';

/** The workbook's parts: [path, xml]. */
export function workbookParts(sheets) {
  const used = new Set();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, used) }));
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
      + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets>'
      // Excel expects a filter's range as a hidden name too.
      + (named.some((s) => s.autoFilter) ? `<definedNames>${named.map((s, i) => (s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXml(s.name.replace(/'/g, "''"))}'!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '')).join('')}</definedNames>` : '')
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...named.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
}

// ---- Zip (stored, no compression) ----------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** A zip of [path, string | Uint8Array] entries, stored without compression. */
export function zip(entries, date = new Date()) {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  const files = entries.map(([path, content]) => {
    const name = encoder.encode(path);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    return { name, data, crc: crc32(data) };
  });
  const size = files.reduce((n, f) => n + 30 + f.name.length + f.data.length + 46 + f.name.length, 0) + 22;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
  const u32 = (v) => { view.setUint32(at, v, true); at += 4; };
  const bytes = (b) => { out.set(b, at); at += b.length; };
  const offsets = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034B50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(f.crc); u32(f.data.length); u32(f.data.length); u16(f.name.length); u16(0);
    bytes(f.name); bytes(f.data);
  }
  const central = at;
  files.forEach((f, i) => {
    u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(f.crc); u32(f.data.length); u32(f.data.length); u16(f.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
    bytes(f.name);
  });
  const centralSize = at - central;
  u32(0x06054B50); u16(0); u16(0); u16(files.length); u16(files.length); u32(centralSize); u32(central); u16(0);
  return out;
}

/** The .xlsx file's bytes. */
export function workbook(sheets, date = new Date()) {
  return zip(workbookParts(sheets), date);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
