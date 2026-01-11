
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extractText(pdfPath) {
    try {
        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const loadingTask = pdfjsLib.getDocument(data);
        const pdfDocument = await loadingTask.promise;
        let fullText = '';

        for (let i = 1; i <= pdfDocument.numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += `Page ${i}:\n${pageText}\n\n`;
        }

        console.log(fullText);
    } catch (error) {
        console.error('Error extracting text:', error);
    }
}

extractText('c:\\Users\\user\\Desktop\\Sistema Contable\\DataForge\\PROJECT .pdf');
