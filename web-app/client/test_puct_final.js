import XLSX from 'xlsx';
const wb = XLSX.readFile('../../PUCT/puct.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

// Simular processPUCTFormat
const processPUCTFormat = (data) => {
    if (!data || data.length < 2) return data;

    console.log('Procesando formato PUCT - asegurando códigos de 9 dígitos.');

    return data.filter(row => {
        // Skip header rows and empty rows
        const c = String(row[0] || '').trim();
        const g = String(row[1] || '').trim();
        const sg = String(row[2] || '').trim();
        const cp = String(row[3] || '').trim();

        // Must have at least a class (C) and be numeric
        return c && c.match(/^\d+$/) && !['C', 'G', 'SG', 'CP', 'CA'].includes(c.toUpperCase());
    }).map(row => {
        const c = String(row[0] || '').trim();
        const g = String(row[1] || '').trim();
        const sg = String(row[2] || '').trim();
        const cp = String(row[3] || '').trim();
        const ca = String(row[4] || '').trim();

        // Build 9-digit PUCT code with proper padding
        let code = '';
        if (c) code += c.padStart(1, '0'); // C: 1 digit
        if (g) code += g.padStart(1, '0'); // G: 1 digit
        if (sg) code += sg.padStart(1, '0'); // SG: 1 digit
        if (cp) code += cp.padStart(3, '0'); // CP: 3 digits
        if (ca) {
            code += ca.padStart(3, '0'); // CA: 3 digits
        } else if (cp) {
            // Parent account without CA - pad to 9 digits
            code += '000';
        }

        // Ensure exactly 9 digits, pad with zeros if shorter
        code = code.padEnd(9, '0');

        const newData = [code, ...row.slice(5)];
        return { data: newData, excelRow: row.excelRow || 0 };
    });
};

// Simular calculateLevel con configuración PUCT
const calculateLevel = (code) => {
    const c = String(code).trim();
    const structureConfig = {
        hasSeparator: false,
        levelCount: 5,
        levelLengths: [1, 2, 3, 6, 9]
    };

    // Special handling for PUCT format (9-digit codes)
    if (!structureConfig.hasSeparator && structureConfig.levelLengths.length === 5 &&
        structureConfig.levelLengths[4] === 9 && c.length === 9) {
        // For PUCT, calculate level based on significant digits (non-zero)
        const significantLength = c.replace(/0+$/, '').length;
        const levels = structureConfig.levelLengths;

        for (let i = 0; i < levels.length; i++) {
            if (i === 0 && significantLength <= levels[0]) return 1;
            if (i > 0 && significantLength > levels[i - 1] && significantLength <= levels[i]) return i + 1;
        }

        return levels.length; // Max level
    }

    // Fallback
    const len = c.length;
    const levels = structureConfig.levelLengths.slice(0, structureConfig.levelCount);

    for (let i = 0; i < levels.length; i++) {
        if (i === 0 && len <= levels[0]) return 1;
        if (i > 0 && len > levels[i - 1] && len <= levels[i]) return i + 1;
    }

    if (len > levels[levels.length - 1]) return levels.length + 1;
    return 1;
};

console.log('Datos originales del PUCT (primeras 10 filas):');
data.slice(0, 10).forEach((row, i) => {
    const code = [row[0], row[1], row[2], row[3], row[4]].join(' -> ');
    console.log(`Fila ${i}: [${code}] ${row[5]}`);
});

const processed = processPUCTFormat(data.slice(0, 20)); // Process first 20 rows

console.log('\nDatos procesados (primeras 10 filas válidas):');
processed.slice(0, 10).forEach((row, i) => {
    const code = row.data[0];
    const name = row.data[1] || '';
    const level = calculateLevel(code);
    console.log(`Fila ${i}: ${code} (Nivel ${level}) -> ${name.substring(0, 40)}...`);
});

console.log('\nEstadísticas:');
console.log(`Total filas procesadas: ${processed.length}`);
const codeLengths = processed.map(r => r.data[0].length);
const uniqueLengths = [...new Set(codeLengths)];
console.log(`Longitudes de código encontradas: ${uniqueLengths.join(', ')}`);
console.log(`Todos tienen 9 dígitos: ${codeLengths.every(l => l === 9)}`);
