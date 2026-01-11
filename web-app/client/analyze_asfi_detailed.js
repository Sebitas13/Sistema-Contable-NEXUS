const XLSX = require('xlsx');
const path = require('path');

// Detailed analysis of ASFI Excel file
async function analyzeASFIDetailed() {
    try {
        const filePath = path.resolve('C:\\Users\\user\\Desktop\\Sistema Contable\\DataForgeDocs\\Plan de Cuentas ASFI (1).xlsx');
        console.log('=== ANÁLISIS DETALLADO DEL ARCHIVO ASFI ===');
        console.log('File path:', filePath);

        const workbook = XLSX.readFile(filePath);
        console.log(`Total sheets: ${workbook.SheetNames.length}`);

        // Analyze first few sheets in detail
        const sheetsToAnalyze = workbook.SheetNames.slice(0, 5); // First 5 sheets

        sheetsToAnalyze.forEach((sheetName, index) => {
            console.log(`\n=== HOJA ${index + 1}: ${sheetName} ===`);

            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: true });

            console.log(`Total rows: ${data.length}`);

            // Analyze column structure for first 10 rows
            console.log('Column analysis (first 10 rows):');
            for (let rowIdx = 0; rowIdx < Math.min(10, data.length); rowIdx++) {
                const row = data[rowIdx];
                if (row && row.length > 0) {
                    const nonEmptyCells = row.filter(cell => cell !== null && cell !== undefined && cell !== '');
                    console.log(`  Row ${rowIdx + 1}: ${row.length} total cells, ${nonEmptyCells.length} non-empty`);
                    console.log(`    Data: [${row.map(cell => `"${String(cell || '').trim()}"`).join(', ')}]`);

                    // Show which columns have data
                    const columnData = [];
                    for (let colIdx = 0; colIdx < row.length; colIdx++) {
                        if (row[colIdx] !== null && row[colIdx] !== undefined && row[colIdx] !== '') {
                            columnData.push(`${String.fromCharCode(65 + colIdx)}: "${String(row[colIdx]).trim()}"`);
                        }
                    }
                    if (columnData.length > 0) {
                        console.log(`    Columns with data: ${columnData.join(', ')}`);
                    }
                }
            }

            // Analyze data patterns in the sheet
            console.log('\nData pattern analysis:');
            const nonEmptyRows = data.filter(row =>
                Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && cell !== '')
            );

            console.log(`Non-empty rows: ${nonEmptyRows.length}`);

            if (nonEmptyRows.length > 0) {
                // Check column consistency
                const columnCounts = nonEmptyRows.map(row => row.length);
                const maxColumns = Math.max(...columnCounts);
                const minColumns = Math.min(...columnCounts);

                console.log(`Column count range: ${minColumns} - ${maxColumns}`);

                // Check if data is in specific columns
                const columnUsage = {};
                nonEmptyRows.forEach(row => {
                    row.forEach((cell, colIdx) => {
                        if (cell !== null && cell !== undefined && cell !== '') {
                            columnUsage[colIdx] = (columnUsage[colIdx] || 0) + 1;
                        }
                    });
                });

                console.log('Column usage (column index: usage count):');
                Object.entries(columnUsage).forEach(([colIdx, count]) => {
                    console.log(`  Column ${colIdx} (${String.fromCharCode(65 + parseInt(colIdx))}): ${count} times`);
                });
            }
        });

        console.log('\n=== PATRONES IDENTIFICADOS ===');
        console.log('1. Cada hoja tiene una estructura diferente');
        console.log('2. Algunas hojas tienen datos en 2 columnas, otras en 3+');
        console.log('3. Los datos pueden empezar en diferentes filas');
        console.log('4. Las columnas usadas varían por hoja');

    } catch (error) {
        console.error('Error analyzing ASFI file:', error.message);
    }
}

analyzeASFIDetailed();
