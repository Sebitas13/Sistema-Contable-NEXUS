/**
 * Utilidades de exportación con CARGA DIFERIDA.
 *
 * jspdf, jspdf-autotable y xlsx son librerías pesadas (~1 MB combinadas). Antes
 * se importaban estáticamente y viajaban en el chunk principal de la app,
 * penalizando la carga inicial aunque el usuario nunca exportara nada. Ahora se
 * descargan bajo demanda (dinámicamente) la primera vez que se usa una función
 * de exportación/importación.
 */

let pdfLibsPromise = null;
const loadPdfLibs = () => {
    if (!pdfLibsPromise) {
        pdfLibsPromise = Promise.all([
            import('jspdf'),
            import('jspdf-autotable')
        ]);
    }
    return pdfLibsPromise;
};

let xlsxPromise = null;
const loadXlsx = () => {
    if (!xlsxPromise) xlsxPromise = import('xlsx');
    return xlsxPromise;
};

// Helper to generate PDF instance without saving
export const generatePDFDoc = async (data, columns, title, options = {}) => {
    const [{ default: jsPDF }, { autoTable }] = await loadPdfLibs();

    const orientation = options.orientation || 'portrait';
    const doc = new jsPDF({ orientation });

    doc.setFontSize(16);
    doc.text(title, 14, 15);

    doc.setFontSize(10);
    if (!options.hideDefaultDate) {
        doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 25);
    }
    if (options.subtitle) {
        doc.text(options.subtitle, 14, 30);
    }

    let startY = options.subtitle ? 35 : 30;

    if (data.isGrouped) {
        data.groups.forEach((group, index) => {
            if (index > 0 && startY > doc.internal.pageSize.height - 40) {
                doc.addPage();
                startY = 20;
            }

            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text(group.title, 14, startY);
            startY += 5;
            doc.setFont(undefined, 'normal');

            const tableData = group.data.map(row =>
                columns.map(col => {
                    const val = row[col.field];
                    return val !== null && val !== undefined ? val : '';
                })
            );

            autoTable(doc, {
                head: [columns.map(col => col.header)],
                body: tableData,
                startY: startY,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [41, 128, 185] },
                margin: { top: 20 },
                theme: 'grid'
            });

            startY = doc.lastAutoTable.finalY + 10;
        });
    } else {
        const tableData = data.map(row =>
            columns.map(col => {
                const val = row[col.field];
                return val !== null && val !== undefined ? val : '';
            })
        );

        autoTable(doc, {
            head: [columns.map(col => col.header)],
            body: tableData,
            startY: startY,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [41, 128, 185] },
            didParseCell: (data) => {
                if (options.cellStyleCallback) {
                    options.cellStyleCallback(data);
                }
            }
        });
    }

    return doc;
};

export const exportToPDF = async (data, columns, title, options = {}) => {
    const doc = await generatePDFDoc(data, columns, title, options);
    const fileName = options.fileName || title.replace(/\s+/g, '_');
    doc.save(`${fileName}.pdf`);
};

// Helper for Excel generation
export const generateExcelWorkbook = async (data, sheetName) => {
    const XLSX = await loadXlsx();
    let finalData = data;
    if (data.isGrouped) {
        finalData = [];
        data.groups.forEach(g => {
            g.data.forEach(row => {
                finalData.push({
                    'Cuenta': g.title,
                    ...row
                });
            });
        });
    }
    const ws = XLSX.utils.json_to_sheet(finalData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
};

export const exportToExcel = async (data, sheetName, filename) => {
    const [wb, XLSX] = await Promise.all([generateExcelWorkbook(data, sheetName), loadXlsx()]);
    XLSX.writeFile(wb, `${filename}.xlsx`);
};

export const importFromExcel = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const XLSX = await loadXlsx();
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                resolve(jsonData);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsArrayBuffer(file);
    });
};
