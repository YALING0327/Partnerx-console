import xlsx from 'xlsx';

const file = '数据对比修正/用户列表 (21).xlsx';
const workbook = xlsx.readFile(file);
for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
  console.log(`\n[sheet:${sheetName}] rows=${rows.length}`);
  console.log(JSON.stringify(rows.slice(0, 20), null, 2));
}
