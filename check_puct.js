import XLSX from 'xlsx';
const wb = XLSX.readFile('../PUCT/puct.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

console.log('Análisis de filas PUCT (códigos esperados de 9 dígitos):');
for (let i = 1; i < 20; i++) { // Skip header
    const row = data[i];
    if (row && row.length >= 6) {
        const c = String(row[0] || '').trim();
        const g = String(row[1] || '').trim();
        const sg = String(row[2] || '').trim();
        const cp = String(row[3] || '').trim();
        const ca = String(row[4] || '').trim();
        const name = String(row[5] || '').trim();

        if (c || g || sg || cp || ca) {
            const expectedCode = (c + g + sg + cp.padStart(3, '0') + ca.padStart(3, '0')).replace(/0+$/, ''); // Remove trailing zeros for display
            console.log(`Fila ${i}: [${c},${g},${sg},${cp},${ca}] -> ${expectedCode || 'VACIO'} (${name.substring(0, 30)}...)`);
        }
    }
}
