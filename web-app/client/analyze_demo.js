import XLSX from 'xlsx';
const wb = XLSX.readFile('../../Plan de cuentas demo.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

console.log('=== ANÁLISIS: Plan de cuentas demo.xlsx ===');
console.log('Hojas disponibles:', wb.SheetNames);
console.log('Total de filas:', data.length);
console.log('');

console.log('PRIMERAS 20 FILAS:');
data.slice(0, 20).forEach((row, i) => {
    console.log(`Fila ${i}: [${row.slice(0, 5).join(' | ')}]`);
});

console.log('');
console.log('ANÁLISIS DE PATRONES:');

// Analizar patrones de códigos
console.log('Análisis de códigos en columna 0:');
const codes = data.slice(1, 50).map(row => String(row[0] || '').trim()).filter(code => code && code.match(/^\d/));
codes.forEach((code, i) => {
    if (i < 20) { // Solo mostrar primeros 20
        console.log(`  ${code} (longitud: ${code.length})`);
    }
});

// Verificar si hay patrones similares al PUCT
console.log('');
console.log('VERIFICACIÓN DE PATRÓN PUCT:');
let puctLike = 0;
let otherPatterns = 0;

data.slice(1, 50).forEach(row => {
    const code = String(row[0] || '').trim();
    if (code && code.match(/^\d{9}$/)) {
        puctLike++;
    } else if (code && code.match(/^\d/)) {
        otherPatterns++;
        if (otherPatterns <= 10) {
            console.log(`  Patrón diferente: ${code} (longitud: ${code.length})`);
        }
    }
});

console.log(`Códigos tipo PUCT (9 dígitos): ${puctLike}`);
console.log(`Códigos con otros patrones: ${otherPatterns}`);
