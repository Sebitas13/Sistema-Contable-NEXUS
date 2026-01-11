const XLSX = require('xlsx');

function analyzeExcel(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        console.log('=== PUCT Excel Structure ===\n');

        // Show header
        console.log('Headers:');
        const headers = data[0] || [];
        headers.forEach((h, idx) => {
            if (h) console.log(`  Column ${idx} (${String.fromCharCode(65 + idx)}): ${h}`);
        });

        console.log('\nSample rows (10-12):');
        for (let i = 9; i < 12; i++) {
            const row = data[i] || [];
            console.log(`\nRow ${i + 1}:`);
            row.forEach((val, idx) => {
                if (val) console.log(`  Col ${idx} (${String.fromCharCode(65 + idx)}): ${val}`);
            });
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

analyzeExcel('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx');
