const XLSX = require('xlsx');

// Simulate the detectAndMergeColumns logic
function testPUCTDetection() {
    const workbook = XLSX.readFile('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Simulate sliced data (starting from row 10)
    const data = [];
    for (let i = 9; i < 12; i++) {
        const row = jsonData[i] || [];
        data.push({ excelRow: i + 1, data: row });
    }

    console.log('=== Testing PUCT Detection ===\n');
    console.log('Sample rows before merging:');
    data.forEach(row => {
        console.log(`Row ${row.excelRow}: [${row.data.slice(0, 10).join(' | ')}]`);
    });

    // Check column detection
    let potentialCols = 0;
    for (let col = 0; col < 6; col++) {
        let isCodePart = true;
        let numericCount = 0;

        for (const row of data) {
            const val = row.data[col];
            if (val === undefined || val === '' || val === null) continue;
            const str = String(val).trim();

            if (str.length > 4 || !str.match(/^\d+$/)) {
                isCodePart = false;
                break;
            }
            numericCount++;
        }

        if (isCodePart && numericCount > 0) {
            potentialCols++;
            console.log(`\nColumn ${col}: DETECTED as code part (${numericCount} numeric values)`);
        } else {
            console.log(`\nColumn ${col}: NOT a code part`);
            if (col === 0) {
                console.log('ERROR: First column must be part of code!');
                return;
            }
            break;
        }
    }

    console.log(`\n=== Detected ${potentialCols} code columns ===\n`);

    // Simulate merging
    console.log('After merging:');
    data.forEach(row => {
        const codeParts = [];
        for (let i = 0; i < potentialCols; i++) {
            const val = row.data[i];
            const str = (val !== undefined && val !== '' && val !== null) ? String(val).trim() : '';

            if (i < 3) {
                codeParts.push(str || '0');
            } else {
                codeParts.push(str ? str.padStart(3, '0') : '000');
            }
        }
        const code = codeParts.join('');
        const name = row.data[potentialCols] || '';
        console.log(`Row ${row.excelRow}: Code="${code}" (${code.length} digits), Name="${name}"`);
    });
}

testPUCTDetection();
