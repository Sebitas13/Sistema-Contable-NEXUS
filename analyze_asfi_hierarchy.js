const fs = require('fs');
const pdfParse = require('pdf-parse');

pdfParse(fs.readFileSync('Plan de Cuentas ASFI.pdf')).then(data => {
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log('=== ANÁLISIS JERÁRQUICO DEL PDF ASFI ===');

    // Buscar líneas que contienen códigos de cuenta
    const accountLines = lines.filter(line => {
        return /^\d{3}\.\d{2}/.test(line) && /[A-Z]/.test(line) && line.length > 10;
    });

    console.log(`Encontradas ${accountLines.length} líneas que parecen cuentas:`);

    // Mostrar ejemplos por nivel
    const byLevel = {};
    accountLines.forEach((line, i) => {
        const parts = line.split(/\s+/);
        const code = parts[0];
        const name = parts.slice(1).join(' ');

        if (code && /^\d{3}\.\d{2}/.test(code)) {
            const dotCount = (code.match(/\./g) || []).length;
            const level = dotCount + 1; // Nivel = número de puntos + 1

            if (!byLevel[level]) byLevel[level] = [];
            byLevel[level].push({ code, name: name.substring(0, 50) });
        }
    });

    // Mostrar ejemplos por nivel
    Object.keys(byLevel).sort((a, b) => parseInt(a) - parseInt(b)).forEach(level => {
        console.log(`\nNIVEL ${level}:`);
        byLevel[level].slice(0, 5).forEach(item => {
            console.log(`  ${item.code} -> ${item.name}...`);
        });
    });

    console.log('\n=== RESUMEN ===');
    Object.keys(byLevel).sort((a, b) => parseInt(a) - parseInt(b)).forEach(level => {
        console.log(`Nivel ${level}: ${byLevel[level].length} cuentas`);
    });

}).catch(err => {
    console.error('Error:', err);
});
