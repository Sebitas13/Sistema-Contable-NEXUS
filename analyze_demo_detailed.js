const XLSX = require('xlsx');
const wb = XLSX.readFile('./Plan de cuentas demo.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

console.log('=== ANÁLISIS DETALLADO: Plan de cuentas demo.xlsx ===');

// Analizar jerarquía
console.log('\nANÁLISIS DE JERARQUÍA:');
const accounts = data.slice(1).filter(row => {
    const code = String(row[0] || '').trim();
    const desc = String(row[1] || '').trim();
    return code && code.match(/^\d{3}-\d{2}-\d{2}$/) &&
           desc && !['CODIGO', 'DESCRIPCION', 'TIPO'].includes(desc.toUpperCase());
}).map(row => ({
    code: String(row[0]).trim(),
    name: String(row[1]).trim(),
    type: String(row[2]).trim()
}));

// Mostrar primeros 30 para entender la jerarquía
console.log('Primeros 30 registros jerárquicos:');
accounts.slice(0, 30).forEach((acc, i) => {
    const parts = acc.code.split('-');
    const level = parts.filter(p => parseInt(p) > 0).length;
    console.log(`${i+1}. ${acc.code} -> Nivel ${level} -> ${acc.name}`);
});

// Analizar patrones de grupos
console.log('\nANÁLISIS DE GRUPOS:');
const groups = {};
accounts.forEach(acc => {
    const firstDigit = acc.code.charAt(0);
    if (!groups[firstDigit]) {
        groups[firstDigit] = [];
    }
    groups[firstDigit].push(acc);
});

console.log('Grupos por primer dígito:');
Object.keys(groups).sort().forEach(group => {
    const sampleAccounts = groups[group].slice(0, 3);
    console.log(`Grupo ${group}: ${sampleAccounts.map(a => a.name).join(', ')}... (${groups[group].length} cuentas)`);
});

// Analizar tipos de cuenta
console.log('\nTIPOS DE CUENTA:');
const types = {};
accounts.forEach(acc => {
    const type = acc.type;
    if (!types[type]) {
        types[type] = 0;
    }
    types[type]++;
});

console.log('Distribución por tipo:');
Object.entries(types).forEach(([type, count]) => {
    console.log(`${type}: ${count} cuentas`);
});

console.log(`\nTotal de cuentas procesadas: ${accounts.length}`);
