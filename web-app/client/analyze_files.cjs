
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const XLSX = require('xlsx');

async function analyzePDF(filePath) {
    console.log(`\n--- Analyzing PDF: ${filePath} ---`);
    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const pdf = await pdfjsLib.getDocument({ data }).promise;

        // Analyze page 6 specifically
        console.log(`\n[Page 6 Content]`);
        const page = await pdf.getPage(6);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');

        // Print text in chunks to avoid truncation
        const chunks = text.match(/.{1,200}/g) || [];
        chunks.slice(0, 5).forEach(chunk => console.log(chunk));
    } catch (err) {
        console.error('Error reading PDF:', err.message);
    }
}

function analyzeExcel(filePath) {
    console.log(`\n--- Analyzing Excel: ${filePath} ---`);
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        console.log(`Sheet: ${sheetName}`);
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        // Analyze Header
        const header = data[0];
        console.log('Header Row:', header.filter(c => c).join(' | '));

        // Find non-empty columns in row 10
        const row10 = data[9];
        const nonEmptyCols = row10.map((val, idx) => val ? `[${idx}] ${val}` : null).filter(v => v);
        console.log('Row 10 Data:', nonEmptyCols.join(' | '));

        // Find non-empty columns in row 11
        const row11 = data[10];
        const nonEmptyCols11 = row11.map((val, idx) => val ? `[${idx}] ${val}` : null).filter(v => v);
        console.log('Row 11 Data:', nonEmptyCols11.join(' | '));
    } catch (err) {
        console.error('Error reading Excel:', err.message);
    }
}

// Run analysis
(async () => {
    await analyzePDF('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\Manual del PUCT.pdf');
    analyzeExcel('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\puct.xlsx');
})();
