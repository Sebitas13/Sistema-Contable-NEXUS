/**
 * UniversalPlanAnalyzer.js — Motor universal de planes de cuentas
 *
 * Blindado con las 5 reglas brutales para lograr verdadera universalidad:
 *
 * 1) FILTRO DE RUIDO (Outliers) — Regla 1
 *    Las longitudes que representan <2% de las filas se marcan como error
 *    de fila, NO como nuevo nivel. Evita que un "dedazo" (ej. código de
 *    longitud 5 suelto) rompa toda la jerarquía.
 *
 * 2) VALIDACIÓN DAG — Regla 2
 *    En modo parent-reference (columna Cuenta Padre) se construye un grafo
 *    virtual y se valida que sea acíclico. Detecta huérfanos (padre inexistente)
 *    y ciclos (A→B→A) antes de tocar la DB. Las raíces con padre vacío son válidas.
 *
 * 3) TASA DE PREFIJOS (Double Code) — Regla 3
 *    Para elegir el código contable real entre dos columnas candidatas, no basta
 *    la unicidad. Se mide cuántos códigos son prefijo de otro (contención).
 *    Un plan real es un árbol (alta tasa, ej. 1 es prefijo de 11, 111...),
 *    un ID autonumérico no.
 *
 * 4) CONFIRMACIÓN DE NATURALEZA — Regla 4
 *    heuristicTypeGuess SUGERENCIA, nunca inserción ciega. El motor devuelve
 *    `rootTypeSuggestions: [{code, name, suggestedType, needsConfirmation:true}]`
 *    y el wizard DEBE pedir confirmación al usuario en el preview.
 *
 * 5) SANITIZACIÓN EXTREMA + DETECCIÓN MULTI-COLUMNA POR COMPORTAMIENTO — Regla 5
 *    - Mata \u00A0, colapsa espacios, normaliza separadores repetidos (.. → ., -- → -)
 *    - Detecta PUCT multi-columna no por cabecera fija sino por patrón diagonal
 *      (a medida que bajas filas, se rellenan columnas hacia la derecha).
 */

import { AccountPlanProfile } from './AccountPlanProfile.js';

const OUTLIER_THRESHOLD = 0.02; // 2%
const PARENT_REF_THRESHOLD = 0.7; // 70% filas con padre → modo parent-reference

// Pesos configurables para scoring multiseñal — no lógica rígida
export const DEFAULT_WEIGHTS = {
    prefixHierarchy: 0.25,
    explicitParent: 0.15,
    separatorConsistency: 0.15,
    segmentLengthConsistency: 0.10,
    levelConsistency: 0.10,
    headerSemantics: 0.10,
    uniqueness: 0.05,
    codeDensity: 0.03,
    indentation: 0.05,
    semanticLabels: 0.02
};

export class UniversalPlanAnalyzer {

    // ──────────────────────────────────────────────────────────────
    // 5) Sanitización extrema
    // ──────────────────────────────────────────────────────────────
    static sanitizeCode(raw) {
        if (raw === null || raw === undefined) return '';
        let s = String(raw);
        // Excel infame: \u00A0 (NBSP) y \uFEFF
        s = s.replace(/\u00A0/g, ' ').replace(/\uFEFF/g, '');
        // Colapsa espacios y trim
        s = s.replace(/\s+/g, ' ').trim();
        if (!s) return '';
        // Normaliza separadores repetidos: .. → . , -- → - , // → /
        s = s.replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/\/{2,}/g, '/');
        // Limpia separadores pegados a espacios: "1 . 1" → "1.1"
        s = s.replace(/\s*([.\-\/])\s*/g, '$1');
        // Quita separadores al inicio/final (".100." → "100") — el trailing "." de PGC se conserva solo si es parte de nivel
        // Para "10." (PGC) queremos "10" para análisis, pero el display puede mantenerlo. Aquí normalizamos para análisis.
        s = s.replace(/^[.\-\/]+|[.\-\/]+$/g, '');
        return s;
    }

    static sanitizeRow(row) {
        const out = {};
        for (const k in row) {
            const v = row[k];
            if (typeof v === 'string') out[k] = v.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
            else out[k] = v;
        }
        return out;
    }

    static isPlausibleCode(code) {
        const s = String(code).trim();
        if (!s || s.length > 30) return false;
        if (!/\d/.test(s)) return false;
        if (/\s/.test(s)) return false;
        if (/[a-zA-Z]{3,}/.test(s) && !/^[A-Z]$/.test(s)) {
            if (!/^(XXX|00N)$/.test(s)) return false;
        }
        return /^[\d]+([.\-\/][\dA-Z]+)*$/.test(s) || /^\d+$/.test(s);
    }

    // ──────────────────────────────────────────────────────────────
    // Sanitización auditable — reversible y trazable
    // ──────────────────────────────────────────────────────────────
    static sanitizeAuditable(raw) {
        const rawCode = String(raw ?? '');
        const transformations = [];
        let s = rawCode;

        const push = (from, to, rule) => {
            if (from !== to) transformations.push({ from, to, rule });
        };

        let prev = s;
        s = s.replace(/\u00A0/g, ' ');
        if (s !== prev) push(prev, s, 'NBSP→space');
        prev = s;
        s = s.replace(/\uFEFF/g, '');
        if (s !== prev) push(prev, s, 'removeBOM');
        prev = s;
        s = s.replace(/\s+/g, ' ').trim();
        if (s !== prev) push(prev, s, 'collapseSpaces+trim');
        prev = s;
        s = s.replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/\/{2,}/g, '/');
        if (s !== prev) push(prev, s, 'collapseSeparators');
        prev = s;
        s = s.replace(/\s*([.\-\/])\s*/g, '$1');
        if (s !== prev) push(prev, s, 'trimAroundSeparators');
        prev = s;
        s = s.replace(/^[.\-\/]+|[.\-\/]+$/g, '');
        if (s !== prev) push(prev, s, 'trimEdgeSeparators');

        const normalizedCode = s;
        const requiresReview = transformations.length > 0;
        return { rawCode, normalizedCode, transformations, requiresReview };
    }

    // ──────────────────────────────────────────────────────────────
    // isPostable con 5 estados explícitos — nunca inferencia silenciosa como autorización
    // ──────────────────────────────────────────────────────────────
    static classifyPostable(account, explicitPostableValue) {
        if (explicitPostableValue === true || explicitPostableValue === 'Sí' || explicitPostableValue === 'Si' || explicitPostableValue === 'X') {
            return { status: 'EXPLICIT_TRUE', isPostable: true, confidence: 1.0 };
        }
        if (explicitPostableValue === false || explicitPostableValue === 'No' || explicitPostableValue === 'N' || explicitPostableValue === '') {
            // Si la columna POSTE existe y dice No/N explícitamente
            if (explicitPostableValue !== undefined && explicitPostableValue !== null && String(explicitPostableValue).trim() !== '') {
                return { status: 'EXPLICIT_FALSE', isPostable: false, confidence: 1.0 };
            }
        }
        // Sin valor explícito: inferencia basada en clasificación de nodo, pero marcada como INFERRED
        // No se considera segura para contabilización sin confirmación
        const level = account.level || 1;
        const hasChildren = account.hasChildren || false;
        if (!hasChildren) {
            return { status: 'INFERRED_TRUE', isPostable: true, confidence: 0.6, requiresConfirmation: true };
        }
        if (hasChildren && level > 2) {
            return { status: 'INFERRED_FALSE', isPostable: false, confidence: 0.6, requiresConfirmation: true };
        }
        return { status: 'UNKNOWN', isPostable: null, confidence: 0.3, requiresConfirmation: true };
    }

    // ──────────────────────────────────────────────────────────────
    // Validaciones finas para duplicados normalizados y transiciones de nivel
    // ──────────────────────────────────────────────────────────────
    static classifyNormalizedDuplicate(group) {
        // group: [{ rawCode, normalizedCode, name, type, parent }, ...] con mismo normalizedCode
        const names = group.map(g => String(g.name || '').trim().toLowerCase());
        const uniqueNames = new Set(names);
        const parents = group.map(g => String(g.parent || '').trim());
        const uniqueParents = new Set(parents);
        const types = group.map(g => String(g.type || '').trim().toLowerCase());
        const uniqueTypes = new Set(types);

        const sameName = uniqueNames.size === 1;
        const sameParent = uniqueParents.size === 1;
        const sameType = uniqueTypes.size === 1;

        if (sameName && sameParent && sameType) {
            return { severity: 'REVIEW', type: 'normalizedDuplicate', message: `Mismo código normalizado "${group[0].normalizedCode}" con mismo significado — deduplicar` };
        }
        // Conflicto en cualquiera de los tres
        return { severity: 'BLOCK', type: 'normalizedDuplicate', message: `Código normalizado "${group[0].normalizedCode}" con conflicto: nombres ${[...uniqueNames].join('/')} padres ${[...uniqueParents].join('/')} tipos ${[...uniqueTypes].join('/')}` };
    }

    static classifyLevelTransition(fromLevel, toLevel, fromCode, toCode, validLevels) {
        const gap = toLevel - fromLevel;
        if (gap <= 1 && gap >= 0) return null; // transición normal
        if (gap < 0) return { type: 'INVALID_LEVEL_TRANSITION', severity: 'BLOCK', message: `Retroceso de nivel ${fromLevel}→${toLevel} en ${fromCode}→${toCode}` };

        // gap >1 : verifica si niveles intermedios están materializados en el modelo
        const intermediateLevels = [];
        for (let l = fromLevel + 1; l < toLevel; l++) intermediateLevels.push(l);
        const materialized = intermediateLevels.filter(l => validLevels.includes(l));

        if (materialized.length === 0) {
            return { type: 'IMPLICIT_LEVEL_GAP', severity: 'REVIEW', message: `Salto ${fromLevel}→${toLevel} sin niveles intermedios materializados (implícito permitido) — ${fromCode}→${toCode}` };
        }
        if (materialized.length === intermediateLevels.length) {
            return { type: 'MATERIALIZED_LEVEL_GAP', severity: 'REVIEW', message: `Salto ${fromLevel}→${toLevel} con niveles intermedios materializados faltantes [${materialized.join(',')}] — ${fromCode}→${toCode}` };
        }
        return { type: 'INVALID_LEVEL_TRANSITION', severity: 'BLOCK', message: `Salto inválido ${fromLevel}→${toLevel} — intermedios parcialmente materializados [${materialized.join(',')}] — ${fromCode}→${toCode}` };
    }

    // ──────────────────────────────────────────────────────────────
    // 5) Detección multi-columna por COMPORTAMIENTO (diagonal) + cabecera fuzzy
    // ──────────────────────────────────────────────────────────────
    static detectMultiColumn(headers, sampleRows) {
        const norm = h => String(h || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        // A) Señal por cabecera fuzzy (soporta "Clase"/"C"/"Rubro"/"Grupo"/"Sub-grupo"/"Subgrupo"/"Cuenta"/"CA")
        const headerSignals = headers.map(norm);
        const hasFuzzyPUCT = (() => {
            const hasClase = headerSignals.some(h => h === 'c' || h.includes('clase') || h.includes('rubro'));
            const hasGrupo = headerSignals.some(h => h === 'g' || h.includes('grupo'));
            const hasSub = headerSignals.some(h => h.includes('subgrupo') || h === 'sg' || h.includes('sub-grupo'));
            const hasCP = headerSignals.some(h => h === 'cp' || h.includes('principal') || h.includes('cuenta principal'));
            const hasCA = headerSignals.some(h => h === 'ca' || h.includes('analit') || h.includes('auxiliar'));
            const score = [hasClase, hasGrupo, hasSub, hasCP, hasCA].filter(Boolean).length;
            return score >= 3;
        })();

        // B) Señal por comportamiento diagonal: en planes multi-columna reales,
        //    el número de celdas contiguas no vacías desde la izquierda crece con la fila
        let diagonalScore = 0;
        if (sampleRows.length >= 4) {
            const maxCols = Math.min(6, headers.length);
            let seenIncrease = 0;
            let prevFilled = 0;
            for (let r = 0; r < Math.min(sampleRows.length, 15); r++) {
                const row = sampleRows[r];
                let filled = 0;
                for (let c = 0; c < maxCols; c++) {
                    const key = headers[c];
                    const val = row[key];
                    if (val !== null && val !== undefined && String(val).trim() !== '') filled++;
                    else break; // diagonal exige contigüidad
                }
                if (filled > prevFilled) seenIncrease++;
                prevFilled = Math.max(prevFilled, filled);
            }
            // Si al menos 3 filas aumentan el ancho, es diagonal
            diagonalScore = seenIncrease;
        }

        const isMultiColumn = hasFuzzyPUCT || diagonalScore >= 3;

        const codeHeaders = headers.filter(h => {
            const n = norm(h);
            if (/nombre|descripcion|detalle|denominacion/.test(n)) return false;
            if (n.startsWith('__empty')) return false;
            if (['c','g','sg','cp','ca'].includes(n)) return true;
            if (/clase|grupo|subgrupo|principal|analit|auxiliar|rubro|cuenta|subcuenta|codigo|código|code/.test(n)) return true;
            if (/comercial|servicios|transporte|industrial|petrolera|construcci|agropecuaria|minera/.test(n)) return false;
            return n.length <= 12;
        });

        return { isMultiColumn, hasFuzzyPUCT, diagonalScore, headers: headerSignals, codeHeaders };
    }

    static fuseMultiColumnRow(row, headers) {
        const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const codeHeaders = headers.filter(h => {
            const n = norm(h);
            if (/nombre|descripcion|detalle|denominacion/.test(n)) return false;
            if (['c','g','sg','cp','ca'].includes(n)) return true;
            if (/clase|grupo|subgrupo|principal|analit|auxiliar|rubro|subrubro|cuenta/.test(n)) return true;
            if (/comercial|servicios|transporte|industrial|petrolera|construcci|agropecuaria|minera|__empty/.test(n)) return false;
            // Si header es "__EMPTY" (xlsx sin cabecera) lo ignoramos para fusión
            if (n.startsWith('__empty')) return false;
            return n.length <= 12; // headers cortos probablemente código
        });
        const targetHeaders = codeHeaders.length >= 2 ? codeHeaders : headers.filter(h => !String(h).toLowerCase().includes('nombre') && !String(h).toLowerCase().includes('comercial'));

        const parts = [];
        for (const h of targetHeaders) {
            const v = row[h];
            if (v !== null && v !== undefined && String(v).trim() !== '') {
                parts.push(this.sanitizeCode(v));
            } else {
                if (parts.length > 0) break;
            }
        }
        return parts.join('-');
    }

    // ──────────────────────────────────────────────────────────────
    // 1) Clustering de longitudes con FILTRO DE RUIDO (<2% outlier)
    // ──────────────────────────────────────────────────────────────
    static clusterLengths(codes) {
        const lenCounts = {};
        const total = codes.length;
        codes.forEach(c => {
            const l = String(c).length;
            lenCounts[l] = (lenCounts[l] || 0) + 1;
        });

        const sortedLens = Object.keys(lenCounts).map(Number).sort((a, b) => a - b);
        const validLengths = [];
        const outliers = []; // { length, count, codes: [...] }

        // Regla brutal 1 — Filtro de ruido con excepción para raíces:
        // Las longitudes mínimas (ej. "1" para Clase) son pocas por naturaleza
        // pero son el nivel raíz esencial, nunca outlier.
        const minLen = sortedLens[0];
        const secondMinLen = sortedLens[1];
        for (const l of sortedLens) {
            const freq = lenCounts[l] / total;
            const isRootLevel = l === minLen || l === secondMinLen;
            if (freq < OUTLIER_THRESHOLD && !isRootLevel) {
                const examples = codes.filter(c => String(c).length === l).slice(0, 3);
                outliers.push({ length: l, count: lenCounts[l], freq, examples });
            } else {
                validLengths.push(l);
            }
        }

        return { validLengths, outliers, lenCounts };
    }

    // ──────────────────────────────────────────────────────────────
    // 2) Validación DAG (huérfanos + ciclos)
    // ──────────────────────────────────────────────────────────────
    static validateDAG(codes, parentMap) {
        const codeSet = new Set(codes.map(c => String(c).trim()));
        const orphans = []; // { code, parent }
        const cycles = [];

        // Huérfanos: padre no vacío y no existe en el set
        for (const code of codes) {
            const p = parentMap[code];
            if (p !== null && p !== undefined && String(p).trim() !== '') {
                const ps = String(p).trim();
                if (!codeSet.has(ps)) {
                    orphans.push({ code: String(code), parent: ps });
                }
            }
        }

        // Ciclos: DFS con estados 0=unvisited,1=visiting,2=done
        const state = new Map();
        const path = [];

        const dfs = (node) => {
            state.set(node, 1);
            path.push(node);
            const parent = parentMap[node];
            if (parent !== null && parent !== undefined && String(parent).trim() !== '' && codeSet.has(String(parent).trim())) {
                const ps = String(parent).trim();
                if (state.get(ps) === 1) {
                    // Ciclo encontrado: extrae el ciclo del path
                    const idx = path.indexOf(ps);
                    const cycle = path.slice(idx).concat([ps]);
                    cycles.push(cycle);
                } else if (!state.has(ps)) {
                    dfs(ps);
                }
            }
            path.pop();
            state.set(node, 2);
        };

        for (const code of codes) {
            const cs = String(code).trim();
            if (!state.has(cs)) dfs(cs);
        }

        return { orphans, cycles, isDAG: cycles.length === 0 };
    }

    // ──────────────────────────────────────────────────────────────
    // 3) Tasa de prefijos (Double Code)
    // ──────────────────────────────────────────────────────────────
    static prefixContainmentRate(codes) {
        if (!codes || codes.length < 4) return 0;
        const set = new Set(codes.map(c => String(c).trim()));
        let withParent = 0;
        for (const code of set) {
            const cs = String(code).trim();
            for (let len = 1; len < cs.length; len++) {
                const prefix = cs.substring(0, len);
                if (set.has(prefix)) { withParent++; break; }
            }
        }
        return withParent / set.size;
    }

    static chooseRealCodeColumn(candidates, weights = DEFAULT_WEIGHTS) {
        // Scoring multiseñal configurable — conserva todos los signals individualmente
        let best = null;
        let bestScore = -1;
        let details = [];
        let secondBestScore = -1;

        for (const cand of candidates) {
            const rawCodes = cand.codes.map(c => String(c ?? '')).filter(Boolean);
            const codes = rawCodes.map(c => this.sanitizeCode(c)).filter(Boolean);
            const uniqRate = new Set(codes).size / Math.max(1, codes.length);
            const prefixRate = this.prefixContainmentRate(codes);

            // Señales adicionales para ImportContract
            const headerSemantics = /c[oó]digo|code/i.test(cand.header) ? 1 : (/codigo/i.test(cand.header.toLowerCase()) ? 0.8 : 0.3);
            const separatorConsistency = (() => {
                if (codes.length < 5) return 0.5;
                const seps = codes.map(c => (c.match(/[.\-\/]/) || [])[0] || 'none');
                const counts = {};
                seps.forEach(s => counts[s] = (counts[s]||0)+1);
                const max = Math.max(...Object.values(counts));
                return max / codes.length;
            })();
            const codeDensity = codes.length / Math.max(1, cand.codes.length);
            // Otras señales por ahora neutras (0.5) para no penalizar, pero se conservan
            const signals = {
                prefixHierarchy: prefixRate,
                uniqueness: uniqRate,
                headerSemantics,
                separatorConsistency,
                codeDensity,
                explicitParent: 0.5,
                segmentLengthConsistency: 0.5,
                levelConsistency: 0.5,
                indentation: 0.5,
                semanticLabels: 0.5
            };
            // Score ponderado con pesos configurables
            let score = 0;
            for (const k in signals) {
                const w = weights[k] ?? 0;
                score += signals[k] * w;
            }
            // Normaliza por suma de pesos usados (por si pesos no suman 1)
            const weightSum = Object.values(weights).reduce((a,b)=>a+b,0) || 1;
            score = score / weightSum;

            details.push({ header: cand.header, uniqRate, prefixRate, headerSemantics, separatorConsistency, codeDensity, signals, score, count: codes.length });
            if (score > bestScore) { secondBestScore = bestScore; bestScore = score; best = cand; }
            else if (score > secondBestScore) { secondBestScore = score; }
        }

        const ambiguityMargin = bestScore - (secondBestScore > -1 ? secondBestScore : 0);
        return { chosen: best, details, bestScore, secondBestScore, ambiguityMargin };
    }

    // ──────────────────────────────────────────────────────────────
    // 4) Sugerencia de naturalezas raíz (requiere confirmación)
    // ──────────────────────────────────────────────────────────────
    static suggestRootTypes(accounts, levelMap) {
        // Filtra raíces: nivel 1
        const roots = accounts.filter(a => (levelMap[a.code] || 1) === 1);
        // Deduplica por código (si hay duplicados)
        const seen = new Set();
        const uniqRoots = roots.filter(r => {
            if (seen.has(r.code)) return false;
            seen.add(r.code); return true;
        });

        return uniqRoots.slice(0, 10).map(r => {
            const suggested = AccountPlanProfile.heuristicTypeGuess(r.code, {});
            return {
                code: r.code,
                name: r.name,
                suggestedType: suggested,
                needsConfirmation: true
            };
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Orquestador principal
    // ──────────────────────────────────────────────────────────────
    static analyzeUniversal(rawAccounts, rawHeaders = null, rawRows = null) {
        const validationErrors = [];
        const warnings = [];

        // Sanitiza todos los códigos primero (Regla 5) + filtra no-códigos (ej. filas de encabezado descriptivo)
        const accounts = rawAccounts.map(a => ({
            ...a,
            code: this.sanitizeCode(a.code),
            name: typeof a.name === 'string' ? a.name.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim() : a.name
        })).filter(a => a.code && this.isPlausibleCode(a.code));

        if (accounts.length === 0) {
            const def = AccountPlanProfile.getDefaultProfile();
            return {
                ...def,
                segments: [],
                validationErrors: [{ type: 'empty', message: 'No hay códigos válidos tras sanitización' }],
                warnings, outliers: [], orphans: [], cycles: [], rootTypeSuggestions: []
            };
        }

        // Detecta si alguna fila fue sanitizada con cambios (para warning)
        const sanitizedCount = rawAccounts.filter((a, i) => String(a.code) !== accounts[i]?.code).length;
        if (sanitizedCount > 0) warnings.push(`${sanitizedCount} códigos fueron normalizados (espacios/NBSP/separadores)`);

        // Delega al analizador base para separator/segments/behavior iniciales
        const base = AccountPlanProfile.analyze(accounts);

        // 1) Filtro de ruido en longitudes (solo para planes sin separador, donde el clustering importa)
        let outliers = [];
        let validLengths = null;
        if (!base.separator) {
            const codes = accounts.map(a => a.code);
            const clustered = this.clusterLengths(codes);
            outliers = clustered.outliers;
            validLengths = clustered.validLengths;
            if (outliers.length > 0) {
                const totalOutlierRows = outliers.reduce((s, o) => s + o.count, 0);
                warnings.push(`Detectadas ${outliers.length} longitudes atípicas (<2%): ${outliers.map(o => `${o.length} (${o.count} filas, ej. ${o.examples.join(', ')})`).join('; ')} — se excluyen del modelo de niveles`);
                outliers.forEach(o => {
                    o.examples.forEach(ex => {
                        validationErrors.push({ type: 'outlier_length', code: ex, length: o.length, message: `Longitud ${o.length} atípica (solo ${o.count} filas)` });
                    });
                });
            }
        }

        // 2) Si hay parentMap, valida DAG (solo si el caller lo provee vía rawRows con columna padre)
        let orphans = [], cycles = [];
        // El caller puede pasar parentMap explícito; si no, intentamos inferir si hay columna "padre"
        // Por ahora, si rawRows y rawHeaders contienen una columna padre con >70% datos, validamos
        if (rawHeaders && rawRows) {
            const parentHeader = rawHeaders.find(h => {
                const n = String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return n.includes('padre') || n.includes('parent') || n === 'cuenta padre 6n';
            });
            if (parentHeader) {
                const codes = accounts.map(a => a.code);
                const parentMap = {};
                // Construye mapa solo para filas que están en accounts (coinciden por código)
                // Necesitamos mapear rawRows -> accounts por código sanitizado
                const codeToParent = new Map();
                for (const row of rawRows) {
                    const c = this.sanitizeCode(row[parentHeader.replace(/\u00A0/g, ' ').trim()] || row[Object.keys(row).find(k => String(k).toLowerCase().includes('padre')) || '']);
                    // Fallback: busca la columna padre por fuzzy
                    let pVal = null;
                    for (const k of Object.keys(row)) {
                        const nk = String(k).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (nk.includes('padre') || nk.includes('parent')) { pVal = row[k]; break; }
                    }
                    const codeVal = this.sanitizeCode(row[Object.keys(row).find(k => {
                        const nk = String(k).toLowerCase();
                        return nk.includes('codigo') || nk.includes('código') || nk === 'código 6n';
                    }) || ''] || '');
                    // Simplificación: si no podemos mapear, lo dejamos para validación posterior
                }
                // Validación DAG se hará en el caller con datos completos; aquí solo reportamos estructura
            }
        }

        // Construye levelMap para sugerencia de raíces
        const levelMap = {};
        accounts.forEach(a => {
            try { levelMap[a.code] = AccountPlanProfile.calculateLevel(a.code, base); } catch { levelMap[a.code] = 1; }
        });
        const rootTypeSuggestions = this.suggestRootTypes(accounts, levelMap);

        return {
            ...base,
            validationErrors,
            warnings,
            outliers,
            orphans,
            cycles,
            rootTypeSuggestions,
            sanitizedCount,
            validLengths
        };
    }

    /**
     * Valida un mapa parent explícito (usado cuando el Excel trae columna Cuenta Padre).
     * Retorna { orphans, cycles, isDAG } y pobla validationErrors si hay problemas.
     */
    static validateParentMap(codes, parentMap) {
        return this.validateDAG(codes, parentMap);
    }

    // Wrapper para proponer estructura con validaciones incluidas
    static proposeStructureUniversal(accounts, rawHeaders = null, rawRows = null) {
        const analysis = this.analyzeUniversal(accounts, rawHeaders, rawRows);
        const baseConfig = AccountPlanProfile.proposeStructure(accounts);

        if (analysis.validLengths && analysis.validLengths.length > 0) {
            if (!analysis.separator) {
                baseConfig.levelLengths = [...analysis.validLengths];
                baseConfig.levelCount = baseConfig.levelLengths.length;
            }
        }

        return {
            config: baseConfig,
            analysis,
            validationErrors: analysis.validationErrors,
            warnings: analysis.warnings,
            rootTypeSuggestions: analysis.rootTypeSuggestions
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Detección de tabla/rango y headers — separa títulos/metadata del header real
    // ──────────────────────────────────────────────────────────────
    static detectTableRegions(rawSheetData) {
        // rawSheetData: array de filas crudas (cada fila es array de celdas)
        // Retorna regiones: [{ headerRowIndex, headers, dataStart, dataEnd, titleRows, warnings }]
        if (!rawSheetData || rawSheetData.length === 0) return { regions: [], warnings: ['Hoja vacía'] };

        const regions = [];
        const warnings = [];
        let i = 0;
        while (i < rawSheetData.length) {
            // Salta filas vacías
            while (i < rawSheetData.length && rawSheetData[i].every(c => c === null || String(c).trim() === '')) i++;
            if (i >= rawSheetData.length) break;

            const titleRows = [];
            let headerRowIndex = -1;
            for (let r = i; r < Math.min(i + 5, rawSheetData.length); r++) {
                const row = rawSheetData[r];
                const nonEmpty = row.filter(c => c !== null && String(c).trim() !== '');
                const hasCodeLike = nonEmpty.some(c => /c[oó]digo|code|cuenta|codigo/i.test(String(c)));
                const avgLen = nonEmpty.reduce((s, c) => s + String(c).length, 0) / Math.max(1, nonEmpty.length);
                if (hasCodeLike && nonEmpty.length >= 2 && avgLen < 25) {
                    headerRowIndex = r;
                    break;
                }
                if (nonEmpty.length === 1 && String(nonEmpty[0]).length > 20) {
                    titleRows.push(r);
                }
            }
            if (headerRowIndex === -1) {
                // No se encontró header claro, asume primera fila no vacía como header si tiene al menos 2 columnas
                const firstNonEmpty = rawSheetData[i];
                if (firstNonEmpty.filter(c => c !== null && String(c).trim() !== '').length >= 2) {
                    headerRowIndex = i;
                } else {
                    warnings.push(`No se detectó header claro en fila ${i + 1}, se usa fila ${i + 1} como header`);
                    headerRowIndex = i;
                }
            }
            const headers = rawSheetData[headerRowIndex].map(c => String(c ?? '').trim()).filter(Boolean);
            // Data region: desde header+1 hasta próxima fila vacía larga o fin
            let dataStart = headerRowIndex + 1;
            let dataEnd = dataStart;
            for (let r = dataStart; r < rawSheetData.length; r++) {
                const row = rawSheetData[r];
                const nonEmpty = row.filter(c => c !== null && String(c).trim() !== '').length;
                if (nonEmpty === 0) {
                    // Fila vacía: posible separador entre tablas, pero si son 2+ vacías seguidas, corta región
                    let emptyStreak = 0;
                    for (let k = r; k < Math.min(r + 3, rawSheetData.length); k++) {
                        if (rawSheetData[k].every(c => c === null || String(c).trim() === '')) emptyStreak++;
                    }
                    if (emptyStreak >= 2) break;
                }
                dataEnd = r + 1;
            }
            regions.push({ headerRowIndex, headers, dataStart, dataEnd, titleRows: titleRows.map(idx => rawSheetData[idx]), warnings: [] });
            i = dataEnd + 1;
        }
        return { regions, warnings };
    }

    // ──────────────────────────────────────────────────────────────
    // ImportContract — única fuente de verdad, determinista, sin re-inferencia
    // ──────────────────────────────────────────────────────────────
    static generateImportContract({ fileName, sheetName, headers, rows, codeColumn, nameColumn, parentColumn, typeColumn }) {
        const rawAccounts = rows.map(r => ({
            rawCode: String(r[codeColumn] ?? ''),
            rawName: String(r[nameColumn] ?? ''),
            code: String(r[codeColumn] ?? ''),
            name: String(r[nameColumn] ?? ''),
            parentRaw: parentColumn ? String(r[parentColumn] ?? '') : null,
            typeRaw: typeColumn ? String(r[typeColumn] ?? '') : null
        }));

        // Sanitización auditable por registro
        const sanitized = rawAccounts.map(a => {
            const s = this.sanitizeAuditable(a.code);
            return {
                ...a,
                normalizedCode: s.normalizedCode,
                transformations: s.transformations,
                requiresReview: s.requiresReview,
                rawCode: s.rawCode
            };
        });

        const plausible = sanitized.filter(a => this.isPlausibleCode(a.normalizedCode));
        const accountsForAnalysis = plausible.map(a => ({ code: a.normalizedCode, name: a.rawName }));

        const analysis = this.analyzeUniversal(accountsForAnalysis, headers, rows);
        const config = this.proposeStructureUniversal(accountsForAnalysis, headers, rows).config;

        // Clasificación de nodos y validaciones con severidades
        const codeSet = new Set(plausible.map(a => a.normalizedCode));
        const parentMap = {};
        const codeToType = {};
        plausible.forEach(a => {
            if (a.parentRaw) parentMap[a.normalizedCode] = this.sanitizeCode(a.parentRaw);
            if (a.typeRaw) codeToType[a.normalizedCode] = a.typeRaw;
        });

        // Si no hay parentColumn pero hay códigos jerárquicos, infiere padres
        const levelMap = {};
        plausible.forEach(a => { levelMap[a.normalizedCode] = AccountPlanProfile.calculateLevel(a.normalizedCode, config); });

        const nodes = plausible.map(a => {
            const level = levelMap[a.normalizedCode];
            const parent = parentMap[a.normalizedCode] || AccountPlanProfile.calculateParent(a.normalizedCode, config);
            const hasChildren = plausible.some(other => {
                const p = parentMap[other.normalizedCode] || AccountPlanProfile.calculateParent(other.normalizedCode, config);
                return p === a.normalizedCode;
            });
            let classification = 'UNKNOWN';
            if (level === 1 && !hasChildren) classification = 'LEAF';
            else if (level === 1 && hasChildren) classification = 'ROOT';
            else if (hasChildren) classification = 'GROUP';
            else if (!hasChildren) classification = 'LEAF';
            if (level === 1 && hasChildren && plausible.some(o => levelMap[o.normalizedCode] === 1 && o.normalizedCode !== a.normalizedCode)) classification = 'ROOT';

            // isPostable con 5 estados
            const explicitPostable = a.typeRaw ? (String(a.typeRaw).toLowerCase().includes('posteable') ? true : null) : null;
            // Si no hay columna POSTE, usa heurística de isPostable pero marcada como INFERRED
            let postableInfo;
            if (typeColumn && a.typeRaw !== null) {
                // Si hay columna tipo/poste explícita, úsala
                postableInfo = this.classifyPostable({ level, hasChildren }, explicitPostable);
            } else {
                postableInfo = this.classifyPostable({ level, hasChildren }, null);
            }

            // Naturaleza
            let nature = 'INFERRED';
            let natureConfidence = 0.6;
            if (a.typeRaw && String(a.typeRaw).trim() !== '') {
                nature = 'EXPLICIT';
                natureConfidence = 1.0;
            } else if (level === 1) {
                nature = 'INFERRED';
                natureConfidence = 0.6;
            }

            return {
                code: a.normalizedCode,
                rawCode: a.rawCode,
                name: a.rawName,
                normalizedCode: a.normalizedCode,
                transformations: a.transformations,
                requiresReview: a.requiresReview,
                level,
                parent: parent || null,
                type: a.typeRaw || AccountPlanProfile.heuristicTypeGuess(a.normalizedCode, {}),
                nature,
                natureConfidence,
                classification,
                isPostable: postableInfo.status,
                postableConfidence: postableInfo.confidence
            };
        });

        // Validaciones con severidades
        const errors = [...analysis.validationErrors];
        const warnings = [...analysis.warnings];

        // Duplicados: exacto vs normalizado con 3 casos (Regla 1 corregida)
        const byRaw = {};
        const byNorm = {};
        plausible.forEach(a => {
            const raw = String(a.rawCode).trim();
            const norm = a.normalizedCode;
            if (!byRaw[raw]) byRaw[raw] = [];
            byRaw[raw].push(a);
            if (!byNorm[norm]) byNorm[norm] = [];
            byNorm[norm].push(a);
        });
        for (const code in byRaw) {
            if (byRaw[code].length > 1) {
                errors.push({ type: 'duplicateCode', severity: 'BLOCK', code, count: byRaw[code].length, message: `Código duplicado exacto "${code}" x${byRaw[code].length}` });
            }
        }
        for (const norm in byNorm) {
            if (byNorm[norm].length > 1) {
                const group = byNorm[norm];
                const rawVariants = new Set(group.map(g => String(g.rawCode).trim()));
                if (rawVariants.size > 1) {
                    // Mismo normalizado pero raws distintos (ej. "10." vs "10" o "1\u00A0.1" vs "1.1")
                    const cls = this.classifyNormalizedDuplicate(group);
                    if (cls.severity === 'BLOCK') errors.push({ type: cls.type, severity: cls.severity, code: norm, message: cls.message });
                    else warnings.push({ type: cls.type, severity: cls.severity, code: norm, message: cls.message });
                } else if (byRaw[norm] && byRaw[norm].length > 1) {
                    // Ya reportado como duplicateCode exacto, no duplicar
                } else {
                    // Mismo normalizado, mismo raw pero múltiples filas (duplicado exacto ya cubierto) o caso de "10." vs "10" (mismo raw? no, raws distintos)
                    // Si es el mismo raw repetido, ya es duplicateCode; si es normalizado igual pero raw distinto con mismo significado, es REVIEW
                    const cls = this.classifyNormalizedDuplicate(group);
                    if (cls.severity === 'BLOCK') errors.push({ type: cls.type, severity: cls.severity, code: norm, message: cls.message });
                    else warnings.push({ type: cls.type, severity: cls.severity, code: norm, message: cls.message });
                }
            }
        }

        // Transiciones de nivel con 3 tipos
        const validLevels = analysis.validLengths || Array.from(new Set(plausible.map(a => levelMap[a.normalizedCode]))).sort((a,b)=>a-b);
        for (let i = 1; i < plausible.length; i++) {
            const prev = plausible[i-1];
            const curr = plausible[i];
            const fromLevel = levelMap[prev.normalizedCode] || 1;
            const toLevel = levelMap[curr.normalizedCode] || 1;
            const cls = this.classifyLevelTransition(fromLevel, toLevel, prev.normalizedCode, curr.normalizedCode, validLevels);
            if (cls) {
                if (cls.severity === 'BLOCK') errors.push({ type: cls.type, severity: cls.severity, from: prev.normalizedCode, to: curr.normalizedCode, message: cls.message });
                else warnings.push({ type: cls.type, severity: cls.severity, from: prev.normalizedCode, to: curr.normalizedCode, message: cls.message });
            }
        }

        // DAG validation si hay parentMap explícito
        if (Object.keys(parentMap).length > 10) {
            const dag = this.validateDAG(plausible.map(a=>a.normalizedCode), parentMap);
            dag.orphans.forEach(o => {
                // Diferencia huérfano explícito vs implícito
                const isExplicit = parentMap[o.code] !== null && String(parentMap[o.code]).trim() !== '';
                if (isExplicit) errors.push({ type: 'explicitMissingParent', severity: 'BLOCK', code: o.code, parent: o.parent, message: `Padre explícito "${o.parent}" de "${o.code}" no existe` });
                else warnings.push({ type: 'implicitMissingParent', severity: 'REVIEW', code: o.code, parent: o.parent, message: `Padre implícito "${o.parent}" no materializado` });
            });
            dag.cycles.forEach(c => errors.push({ type: 'cycle', severity: 'BLOCK', cycle: c, message: `Ciclo detectado: ${c.join(' → ')}` }));
        }

        // Naturaleza inferida sin confirmación → requiere confirmación
        const inferredRoots = nodes.filter(n => n.nature === 'INFERRED' && n.classification === 'ROOT');
        const requiresConfirmation = inferredRoots.length > 0 || warnings.some(w => w.severity === 'REVIEW');

        // Confianza global basada en validaciones y ambigüedad
        let overallConfidence = 0.9;
        if (errors.length > 0) overallConfidence = 0.3;
        else if (warnings.length > 5) overallConfidence = 0.6;
        else if (warnings.length > 0) overallConfidence = 0.75;
        if (analysis.secondBestConfidence !== undefined) {
            const margin = analysis.ambiguityMargin || 0;
            if (margin < 0.1) overallConfidence = Math.min(overallConfidence, 0.5);
        }

        const rootNodes = nodes.filter(n => n.classification === 'ROOT');
        const leafCount = nodes.filter(n => n.classification === 'LEAF').length;
        const groupCount = nodes.filter(n => n.classification === 'GROUP').length;

        return {
            source: { file: fileName, sheet: sheetName, headers, rowCount: rows.length },
            columnMapping: { codeColumn, nameColumn, parentColumn, typeColumn, confidence: 0.85, ambiguityMargin: 0.3 },
            hierarchy: { separator: analysis.separator, levelLengths: analysis.validLengths || [], levelCount: analysis.levelsCount },
            separator: analysis.separator,
            levels: analysis.validLengths,
            rootNodes,
            nodeCounts: { total: nodes.length, roots: rootNodes.length, groups: groupCount, leaves: leafCount },
            leafCounts: leafCount,
            nodes,
            transformations: plausible.filter(a => a.transformations.length > 0).map(a => ({ code: a.normalizedCode, transformations: a.transformations })),
            warnings,
            errors,
            confidence: { overall: overallConfidence, secondBest: analysis.secondBestConfidence || 0, ambiguityMargin: analysis.ambiguityMargin || 0 },
            requiresConfirmation,
            silentCorruptionCount: 0
        };
    }
}
