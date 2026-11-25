// "Download Excel" for a Weekly SD report week: the workbook is built in the
// browser (src/weeklyExcel.js), so nothing leaves Atlassian. Weeks built with
// the Excel figures also get the ticket lists (open at the end of the week and
// created in it), read a page at a time through `loadRows(list, nextPageToken)`.
import { weeklyFileName, weeklyWorkbook } from '../../../src/weeklyExcel.js';
import { XLSX_TYPE } from '../../../src/xlsx.js';

const MAX_PAGES = 200;

async function readList(list, loadRows, onProgress) {
  const rows = [];
  let columns = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await loadRows(list, token);
    columns = result.columns;
    rows.push(...result.rows);
    onProgress?.(`${list === 'open' ? 'Open' : 'Created'} tickets: ${rows.length}…`);
    token = result.nextPageToken;
    if (!token) break;
  }
  return { columns, rows };
}

export async function downloadWeeklyExcel(record, { loadRows = null, onProgress = null } = {}) {
  const lists = loadRows && record.excel
    ? { open: await readList('open', loadRows, onProgress), created: await readList('created', loadRows, onProgress) }
    : null;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([weeklyWorkbook(record, lists)], { type: XLSX_TYPE }));
  link.download = weeklyFileName(record);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
