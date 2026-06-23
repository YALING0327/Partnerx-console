import xlsx from 'xlsx';

const wb = xlsx.readFile('./lzp 站内数据.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const internalData = xlsx.utils.sheet_to_json(sheet);

const internalTotal = internalData.reduce((sum, r) => sum + (Number(r['充值金额']) || 0), 0);
console.log('Excel sum:', internalTotal);
