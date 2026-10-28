// "Download Excel" for a Weekly SD report week: the workbook is built in the
// browser (src/weeklyExcel.js), so nothing leaves Atlassian.
import { weeklyFileName, weeklyWorkbook } from '../../../src/weeklyExcel.js';
import { XLSX_TYPE } from '../../../src/xlsx.js';

export function downloadWeeklyExcel(record) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([weeklyWorkbook(record)], { type: XLSX_TYPE }));
  link.download = weeklyFileName(record);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
