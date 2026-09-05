/**
 * puctGuard.js — Exclusión dura de PUCT-multicolumna del wizard universal (U-9).
 *
 * Clasificador de FORMATO para enrutamiento (no analiza, no infiere niveles,
 * padres ni naturalezas). Si el archivo huele a plan multicolumna que la ruta
 * canónica no cubre (fusión sin cablear — hallazgo U-7), el wizard muestra el
 * panel de redirección al clásico y NO permite continuar.
 *
 * Señales (evidencia U-7):
 *  A (fuerte): cabecera 5-col PUCT (C,G,SG,CP,CA) en la grilla.
 *  B (fuerte): columna de códigos de 1 dígito con ≥50 filas y nombre adyacente
 *     (el canónico la deja en 2217 nodos `1`–`5` bloqueados).
 *  C (soporte, post-análisis): contrato con >100 nodos y ≤9 códigos únicos
 *     numéricos de 1 dígito (síntoma exacto del hallazgo U-7).
 *
 * PRINCIPIO DE DEFENSA EN PROFUNDIDAD: este guard es ayuda de enrutamiento,
 * NUNCA la última barrera. El verdadero límite de seguridad sigue siendo
 * Validator + canImport + simulation (un PUCT atípico que escape igual queda
 * bloqueado por los gates y jamás hace POST).
 *
 * Puro: sin React, sin DOM, sin red, sin I/O. Cero dependencias.
 */

const PUCT_HEADERS = ['C', 'G', 'SG', 'CP', 'CA'];
const MIN_SINGLE_DIGIT_ROWS = 50;
const MIN_NODES_SYMPTOM = 100;
const MAX_UNIQUE_SYMPTOM = 9;

function str(v) {
    return (v === undefined || v === null ? '' : String(v)).trim();
}

/** Grilla del CanonicalDocument → matriz de strings. */
export function gridFromDoc(doc) {
    if (!doc || !Array.isArray(doc.rows)) return [];
    return doc.rows.map(r => (r.cells || []).map(c => str(c.rawValue)));
}

function isPuctHeaderRow(cells) {
    if (!cells || cells.length < 5) return false;
    for (let i = 0; i < 5; i++) {
        if (cells[i].toUpperCase() !== PUCT_HEADERS[i]) return false;
    }
    return true;
}

/**
 * Evalúa señales A/B sobre el documento extraído.
 * @returns {{ excluded: boolean, reason: string|null, signal: string|null }}
 */
export function needsLegacyWizard(doc) {
    const grid = gridFromDoc(doc);
    if (grid.length === 0) {
        return { excluded: false, reason: null, signal: null };
    }
    // Señal A: cabecera 5-col PUCT en las primeras 10 filas.
    for (let i = 0; i < Math.min(10, grid.length); i++) {
        if (isPuctHeaderRow(grid[i])) {
            return {
                excluded: true,
                signal: 'puct-5col',
                reason: 'Plan multicolumna PUCT (columnas C,G,SG,CP,CA): requiere fusión que la ruta universal aún no cablea.'
            };
        }
    }
    // Señal B: columna de códigos de 1 dígito con ≥50 filas y nombre adyacente.
    // Columna candidata: primera con cabecera tipo código, si no col 0.
    let codeCol = 0;
    for (let i = 0; i < Math.min(10, grid.length); i++) {
        const row = grid[i];
        for (let c = 0; c < Math.min(6, row.length); c++) {
            if (/^c[oó]digo$/i.test(row[c])) { codeCol = c; break; }
        }
    }
    let singleDigitRows = 0;
    let withName = 0;
    let dataRows = 0;
    for (const row of grid) {
        const code = row[codeCol] || '';
        if (!/^\d/.test(code)) continue; // ignora títulos/encabezados
        dataRows++;
        if (/^[1-9]$/.test(code)) {
            singleDigitRows++;
            const name = row[codeCol + 1] || '';
            if (name.length > 1) withName++;
        }
    }
    if (dataRows >= MIN_SINGLE_DIGIT_ROWS && singleDigitRows >= MIN_SINGLE_DIGIT_ROWS && withName >= MIN_SINGLE_DIGIT_ROWS) {
        return {
            excluded: true,
            signal: 'single-digit-codes',
            reason: `Columna de códigos de 1 dígito con ${singleDigitRows} filas: la ruta universal no fusiona multicolumna y los dejaría bloqueados.`
        };
    }
    return { excluded: false, reason: null, signal: null };
}

/**
 * Señal C sobre contratos ya analizados (red de seguridad post-análisis).
 * @returns {{ excluded: boolean, reason: string|null, signal: string|null }}
 */
export function hasSingleDigitSymptom(contracts) {
    const list = Array.isArray(contracts) ? contracts : [];
    for (const c of list) {
        const nodes = (c && c.nodes) || [];
        if (nodes.length <= MIN_NODES_SYMPTOM) continue;
        const uniq = new Set(nodes.map(n => String(n.normalizedCode ?? n.code ?? '').trim()));
        if (uniq.size <= MAX_UNIQUE_SYMPTOM && [...uniq].every(u => /^[1-9]$/.test(u))) {
            return {
                excluded: true,
                signal: 'single-digit-contract',
                reason: `Contrato con ${nodes.length} nodos y solo ${uniq.size} códigos de 1 dígito: síntoma de multicolumna sin fusionar.`
            };
        }
    }
    return { excluded: false, reason: null, signal: null };
}
