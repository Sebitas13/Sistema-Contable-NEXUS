const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extractPUCTPages() {
    try {
        const data = new Uint8Array(fs.readFileSync('c:\\Users\\user\\Desktop\\Sistema Contable\\PUCT\\Manual del PUCT.pdf'));
        const pdf = await pdfjsLib.getDocument({ data }).promise;

        console.log('=== PUCT Manual - Pages 6-9 ===\n');

        for (let pageNum = 6; pageNum <= 9; pageNum++) {
            console.log(`\n========== PAGE ${pageNum} ==========`);
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Join text items with proper spacing
            const textItems = textContent.items.map(item => item.str);
            const pageText = textItems.join(' ');

            // Print in manageable chunks
            const lines = pageText.match(/.{1,100}/g) || [];
            lines.forEach(line => console.log(line));
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

extractPUCTPages();
