const XLSX = require('xlsx');

function analyzeAllColumns() {
    try {
        const workbook = XLSX.readFile('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx');
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        console.log('=== PUCT Excel - All Columns Analysis ===\n');

        // Show ALL columns from header
        console.log('ALL Headers (showing index):');
        const headers = data[0] || [];
        for (let i = 0; i < headers.length; i++) {
            if (headers[i]) {
                console.log(`  [${i}] ${String.fromCharCode(65 + i)}: ${headers[i]}`);
            }
        }

        // Analyze first data rows (skip header)
        console.log('\nFirst Data Rows:');
        for (let rowIdx = 9; rowIdx < 12; rowIdx++) {
            console.log(`\nRow ${rowIdx + 1}:`);
            const row = data[rowIdx] || [];
            for (let colIdx = 0; colIdx < 10; colIdx++) {  // First 10 columns
                const val = row[colIdx];
                if (val !== undefined && val !== '' && val !== null) {
                    console.log(`  [${colIdx}] ${String.fromCharCode(65 + colIdx)}: ${val}`);
                }
            }
        }

        // Check if there are numeric code columns beyond E
        console.log('\nChecking columns 0-9 for numeric patterns:');
        for (let col = 0; col < 10; col++) {
            let isNumeric = true;
            let count = 0;
            for (let row = 9; row < 15; row++) {
                const val = data[row] ? data[row][col] : '';
                if (val) {
                    if (!String(val).match(/^\d+$/)) {
                        isNumeric = false;
                    }
                    count++;
                }
            }
            if (count > 0) {
                console.log(`  Col ${col} (${String.fromCharCode(65 + col)}): ${isNumeric ? 'NUMERIC' : 'NOT numeric'} (${count} values)`);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

analyzeAllColumns();
