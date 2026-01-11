const xlsx = require('xlsx');
const path = require('path');

function dump(file) {
  console.log('\n--- RAW DUMP for', file, '---');
  const wb = xlsx.readFile(file);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(12, data.length); i++) {
    console.log(i, JSON.stringify(data[i]));
  }
}

const files = [
  'C:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx',
  'C:\\Users\\user\\Desktop\\Sistema Contable\\DataForgeDocs\\Plan de Cuentas ASFI (1).xlsx'
];
files.push('C:\\Users\\user\\Desktop\\Sistema Contable\\Plan de cuentas demo.xlsx');

for (const f of files) {
  try { dump(f); } catch (e) { console.error('ERR', f, e.message); }
}
