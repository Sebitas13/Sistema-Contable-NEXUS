/**
 * CanonicalDocument.js — Modelo neutral de documento para importación.
 *
 * Representa el resultado de extraer un archivo (Excel, PDF, CSV, OCR...)
 * SIN interpretar nada contable. El UniversalPlanAnalyzer consume esto
 * y jamás conoce el formato original.
 *
 * Invariantes de evidencia:
 * - rawValue: valor textual crudo ANTES de cualquier interpretación.
 * - formattedValue: valor como lo mostraría Excel (respeta formato de celda).
 * - cellType: 'n' número, 's' string, 'b' bool, 'f' fórmula, 'z' vacío (estilo SheetJS).
 * - coordinate: A1-style (Excel) o "page:x,y" (PDF) — la posición ES evidencia.
 * - merged: la celda real del valor en un rango fusionado (esquina superior izquierda).
 * - hidden: columna oculta según metadata !cols del sheet.
 */

/**
 * @typedef {Object} CanonicalCell
 * @property {string|null} rawValue        - Valor crudo (String(cell.v) o item.str del PDF)
 * @property {string|null} formattedValue  - Valor con formato de celda (cell.w de SheetJS)
 * @property {string|null} displayValue    - Mejor esfuerzo humano: formatted ?? raw
 * @property {string|null} formula         - cell.f si existe
 * @property {string|null} cellType        - 'n'|'s'|'b'|'f'|'z'|'ocr'
 * @property {number|null} numericValue    - cell.v numérico si aplica (PELIGRO: 001 puede llegar como 1)
 * @property {string}  coordinate         - 'A1' | 'B12' | 'page3:x284,y512'
 * @property {number}  row                 - índice 0-based
 * @property {number}  col                 - índice 0-based
 * @property {number|null} page            - página PDF (null en Excel)
 * @property {number|null} x                - posición X (PDF, px)
 * @property {number|null} y                - posición Y (PDF, px)
 * @property {number|null} width            - ancho (PDF)
 * @property {number|null} height           - alto (PDF)
 * @property {boolean} merged               - true si es esquina de rango fusionado
 * @property {string|null} mergedRange      - 'A1:C1' si aplica
 * @property {boolean} hidden               - columna oculta
 * @property {number}  extractionConfidence - 1.0 Excel nativo | 0.5-0.9 PDF texto | <0.5 OCR
 * @property {boolean} ocrUsed             - false en xlsx/pdfjs nativo
 * @property {number|null} ocrConfidence   - null salvo OCR
 * @property {string}  source              - 'xlsx'|'pdfjs'|'csv'|'ocr'
 */

/**
 * @typedef {Object} CanonicalRow
 * @property {number} rowIndex             - 0-based dentro del documento
 * @property {CanonicalCell[]} cells
 * @property {boolean} isEmpty             - todas las cells vacías
 */

/**
 * @typedef {Object} CanonicalTable
 * @property {string}  id                  - 'table-0', 'table-1'...
 * @property {number}  headerRowIndex      - fila del header detectado (o -1 si no hay)
 * @property {string[]} headers            - textos del header
 * @property {number}  dataStartRow
 * @property {number}  dataEndRow          - inclusivo
 * @property {number[]} titleRows          - filas de título/metadata detectadas arriba
 * @property {number|null} sheetIndex
 * @property {string|null} sheetName
 * @property {number|null} pageStart        - PDF
 * @property {number|null} pageEnd
 */

/**
 * @typedef {Object} CanonicalDocument
 * @property {{ format: 'xlsx'|'xls'|'pdf'|'csv'|'ocr'|'unknown',
 *              fileName: string, fileSize: number,
 *              sheetNames: string[]|null,
 *              capabilities: FormatCapabilities }} source
 * @property {CanonicalRow[]} rows          - TODAS las filas con evidencia (sin interpretar)
 * @property {CanonicalTable[]} tables     - regiones detectadas (multitabla)
 * @property {number} extractionConfidence  - mínimo de las celdas
 * @property {boolean} ocrUsed
 * @property {Object|null} warnings         - advertencias de extracción
 * @property {{ formulas: number, mergedCells: number, hiddenColumns: number,
 *              stubCells: number, numericCells: number }} stats
 */

/**
 * FormCapabilities — cada adapter declara qué evidencia conserva.
 * Nunca tratar PDF/OCR como si tuviera la misma evidencia que XLSX.
 */
export const FORMAT_CAPABILITIES = {
    xlsx: {
        rawValues: true, coordinates: true, sheets: true, mergedCells: true,
        formulas: true, formatting: true, tables: true,
        ocrUsage: false, extractionConfidence: 1.0,
        numericTypes: true, hiddenColumns: true, stubCells: true
    },
    pdf: {
        rawValues: true, coordinates: 'spatial', sheets: false, pages: true,
        mergedCells: false, formulas: false, formatting: false,
        tables: 'inferred', ocrUsage: 'optional', extractionConfidence: 0.7,
        numericTypes: false, hiddenColumns: false, stubCells: false
    },
    csv: {
        rawValues: true, coordinates: true, sheets: false, mergedCells: false,
        formulas: false, formatting: false, tables: true,
        ocrUsage: false, extractionConfidence: 0.9,
        numericTypes: false, hiddenColumns: false, stubCells: false
    },
    ocr: {
        rawValues: true, coordinates: 'spatial', sheets: false, pages: true,
        mergedCells: false, formulas: false, formatting: false,
        tables: 'inferred', ocrUsage: true, extractionConfidence: 0.5,
        numericTypes: false, hiddenColumns: false, stubCells: false
    }
};

/** Crea un CanonicalDocument vacío con defaults. */
export function createCanonicalDocument(format, fileName, fileSize = 0) {
    return {
        source: {
            format, fileName, fileSize,
            sheetNames: null,
            capabilities: FORMAT_CAPABILITIES[format] || FORMAT_CAPABILITIES.csv
        },
        rows: [],
        tables: [],
        extractionConfidence: 1.0,
        ocrUsed: false,
        warnings: null,
        stats: { formulas: 0, mergedCells: 0, hiddenColumns: 0, stubCells: 0, numericCells: 0 }
    };
}
