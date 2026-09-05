/**
 * ShadowComparator.js — Comparación shadow legacy vs universal (U-7).
 *
 * Utilidad de TEST/COMPARACIÓN (suites Node + harness E2E). NUNCA importada
 * por código de aplicación: solo reporta divergencias, no decide importaciones.
 *
 * Dos piezas puras:
 *  1. buildLegacyPreview(kind, tuples) — réplica documentada de la MECÁNICA
 *     del wizard legacy (filtros + configs + AccountPlanProfile niveles/padres).
 *     NO replica determineType (heurística de keywords embebida en el
 *     componente, no reutilizable): legacy.type = null y el campo `type`
 *     queda FUERA del veredicto (se confirma por el usuario en la UI;
 *     ver INTENTIONAL_CHANGE).
 *  2. classify(legacyRows, contract, opts) — veredictos por hallazgo:
 *     SAME | IMPROVEMENT | INTENTIONAL_CHANGE | REGRESSION | UNKNOWN.
 *
 * Reglas de clasificación (objetivas, sin adivinar culpables):
 *  - only_in_universal con rawCode trazable a fuente → IMPROVEMENT
 *    (el legacy descartaba filas reales); sin traza → UNKNOWN.
 *  - only_in_legacy → REGRESSION (el legacy importaba una fila que el
 *    universal pierde; se investiga, no se oculta).
 *  - parent: universal con padre en-set + legacy sin padre/dangling →
 *    IMPROVEMENT; universal sin padre/dangling + legacy en-set → REGRESSION;
 *    universal RAÍZ (L1, sin padre por definición) + legacy con padre
 *    fantasma (no coincide con ninguna fila) → IMPROVEMENT (el legacy
 *    inventaba un padre con separador colgante; el universal declara raíz);
 *    universal null + legacy con referencia MALFORMADA (termina en separador
 *    y no coincide con ninguna fila de ningún lado) → IMPROVEMENT (el legacy
 *    emitía un string que no es un código; el universal declara ausencia);
 *    resto de combinaciones con padres distintos → UNKNOWN.
 *  - level: sigue el veredicto del padre (consecuencia) si discrepa el padre;
 *    si el padre coincide y el nivel difiere → UNKNOWN.
 *  - name: cualquier diferencia → UNKNOWN (misma celda fuente).
 *  - type: no participa del veredicto (ver arriba).
 *  - allowlist: [{file, code='*', field='*', reason}] revisada por humano
 *    reclasifica a INTENTIONAL_CHANGE con cita. Empieza VACÍA.
 * Veredicto global: REGRESSION si hay ≥1 regression; si no, UNKNOWN si hay
 * ≥1 unknown; si no, PASS. UNKNOWN falla en cerrado (exige triage humano).
 */

import { AccountPlanProfile } from './AccountPlanProfile.js';

export const VERDICTS = ['SAME', 'IMPROVEMENT', 'INTENTIONAL_CHANGE', 'REGRESSION', 'UNKNOWN'];

// Configs EXACTAS que el wizard legacy dejaba en structureConfig por formato
// (SmartImportWizard.jsx: processPUCTFormat / processDashFormat / default).
export const LEGACY_CONFIGS = {
    puct: { hasSeparator: false, separator: '', smartZeroCheck: false, useCustomLengths: false, levelCount: 5, levelLengths: [1, 2, 3, 6, 9] },
    dash: { hasSeparator: true, separator: '-', smartZeroCheck: false, useCustomLengths: false, levelCount: 3, levelLengths: [3, 5, 7] },
    generic: null // getDefaultProfile() en el momento de comparar (idéntico al legacy)
};

export const DIFFERENTIAL_CORPUS = [
    { key: 'PUCT5C', file: 'PUCT/puct.xlsx', sheet: 'PUCT', kind: 'puct' },
    { key: 'DASH', file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja2', kind: 'dash' },
    { key: 'ASFI', file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Plan de cuentas ASFI', kind: 'generic' },
    { key: 'VARLEN', file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja5', kind: 'generic' }
];

/** Objetos (sheet_to_json) → grilla de strings. Primera fila = claves. */
export function gridFromRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const keys = Object.keys(records[0]);
    const grid = [keys.slice()];
    for (const r of records) {
        grid.push(keys.map(k => {
            const v = r[k];
            return v === undefined || v === null ? '' : String(v);
        }));
    }
    return grid;
}

function cellOf(row, i) {
    const v = row && i < row.length ? row[i] : '';
    return (v === undefined || v === null ? '' : String(v)).trim();
}

/**
 * Grilla → tuplas normalizadas por kind + conteo de filas de título saltadas.
 * puct: [c,g,sg,cp,ca,name] · dash/generic: [code,name].
 */
export function tuplesFromGrid(grid, kind) {
    if (!Array.isArray(grid) || grid.length === 0) return { kind, tuples: [], droppedTitles: 0, headerRow: -1 };
    let headerRow = -1;
    for (let i = 0; i < grid.length; i++) {
        const c0 = cellOf(grid[i], 0).toUpperCase();
        if (/^(C[OÓ]DIGO|C)$/.test(c0)) { headerRow = i; break; }
    }
    let start = 0;
    if (headerRow >= 0) {
        start = headerRow + 1;
    } else {
        for (let i = 0; i < grid.length; i++) {
            if (/^\d/.test(cellOf(grid[i], 0))) { start = i; break; }
        }
    }
    const tuples = [];
    for (let i = start; i < grid.length; i++) {
        const row = grid[i];
        if (kind === 'puct') {
            tuples.push([cellOf(row, 0), cellOf(row, 1), cellOf(row, 2), cellOf(row, 3), cellOf(row, 4), cellOf(row, 5)]);
        } else {
            tuples.push([cellOf(row, 0), cellOf(row, 1)]);
        }
    }
    return { kind, tuples, droppedTitles: start, headerRow };
}

function pad9(c, g, sg, cp, ca) {
    let code = '';
    code += (c || '0').padStart(1, '0');
    code += (g || '0').padStart(1, '0');
    code += (sg || '0').padStart(1, '0');
    code += (cp || '000').padStart(3, '0');
    code += (ca || '000').padStart(3, '0');
    return code.padEnd(9, '0').substring(0, 9);
}

const HEADER_5 = ['C', 'G', 'SG', 'CP', 'CA'];
const HEADER_3 = ['CODIGO', 'DESCRIPCION', 'TIPO'];
const isHeaderWord5 = (s) => HEADER_5.includes(String(s || '').toUpperCase());
const isHeaderWord3 = (s) => HEADER_3.includes(String(s || '').toUpperCase());
const isNumericCell = (s) => /^\d+N?$/i.test(String(s || '').trim());
const isDashCode = (s) => /^\d{3}-\d{2}-\d{2}$/.test(String(s || '').trim());

/**
 * Réplica de detectAndMergeColumns: decide puct|dash|generic sobre las tuplas.
 * Usa las primeras 15 filas y las primeras 10 columnas, igual que el wizard.
 */
export function detectLegacyKind(tuples) {
    const sample = (tuples || []).slice(0, 15);
    let maxNumericCols = 0;
    let isPUCTFormat = false;
    let isDashFormat = false;
    for (const row of sample) {
        const cells = (row || []).slice(0, 10).map(c => String(c ?? '').trim());
        let numericCols = 0;
        let hasHeaderPattern = false;
        let hasDashCode = false;
        for (let i = 0; i < cells.length; i++) {
            const str = cells[i];
            if (isDashCode(str)) hasDashCode = true;
            if (str && isNumericCell(str)) numericCols++;
            if (i < 5 && isHeaderWord5(str)) hasHeaderPattern = true;
            if (i < 3 && isHeaderWord3(str)) hasHeaderPattern = true;
        }
        if (hasHeaderPattern) continue;
        maxNumericCols = Math.max(maxNumericCols, numericCols);
        if (hasDashCode) isDashFormat = true;
        if (numericCols === 5) {
            const [c, g, sg, cp] = cells;
            if (cp && c && g && sg) isPUCTFormat = true;
        }
        if (!isPUCTFormat) {
            for (let i = 0; i < Math.min(5, cells.length); i++) {
                if (/^[1-9]$/.test(cells[i])) { isPUCTFormat = true; break; }
            }
        }
    }
    if (isPUCTFormat) return { kind: 'puct', maxNumericCols };
    if (isDashFormat) return { kind: 'dash', maxNumericCols };
    return { kind: 'generic', maxNumericCols };
}

/** Config genérica legacy: adivinada (i+1)*2 si ≥2 cols numéricas, si no default. */
function genericConfig(maxNumericCols) {
    if (maxNumericCols >= 2) {
        const n = Math.min(maxNumericCols, 5);
        return {
            hasSeparator: false, separator: '', smartZeroCheck: false,
            useCustomLengths: false, levelCount: n,
            levelLengths: Array.from({ length: n }, (_, i) => (i + 1) * 2)
        };
    }
    return AccountPlanProfile.getDefaultProfile();
}

/**
 * Réplica de la mecánica legacy. Devuelve { rows, dropped, config }.
 * rows: [{ code, name, type: null, level, parent_code }].
 */
export function buildLegacyPreview(kind, tuples) {
    const rows = [];
    let dropped = 0;
    if (kind === 'puct') {
        const config = { ...LEGACY_CONFIGS.puct };
        const firstCode = tuples.length > 0 ? String(tuples[0][0] || '').trim() : '';
        const singleDigit = /^[1-9]$/.test(firstCode);
        for (const t of tuples) {
            let c, g, sg, cp, ca, name;
            if (singleDigit) {
                c = String(t[0] || '').trim(); g = '0'; sg = '0'; cp = '000'; ca = '000';
                name = String(t[1] || '').trim();
            } else {
                c = String(t[0] || '').trim(); g = String(t[1] || '').trim();
                sg = String(t[2] || '').trim(); cp = String(t[3] || '').trim();
                ca = String(t[4] || '').trim(); name = String(t[5] || '').trim();
            }
            const isHeaderRow = ['C', 'G', 'SG', 'CP', 'CA'].includes(c.toUpperCase()) ||
                ['C', 'G', 'SG', 'CP', 'CA'].includes(g.toUpperCase());
            const hasNumericData = /^\d+$/.test(c) || /^\d+$/.test(g);
            if (isHeaderRow || !hasNumericData || name.length === 0) { dropped++; continue; }
            const code = pad9(c, g, sg, cp, ca);
            rows.push({
                code, name, type: null,
                level: AccountPlanProfile.calculateLevel(code, config),
                parent_code: AccountPlanProfile.calculateParent(code, config)
            });
        }
        return { rows, dropped, config };
    }
    if (kind === 'dash') {
        const config = { ...LEGACY_CONFIGS.dash };
        for (const t of tuples) {
            const code = String(t[0] || '').trim();
            const desc = String(t[1] || '').trim();
            if (!code || !/^\d{3}-\d{2}-\d{2}$/.test(code) || !desc ||
                ['CODIGO', 'DESCRIPCION', 'TIPO'].includes(desc.toUpperCase())) { dropped++; continue; }
            rows.push({
                code, name: desc, type: null,
                level: AccountPlanProfile.calculateLevel(code, config),
                parent_code: AccountPlanProfile.calculateParent(code, config)
            });
        }
        return { rows, dropped, config };
    }
    // generic: filtro de generatePreview + config del wizard (adivinada o default)
    const { maxNumericCols } = detectLegacyKind(tuples);
    const config = genericConfig(maxNumericCols);
    for (const t of tuples) {
        const code = String(t[0] || '').trim();
        const name = String(t[1] || '').trim();
        if (!code || !/^\d/.test(code) || name.length === 0) { dropped++; continue; }
        rows.push({
            code, name, type: null,
            level: AccountPlanProfile.calculateLevel(code, config),
            parent_code: AccountPlanProfile.calculateParent(code, config)
        });
    }
    return { rows, dropped, config };
}

function matchAllow(entry, file, code, field) {
    if (!entry || entry.file !== file) return false;
    const codeOk = !entry.code || entry.code === '*' || entry.code === code;
    const fieldOk = !entry.field || entry.field === '*' || entry.field === field;
    return codeOk && fieldOk;
}

/**
 * Clasifica legacyRows vs contract.
 * @param {Array} legacyRows [{code,name,level,parent_code}]
 * @param {object} contract ImportContract (nodes con normalizedCode/rawCode/...)
 * @param {object} opts { file, sourceCodes: Set<string> (raw col0), allowlist: [] }
 */
export function classify(legacyRows, contract, opts = {}) {
    const { file = '?', sourceCodes = null, allowlist = [] } = opts;
    if (!sourceCodes) throw new TypeError('ShadowComparator.classify requiere sourceCodes (evidencia de fuente)');
    const nodes = (contract && contract.nodes) || [];
    const legacyByCode = new Map();
    for (const r of legacyRows || []) {
        const k = String(r.code || '').trim();
        if (k && !legacyByCode.has(k)) legacyByCode.set(k, r);
    }
    const uniByCode = new Map();
    const uniRawByCode = new Map();
    for (const n of nodes) {
        const k = String(n.normalizedCode || '').trim();
        if (k && !uniByCode.has(k)) {
            uniByCode.set(k, n);
            uniRawByCode.set(k, String(n.rawCode ?? '').trim());
        }
    }
    const items = [];
    const push = (code, field, legacy, universal, verdict, reason) => {
        let finalVerdict = verdict;
        let finalReason = reason;
        for (const entry of allowlist) {
            if (matchAllow(entry, file, code, field)) {
                finalVerdict = 'INTENTIONAL_CHANGE';
                finalReason = `${reason} [allowlist: ${entry.reason}]`;
                break;
            }
        }
        items.push({ file, code, field, legacy, universal, verdict: finalVerdict, reason: finalReason });
    };

    // Membresía
    for (const [code, n] of uniByCode) {
        if (!legacyByCode.has(code)) {
            if (sourceCodes.has(uniRawByCode.get(code))) {
                push(code, 'membership', '∅ (legacy la descartó)', code, 'IMPROVEMENT', 'fila real que el legacy descartaba en silencio');
            } else {
                push(code, 'membership', '∅ (legacy la descartó)', code, 'UNKNOWN', 'fila universal sin traza a fuente: revisar');
            }
        }
    }
    for (const [code] of legacyByCode) {
        if (!uniByCode.has(code)) {
            push(code, 'membership', code, '∅ (universal la pierde)', 'REGRESSION', 'fila que el legacy importaba y el universal pierde');
        }
    }

    // Campos por código común
    for (const [code, l] of legacyByCode) {
        const u = uniByCode.get(code);
        if (!u) continue;
        const lName = String(l.name || '').trim();
        const uName = String(u.name || '').trim();
        if (lName !== uName) {
            push(code, 'name', lName.slice(0, 60), uName.slice(0, 60), 'UNKNOWN', 'mismo código, distinto nombre (misma celda fuente)');
        }
        const lPar = l.parent_code === undefined || l.parent_code === null || l.parent_code === '' ? null : String(l.parent_code);
        const uPar = u.parent === undefined || u.parent === null || u.parent === '' ? null : String(u.parent);
        let parentVerdict = 'SAME';
        if (lPar !== uPar) {
            const uIn = uPar !== null && uniByCode.has(uPar);
            const lIn = lPar !== null && legacyByCode.has(lPar);
            const uIsRoot = Number(u.level) === 1;
            const lMalformed = lPar !== null && !lIn && /[.\-/]$/.test(lPar) &&
                ![...uniByCode.keys()].includes(lPar);
            if (uPar !== null && uIn && (lPar === null || !lIn)) {
                parentVerdict = 'IMPROVEMENT';
            } else if (uPar === null && uIsRoot && lPar !== null && !lIn) {
                parentVerdict = 'IMPROVEMENT';
            } else if (uPar === null && lMalformed) {
                parentVerdict = 'IMPROVEMENT';
            } else if ((uPar === null || !uIn) && lPar !== null && lIn) {
                parentVerdict = 'REGRESSION';
            } else {
                parentVerdict = 'UNKNOWN';
            }
            push(code, 'parent', lPar, uPar, parentVerdict,
                parentVerdict === 'IMPROVEMENT'
                    ? (uPar === null
                        ? 'legacy emitía referencia malformada/fantasma; universal declara ausencia o raíz'
                        : 'padre dangling/ausente en legacy, resuelto en universal')
                : parentVerdict === 'REGRESSION' ? 'padre válido en legacy, perdido en universal'
                : 'padres distintos, ambos (in)válidos: requiere ojo humano');
        }
        if (Number(l.level) !== Number(u.level)) {
            if (parentVerdict === 'IMPROVEMENT') {
                push(code, 'level', l.level, u.level, 'IMPROVEMENT', 'nivel consecuencia del padre corregido');
            } else if (parentVerdict === 'REGRESSION') {
                push(code, 'level', l.level, u.level, 'REGRESSION', 'nivel consecuencia del padre perdido');
            } else {
                push(code, 'level', l.level, u.level, 'UNKNOWN', 'mismo padre, distinto nivel: requiere ojo humano');
            }
        } else if (parentVerdict === 'SAME' && lName === uName) {
            push(code, 'all', null, null, 'SAME', 'idéntico');
        }
    }

    const counts = { SAME: 0, IMPROVEMENT: 0, INTENTIONAL_CHANGE: 0, REGRESSION: 0, UNKNOWN: 0 };
    for (const it of items) counts[it.verdict] = (counts[it.verdict] || 0) + 1;
    const verdict = counts.REGRESSION > 0 ? 'REGRESSION' : (counts.UNKNOWN > 0 ? 'UNKNOWN' : 'PASS');
    return {
        verdict,
        counts,
        items,
        summary: {
            file,
            legacyCount: legacyByCode.size,
            universalCount: uniByCode.size,
            matched: [...legacyByCode.keys()].filter(k => uniByCode.has(k)).length,
            ...counts
        }
    };
}
