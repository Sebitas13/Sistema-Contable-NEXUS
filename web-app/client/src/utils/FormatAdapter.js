/**
 * FormatAdapter.js — Capa de extracción por formato.
 *
 * REGLA DE ORO: cada adapter SOLO extrae y preserva evidencia.
 * Jamás interpreta estructura contable, jerarquía ni tipos.
 * El analyzer consume CanonicalDocument y no sabe de dónde vinieron los datos.
 *
 * Reutiliza las librerías ya instaladas en el cliente (xlsx, pdfjs-dist)
 * para no duplicar parsers. En shadow-mode se cargan de forma diferida
 * igual que hace el resto de la app.
 *
 * Protecciones de evidencia implementadas:
 * - Excel numérico: 001 llega como 1 vía cell.v → usamos cell.w (formatted)
 *   como rawValue textual cuando difiere, y reportamos numericCells para
 *   que el analyzer sepa que hubo coerción potencial de ceros iniciales.
 * - Merged cells: solo la esquina superior izquierda lleva el valor (real).
 * - Columnas ocultas: metadata !cols['hidden'] → cell.hidden, NO se eliminan.
 * - Stub cells: celdas vacías intermedias se conservan como tipo 'z'.
 * - PDF: posición X/Y como columna espacial, confidence < 1.0, sin fingir
 *   que un PDF tiene columnas de Excel.
 */

import { createCanonicalDocument, FORMAT_CAPABILITIES } from './CanonicalDocument.js';

// ─────────────────────────────────────────────────────────────
// Interface: { canHandle(file|name), extract(file) → CanonicalDocument }
// ─────────────────────────────────────────────────────────────

export class FormatAdapter {
    static canHandle() { return false; }
    static async extract() { throw new Error('Not implemented'); }
}

// ═════════════════════════════════════════════════════════════
// ExcelAdapter — xlsx/xls/xlsm vía SheetJS (lib ya usada por el wizard)
// ═════════════════════════════════════════════════════════════
export class ExcelAdapter extends FormatAdapter {
    static canHandle(name) {
        return /\.(xlsx|xls|xlsm)$/i.test(name || '');
    }

    /**
     * @param {File|ArrayBuffer|{workbook: Object, sheetName: string}} input
     *   Acepta File del input, ArrayBuffer, o un workbook ya leído por el
     *   flujo legacy (para no parsear dos veces en shadow mode).
     */
    static async extract(input) {
        const XLSX = await import('xlsx');
        let workbook, fileName, fileSize;

        if (input && input.workbook) {
            // Reuso del workbook que el wizard ya cargó (shadow mode, cero coste).
            workbook = input.workbook;
            fileName = input.fileName || 'workbook.xlsx';
            fileSize = input.fileSize || 0;
        } else if (input && input.file instanceof File) {
            // { file, sheetName } — usado por el E2E harness en navegador
            const buf = await input.file.arrayBuffer();
            workbook = XLSX.read(buf, { type: 'array', cellFormula: true, cellStyles: false, cellDates: false });
            fileName = input.file.name || 'archivo.xlsx';
            fileSize = input.file.size || 0;
        } else if (input instanceof File || input instanceof Blob) {
            const buf = await input.arrayBuffer();
            workbook = XLSX.read(buf, { type: 'array', cellFormula: true, cellStyles: false, cellDates: false });
            fileName = input.name || 'archivo.xlsx';
            fileSize = input.size || 0;
        } else if (input instanceof ArrayBuffer) {
            workbook = XLSX.read(input, { type: 'array', cellFormula: true });
            fileName = 'buffer.xlsx';
            fileSize = input.byteLength || 0;
        } else {
            throw new Error('ExcelAdapter: input no soportado');
        }

        const sheetNames = workbook.SheetNames || [];
        // Shadow mode: hoja puntual; normal: primera hoja (el multi-sheet UI lo maneja el wizard)
        const sheetName = (input && input.sheetName) || sheetNames[0];
        if (!sheetName || !workbook.Sheets[sheetName]) {
            throw new Error('ExcelAdapter: hoja no encontrada');
        }

        const doc = createCanonicalDocument('xlsx', fileName, fileSize);
        doc.source.sheetNames = sheetNames;

        this._fillFromSheet(doc, workbook, sheetName, sheetNames.indexOf(sheetName));
        return doc;
    }

    static _fillFromSheet(doc, workbook, sheetName, sheetIndex) {
        const XLSX = null; // no necesario: usamos address helpers abajo
        const ws = workbook.Sheets[sheetName];
        const ref = ws['!ref'];
        if (!ref) return;

        const range = this._decodeRange(ref);
        const merges = ws['!merges'] || [];
        const colsMeta = ws['!cols'] || [];

        // Mapa de merged: esquina → rango completo
        const mergeMap = new Map();
        for (const m of merges) {
            const key = `${m.s.r}:${m.s.c}`;
            mergeMap.set(key, this._encodeRange(m));
            doc.stats.mergedCells++;
        }

        // Columnas ocultas desde !cols
        const hiddenCols = new Set();
        colsMeta.forEach((c, i) => { if (c && c.hidden) hiddenCols.add(i); });
        doc.stats.hiddenColumns = hiddenCols.size;

        for (let r = range.s.r; r <= range.e.r; r++) {
            const cells = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
                const addr = this._encodeCell(r, c);
                const cell = ws[addr];

                if (!cell) {
                    // Stub cell: existe en el rango pero sin objeto (vacía real)
                    if (c < 60) doc.stats.stubCells++;
                    cells.push(this._emptyCell(r, c, addr, hiddenCols.has(c)));
                    continue;
                }

                const rawFromV = cell.v !== undefined && cell.v !== null ? String(cell.v) : null;
                const formatted = cell.w !== undefined ? String(cell.w) : null;
                // cellType SheetJS: n número, s string, b bool, e error, z stub
                const type = cell.t || 'z';

                // EVIDENCIA CRÍTICA — ceros iniciales:
                // Si la celda es numérica y su display (w) muestra "001" pero v es 1,
                // el valor textual REAL para contabilidad es "001" (formatted).
                // rawValue conserva lo que el usuario VIO en Excel.
                let rawValue = rawFromV;
                let leadingZeroCoerced = false;
                if (type === 'n' && formatted && rawFromV && formatted !== rawFromV) {
                    rawValue = formatted;
                    leadingZeroCoerced = /^0\d/.test(formatted);
                }
                if (type === 'n') doc.stats.numericCells++;

                const mergeKey = mergeMap.get(`${r}:${c}`);
                if (cell.f) doc.stats.formulas++;

                cells.push({
                    rawValue,
                    formattedValue: formatted,
                    displayValue: formatted ?? rawValue,
                    formula: cell.f || null,
                    cellType: type,
                    numericValue: type === 'n' ? cell.v : null,
                    leadingZeroCoerced,
                    coordinate: addr,
                    row: r, col: c, page: null, x: null, y: null,
                    width: null, height: null,
                    merged: mergeKey !== undefined,
                    mergedRange: mergeKey || null,
                    hidden: hiddenCols.has(c),
                    extractionConfidence: 1.0,
                    ocrUsed: false, ocrConfidence: null,
                    source: 'xlsx'
                });
            }
            doc.rows.push({
                rowIndex: r,
                cells,
                isEmpty: cells.every(c => c.rawValue === null || c.rawValue === '')
            });
        }
        doc.extractionConfidence = 1.0;
    }

    // Helpers estilo A1 sin depender de XLSX.utils (evita import circular en extract)
    static _emptyCell(r, c, addr, isHidden) {
        return {
            rawValue: null,
            formattedValue: null,
            displayValue: null,
            formula: null,
            cellType: 'z',
            numericValue: null,
            leadingZeroCoerced: false,
            coordinate: addr,
            row: r, col: c, page: null, x: null, y: null,
            width: null, height: null,
            merged: false, mergedRange: null,
            hidden: isHidden,
            extractionConfidence: 1.0,
            ocrUsed: false, ocrConfidence: null,
            source: 'xlsx'
        };
    }
    static _encodeCell(r, c) {
        let s = '';
        let cc = c + 1;
        while (cc > 0) { const m = (cc - 1) % 26; s = String.fromCharCode(65 + m) + s; cc = Math.floor((cc - 1 + 1) / 26); }
        return s + (r + 1);
    }
    static _decodeRange(ref) {
        const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
        if (!m) return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        return { s: { r: +m[2] - 1, c: this._colToIdx(m[1]) }, e: { r: +m[4] - 1, c: this._colToIdx(m[3]) } };
    }
    static _colToIdx(s) {
        let n = 0;
        for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
        return n - 1;
    }
    static _encodeRange(m) {
        return this._encodeCell(m.s.r, m.s.c) + ':' + this._encodeCell(m.e.r, m.e.c);
    }
}

// ═════════════════════════════════════════════════════════════
// PdfAdapter — pdfjs-dist (lib ya usada por el wizard)
// ═════════════════════════════════════════════════════════════
export class PdfAdapter extends FormatAdapter {
    static canHandle(name) {
        return /\.pdf$/i.test(name || '');
    }

    /**
     * @param {File|ArrayBuffer} input
     * @param {{startPage?: number, endPage?: number}} opts
     */
    static async extract(input, opts = {}) {
        const pdfjsMod = await import('pdfjs-dist');
        const pdfjsLib = pdfjsMod.default || pdfjsMod;
        // Worker de pdf.js resuelto por Vite (dev y build) — sin hardcodear CDN.
        // En navegador el módulo es ESM con GlobalWorkerOptions; en Node (tests)
        // se usa el build legacy sin worker.
        if (pdfjsLib && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            try {
                // Navegador: Vite resuelve el sufijo ?url a un asset servible.
                // Node (tests) no entra aquí (no hay `document`), así que el
                // import dinámico con ?url jamás se ejecuta fuera del bundle.
                if (typeof document !== 'undefined') {
                    // pdfjs-dist de este repo NO trae .mjs: el worker es el .js clásico.
                    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.js?url');
                    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
                }
            } catch { /* fallback: worker por defecto */ }
        }
        const buf = input instanceof File || input instanceof Blob
            ? await input.arrayBuffer()
            : input;
        const fileName = input && input.name ? input.name : 'documento.pdf';

        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const doc = createCanonicalDocument('pdf', fileName, (buf && buf.byteLength) || 0);

        const start = Math.max(1, opts.startPage || 1);
        const end = Math.min(pdf.numPages, opts.endPage || pdf.numPages);

        for (let p = start; p <= end; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            // Agrupa items por línea (Y similar) — igual criterio que el wizard,
            // pero conservando x/y/width de cada item como evidencia espacial.
            const lines = new Map();
            for (const item of content.items) {
                if (!item.str || !item.str.trim()) continue;
                const y = Math.round((item.transform ? item.transform[5] : (item.y || 0)) * 10) / 10;
                if (!lines.has(y)) lines.set(y, []);
                lines.get(y).push({
                    str: item.str,
                    x: item.transform ? item.transform[4] : (item.x || 0),
                    y,
                    width: item.width || null,
                    height: item.height || null,
                    hasEOL: item.hasEOL || false
                });
            }
            // Ordena líneas top→bottom y items left→right
            const sortedY = [...lines.keys()].sort((a, b) => b - a);
            sortedY.forEach((y, li) => {
                const items = lines.get(y).sort((a, b) => a.x - b.x);
                const cells = items.map((it, ci) => ({
                    rawValue: it.str,
                    formattedValue: null,
                    displayValue: it.str,
                    formula: null,
                    cellType: 's',
                    numericValue: null,
                    leadingZeroCoerced: false,
                    coordinate: `page${p}:x${Math.round(it.x)},y${Math.round(it.y)}`,
                    row: li, col: ci, page: p,
                    x: it.x, y: it.y, width: it.width, height: it.height,
                    merged: false, mergedRange: null, hidden: false,
                    extractionConfidence: 0.7,
                    ocrUsed: false, ocrConfidence: null,
                    source: 'pdfjs',
                    hasEOL: it.hasEOL
                }));
                doc.rows.push({
                    rowIndex: doc.rows.length,
                    cells,
                    isEmpty: cells.length === 0
                });
            });
        }

        doc.extractionConfidence = 0.7; // PDF texto nativo: bueno, pero no Excel
        if (doc.rows.length === 0) {
            doc.warnings = { extraction: 'PDF sin texto extraíble (¿escaneado? requiere OCR)' };
        }
        return doc;
    }
}

// ═════════════════════════════════════════════════════════════
// CsvAdapter — texto plano
// ═════════════════════════════════════════════════════════════
export class CsvAdapter extends FormatAdapter {
    static canHandle(name) {
        return /\.(csv|txt)$/i.test(name || '');
    }

    static async extract(input) {
        const text = input instanceof File || input instanceof Blob
            ? await input.text()
            : String(input);
        const fileName = input && input.name ? input.name : 'datos.csv';
        const doc = createCanonicalDocument('csv', fileName, text.length);

        const lines = text.split(/\r?\n/);
        lines.forEach((line, r) => {
            // CSV básico con comillas (sin dependencias nuevas)
            const cells = [];
            let field = '', inQuotes = false, col = 0;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { inQuotes = !inQuotes; continue; }
                if (ch === ',' && !inQuotes) {
                    cells.push(this._csvCell(field, r, col)); field = ''; col++;
                    continue;
                }
                field += ch;
            }
            cells.push(this._csvCell(field, r, col));
            doc.rows.push({ rowIndex: r, cells, isEmpty: cells.every(c => !c.rawValue) });
        });
        doc.extractionConfidence = 0.9;
        return doc;
    }

    static _csvCell(value, r, c) {
        const addr = this._ExcelAdapter_encodeCell(r, c);
        const isNum = value !== '' && /^-?\d+(\.\d+)?$/.test(value);
        return {
            rawValue: value === '' ? null : value,
            formattedValue: null,
            displayValue: value === '' ? null : value,
            formula: null,
            cellType: value === '' ? 'z' : (isNum ? 'n' : 's'),
            numericValue: isNum ? Number(value) : null,
            // CSV conserva texto tal cual: 001 llega como "001" (sin coerción)
            leadingZeroCoerced: false,
            coordinate: addr, row: r, col: c, page: null,
            x: null, y: null, width: null, height: null,
            merged: false, mergedRange: null, hidden: false,
            extractionConfidence: 0.9,
            ocrUsed: false, ocrConfidence: null,
            source: 'csv'
        };
    }
    static _ExcelAdapter_encodeCell(r, c) {
        let s = '', cc = c + 1;
        while (cc > 0) { const m = (cc - 1) % 26; s = String.fromCharCode(65 + m) + s; cc = Math.floor((cc - 1 + 1) / 26); }
        return s + (r + 1);
    }
}

// ═════════════════════════════════════════════════════════════
// Detector + registro
// ═════════════════════════════════════════════════════════════
export const ADAPTERS = [ExcelAdapter, PdfAdapter, CsvAdapter];

export function detectFormat(fileName) {
    for (const A of ADAPTERS) {
        if (A.canHandle(fileName)) return A;
    }
    return null;
}

/** Extrae a CanonicalDocument con el adapter adecuado. */
export async function extractDocument(input, opts = {}) {
    const name = opts.fileName || (input && input.name) || '';
    const adapter = detectFormat(name) || opts.adapter;
    if (!adapter) {
        throw new Error(`Formato no soportado: ${name}. Adapters: ${ADAPTERS.map(a => a.name).join(', ')}`);
    }
    return adapter.extract(input, opts);
}
