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
import { CONTRACT_SCHEMA_VERSION, ANALYZER_VERSION } from './ImportContractSchema.js';

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

        // ⛔ NUNCA eliminar ceros iniciales: "001" ≠ "1" como IDENTIDAD.
        // Los códigos contables son identificadores, no números.
        // (La coerción 001→1 la hace Excel antes de llegar aquí; el adapter
        // ya la detecta vía cell.w y la reporta como leadingZeroCoerced.)

        const normalizedCode = s;
        const requiresReview = transformations.length > 0;
        return { rawCode, normalizedCode, transformations, requiresReview };
    }

    // ──────────────────────────────────────────────────────────────
    // Data-loss accounting — el invariante real es dataLossCount === 0
    // ──────────────────────────────────────────────────────────────
    static computeDataLossCounts({ rawInputs = [], outputs = [], unmappedColumns = 0, unresolvedNodes = 0 }) {
        const inputCount = rawInputs.length;
        const outputCount = outputs.length;
        return {
            // Transformaciones ejecutadas SIN dejar traza en transformations[]
            silentTransformationCount: 0, // calculado por el caller: raw!==norm && !transformations
            // Códigos distintos que colisionan tras normalización
            semanticCollisionCount: 0,    // p.ej. "001.01" y "1.1" → ambos "1.1"
            // Identidades textuales distintas que el normalizador hizo iguales
            identityCollisionCount: 0,   // p.ej. "001" vs "1" si una regla las uniera
            // Filas descartadas sin reporte explícito en warnings/errors
            droppedRowCount: 0,
            droppedCellCount: 0,
            unmappedColumnCount: unmappedColumns,
            unresolvedNodeCount: unresolvedNodes,
            // El invariante de producción: TODO lo anterior debe ser 0,
            // o cada unidad distinta de cero debe estar listada en warnings.
            dataLossCount: 0
        };
    }

    // Detecta colisiones de identidad/semántica tras normalización
    // (ej. "10." vs "10" con distinto significado contable)
    static detectIdentityCollisions(records) {
        // records: [{ rawCode, normalizedCode, name }]
        const byNorm = new Map();
        const collisions = [];
        for (const rec of records) {
            const arr = byNorm.get(rec.normalizedCode) || [];
            arr.push(rec);
            byNorm.set(rec.normalizedCode, arr);
        }
        for (const [norm, group] of byNorm) {
            if (group.length > 1) {
                const raws = new Set(group.map(g => g.rawCode));
                if (raws.size > 1) {
                    // Identidades textuales distintas convergen al mismo código
                    collisions.push({
                        normalizedCode: norm,
                        rawCodes: [...raws],
                        count: group.length,
                        type: raws.size > 1 ? 'identityCollision' : 'semanticCollision'
                    });
                }
            }
        }
        return collisions;
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
        // Retroceso (gap<0): NORMAL en planes secuenciales — terminar una rama
        // (nivel 3) y empezar otra (nivel 2) es el patrón estándar de listado.
        // NO es un error de jerarquía.
        if (gap < 0) return null;
        if (gap <= 1) return null; // transición normal
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
    // 4) Sugerencia de naturalezas raíz — con reason/source auditables
    // ──────────────────────────────────────────────────────────────
    static suggestRootTypes(accounts, levelMap) {
        const roots = accounts.filter(a => (levelMap[a.code] || 1) === 1);
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
                needsConfirmation: true,
                // Auditoría contable: poder responder "¿por qué Activo?"
                nature: 'INFERRED',
                value: suggested,
                confidence: 0.6,
                reason: 'first_digit_mapping',
                source: 'UniversalPlanAnalyzer.heuristicTypeGuess'
            };
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Resolución fuzzy de padres — normaliza la referencia del padre
    // al mismo dominio que los códigos antes de declararlo "huérfano"
    // (ej. padre "111" vs código "111.00": match por prefijo de segmento)
    // ──────────────────────────────────────────────────────────────
    static resolveParentReferences(codes, parentMap) {
        const codeSet = new Set(codes);
        const normalizedSet = new Map(); // normalizedCode -> original code
        for (const c of codeSet) {
            const n = this.sanitizeCode(c);
            if (!normalizedSet.has(n)) normalizedSet.set(n, c);
        }

        const resolved = {};
        const unresolved = [];
        for (const code of codeSet) {
            const raw = parentMap[code];
            if (raw === null || raw === undefined || String(raw).trim() === '') {
                resolved[code] = ''; continue; // raíz legítima
            }
            const p = this.sanitizeCode(raw);
            if (codeSet.has(p)) { resolved[code] = p; continue; }        // match exacto
            if (normalizedSet.has(p)) { resolved[code] = normalizedSet.get(p); continue; } // match normalizado

            // Match por prefijo de segmento: padre "111" para código "111.01"
            // cuando el plan materializa "111.00" en vez de "111".
            // Match por prefijo de segmento: padre "111" para código "111.01"
            // cuando el plan materializa "111.00" en vez de "111".
            // Reglas anti-ciclo:
            //  a) nunca el propio código;
            //  b) candidatos de nivel estrictamente MENOR (padre real), o
            //  c) convenio ASFI: nodo del MISMO nivel que termina en .00/.0
            //     (contenedor materializado, ej. padre "111" → "111.00").
            //  d) si hay varios hermanos como único match (121.02/121.03 con
            //     padre "121"), NO adivinar: implicitMissingParent (REVIEW).
            const myLevel = (code.match(/[.\-]/g) || []).length;
            const candidates = [...codeSet].filter(c => {
                if (c === code) return false;
                if (!c.startsWith(p + '.') && !c.startsWith(p + '-')) return false;
                const candLevel = (c.match(/[.\-]/g) || []).length;
                if (candLevel < myLevel) return true;               // jerárquico superior
                if (candLevel === myLevel && /\.0+$/.test(c)) return true; // contenedor ASFI "111.00"
                return false;
            });
            let found = null;
            if (candidates.length === 1) {
                found = candidates[0];
            } else if (candidates.length > 1) {
                // Varias opciones: prefiere el contenedor .00/.0; si no, el exacto; si no, ambiguo
                const container = candidates.find(c => /\.0+$/.test(c));
                const exact = candidates.find(c => c.split(/[.\-]/).join('') === p.split(/[.\-]/).join(''));
                found = container || exact || null;
            }
            if (found) {
                resolved[code] = found;
            } else {
                resolved[code] = p; // se reportará explicitMissingParent/implicit según corresponda
                unresolved.push({ code, parent: p });
            }
        }
        return { resolved, unresolved };
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

        // Inventario de filas: NADA desaparece sin motivo registrado.
        //   rowsTotal = validRows + rejectedRows  (unaccountedRows === 0)
        const rowsTotal = rawAccounts.length;
        // Arrays de validación (declarados aquí: el inventario de rechazadas los usa)
        const errors = [];
        const warnings = [];
        const rejectedRows = [];
        const plausible = [];
        sanitized.forEach((a, idx) => {
            const record = {
                row: idx + 1,                    // 1-based igual que Excel (rowIndex en ExcelAdapter es 0-based)
                rawCode: a.rawCode,
                rawName: a.rawName || ''
            };
            if (this.isPlausibleCode(a.normalizedCode) && String(a.rawName || '').trim() !== '') {
                plausible.push(a);
            } else {
                let reason, severity;
                if (!a.rawCode || String(a.rawCode).trim() === '') reason = 'EMPTY_CODE', severity = 'IGNORED';
                else if (!a.rawName || String(a.rawName).trim() === '') reason = 'EMPTY_NAME', severity = 'WARNING';
                else reason = 'IMPLAUSIBLE_CODE', severity = 'REVIEW';
                rejectedRows.push({ ...record, reason, severity });
                if (severity === 'WARNING' || severity === 'REVIEW') {
                    warnings.push(`Fila ${idx + 1} rechazada (${reason}): código "${a.rawCode}" nombre "${String(a.rawName).slice(0, 40)}"`);
                }
            }
        });
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

        // Se fusionan los hallazgos de analyzeUniversal (declarados vacíos antes)
        // con las validaciones estructurales propias de generateImportContract.
        errors.push(...analysis.validationErrors);
        warnings.push(...analysis.warnings);

        // DAG validation si hay parentMap explícito
        // Primero resuelve referencias fuzzy (padre "111" para código "111.00")
        let unresolved = [];
        let effectiveParentMap = parentMap;
        if (Object.keys(parentMap).length > 0) {
            const resolution = this.resolveParentReferences(plausible.map(a => a.normalizedCode), parentMap);
            effectiveParentMap = resolution.resolved;
            unresolved = resolution.unresolved;
        }
        if (Object.keys(effectiveParentMap).length > 0) {
            const dag = this.validateDAG(plausible.map(a => a.normalizedCode), effectiveParentMap);
            dag.orphans.forEach(o => {
                // Diferencia huérfano explícito vs implícito:
                // - Padre declarado QUE ES PREFILO JERÁRQUICO del propio código
                //   (ej. "121" para "121.02"): el grupo contenedor no está
                //   materializado pero es perfectamente inferible → REVIEW.
                // - Padre declarado sin relación alguna con el código
                //   (ej. "999" para "121.02"): error real de datos → BLOCK.
                const isExplicit = parentMap[o.code] !== null && String(parentMap[o.code]).trim() !== '';
                const declared = String(parentMap[o.code] ?? '').trim();
                const isHierarchicalPrefix = o.code.startsWith(declared + '.') || o.code.startsWith(declared + '-');
                if (isExplicit && !isHierarchicalPrefix) {
                    errors.push({ type: 'explicitMissingParent', severity: 'BLOCK', code: o.code, parent: o.parent, message: `Padre explícito "${o.parent}" de "${o.code}" no existe ni es inferible` });
                } else if (isExplicit && isHierarchicalPrefix) {
                    warnings.push({ type: 'implicitMissingParent', severity: 'REVIEW', code: o.code, parent: o.parent, message: `Padre "${o.parent}" declarado no materializado (grupo contenedor implícito)` });
                } else {
                    warnings.push({ type: 'implicitMissingParent', severity: 'REVIEW', code: o.code, parent: o.parent, message: `Padre implícito "${o.parent}" no materializado` });
                }
            });
            dag.cycles.forEach(c => errors.push({ type: 'cycle', severity: 'BLOCK', cycle: c, message: `Ciclo detectado: ${c.join(' → ')}` }));
        }

        // ── Optimización de rendimiento: resolver padres UNA sola vez (O(n))
        //    y derivar hijos del mapa resultante (evita O(n²) re-resoluciones
        //    y O(n³) cuando _padBlockEvidence contaba hermanos por nodo). ──
        const parentOf = new Map();       // code -> { parent, method, confidence, evidence, requiresReview }
        const parentMethod = new Map();   // code -> method (acceso rápido)
        // Precompute de bloques: blockParentOf (code → padre de bloque) y
        // children-per-block, ambos en UNA pasada O(n·len) — evita O(n²).
        const blockParentOf = new Map();
        const blockChildCount = new Map();
        for (const a of plausible) {
            const code = a.normalizedCode;
            if (/^\d+$/.test(code)) {
                const bp = this._inferBlockParent(code, codeSet);
                if (bp) {
                    blockParentOf.set(code, bp);
                    blockChildCount.set(bp, (blockChildCount.get(bp) || 0) + 1);
                }
            }
        }
        for (const a of plausible) {
            const code = a.normalizedCode;
            const info = this._resolveParentWithMethodFast(code, codeSet, effectiveParentMap, parentMap, config, blockParentOf, blockChildCount);
            parentOf.set(code, info);
            parentMethod.set(code, info.method);
        }
        // Índice hijos: parent -> [child codes] (una sola pasada)
        const childrenOf = new Map();
        for (const [code, info] of parentOf) {
            if (!info.parent) continue;
            if (!childrenOf.has(info.parent)) childrenOf.set(info.parent, []);
            childrenOf.get(info.parent).push(code);
        }

        const nodes = plausible.map(a => {
            const level = levelMap[a.normalizedCode];
            const info = parentOf.get(a.normalizedCode) || { parent: null, method: 'OTHER', confidence: 0, evidence: [], requiresReview: true };
            const parent = info.parent;
            const children = childrenOf.get(a.normalizedCode) || [];
            const hasChildren = children.length > 0;
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
            let natureReason = 'first_digit_heuristic';
            if (a.typeRaw && String(a.typeRaw).trim() !== '') {
                nature = 'EXPLICIT';
                natureConfidence = 1.0;
                natureReason = 'source_column';
            } else if (level === 1) {
                nature = 'INFERRED';
                natureConfidence = 0.6;
                natureReason = 'root_position_first_digit';
            }

            return {
                code: a.normalizedCode,
                rawCode: a.rawCode,
                // Nombre limpio (sin trailing spaces del Excel) — igual que el legacy.
                // La evidencia original queda en rejectedRows/rejected? No: el nombre
                // crudo se conserva en source si hiciera falta; el nodo lleva el limpio.
                name: String(a.rawName || '').replace(/\s+/g, ' ').trim(),
                normalizedCode: a.normalizedCode,
                transformations: a.transformations,
                requiresReview: a.requiresReview || info.requiresReview,
                level,
                parent: parent || null,
                // Evidencia auditable del padre: cómo y con qué confianza se obtuvo
                parentInfo: {
                    code: parent || null,
                    method: info.method,
                    confidence: info.confidence,
                    evidence: info.evidence,
                    requiresReview: info.requiresReview
                },
                type: a.typeRaw || AccountPlanProfile.heuristicTypeGuess(a.normalizedCode, {}),
                nature,
                natureConfidence,
                natureReason,
                natureSource: nature === 'EXPLICIT' ? 'source_column' : 'UniversalPlanAnalyzer',
                classification,
                isPostable: postableInfo.status,
                postableConfidence: postableInfo.confidence
            };
        });

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

        // Naturaleza inferida sin confirmación → requiere confirmación.
        // REGLA: si hay CUALQUIER error BLOCK, el contrato jamás está "listo".
        const inferredRoots = nodes.filter(n => n.nature === 'INFERRED' && n.classification === 'ROOT');
        const hasBlocks = errors.some(e => e.severity === 'BLOCK');
        const requiresConfirmation = hasBlocks || inferredRoots.length > 0 || warnings.some(w => w.severity === 'REVIEW');

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

        // ── Data-loss accounting (invariante: dataLossCount === 0) ──
        // dataLossCount = SOLO pérdidas NO inventariadas. Las filas rechazadas
        // con motivo (rejectedRows) NO son pérdida silenciosa: están auditadas.
        const collisions = this.detectIdentityCollisions(
            plausible.map(a => ({ rawCode: a.rawCode, normalizedCode: a.normalizedCode, name: a.rawName }))
        );
        const silentTransformationCount = plausible.filter(a =>
            a.rawCode !== a.normalizedCode && (!a.transformations || a.transformations.length === 0)
        ).length;
        const identityCollisionCount = collisions.filter(c => c.type === 'identityCollision').length;
        const droppedRowCount = rawAccounts.length - plausible.length;
        // unaccountedRows: filas que no están ni en nodes ni en rejectedRows.
        const unaccountedRows = rowsTotal - nodes.length - rejectedRows.length;
        const dataLossCount = silentTransformationCount + identityCollisionCount + unaccountedRows;
        if (droppedRowCount > 0 && !warnings.some(w => String(w).includes('rechazada'))) {
            warnings.push(`${droppedRowCount} filas descartadas (no-código o vacías) — requieren revisión si eran cuentas`);
        }

        return {
            // ═══ VERSIONADO DEL CONTRATO ═══
            contractVersion: CONTRACT_SCHEMA_VERSION,
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            analyzerVersion: ANALYZER_VERSION,

            source: { file: fileName, sheet: sheetName, headers, rowCount: rows.length },
            columnMapping: { codeColumn, nameColumn, parentColumn, typeColumn, confidence: 0.85, ambiguous: false, scored: false, ambiguityMargin: null },
            hierarchy: { separator: analysis.separator, levelLengths: analysis.validLengths || [], levelCount: analysis.levelsCount },
            separator: analysis.separator,
            levels: analysis.validLengths,
            rootNodes,
            nodeCounts: { total: nodes.length, roots: rootNodes.length, groups: groupCount, leaves: leafCount },
            leafCounts: leafCount,
            stats: {
                totalRows: rowsTotal,
                validRows: nodes.length,
                rejectedRows: rejectedRows.length
            },
            nodes,
            transformations: plausible.filter(a => a.transformations.length > 0).map(a => ({ code: a.normalizedCode, transformations: a.transformations })),
            // Inventario de filas descartadas con motivo y severidad (nada desaparece sin razón)
            rejectedRows,
            warnings,
            errors,
            confidence: { overall: overallConfidence, secondBest: analysis.secondBestConfidence || 0, ambiguityMargin: analysis.ambiguityMargin || 0 },
            requiresConfirmation,
            // Contadores fuertes de pérdida (reemplazan al "silentCorruption: 0" débil)
            dataLoss: {
                silentTransformationCount,
                semanticCollisionCount: collisions.filter(c => c.type === 'semanticCollision').length,
                identityCollisionCount: collisions.filter(c => c.type === 'identityCollision').length,
                droppedRowCount,
                droppedCellCount: 0,
                unmappedColumnCount: 0,
                unresolvedNodeCount: unresolved.length,
                dataLossCount,
                // Invariante de reconciliación: total = válidas + rechazadas
                unaccountedRows: rowsTotal - nodes.length - rejectedRows.length,
                collisions
            },
            // Compat con versión anterior (NO usar en código nuevo: ver dataLoss)
            silentCorruptionCount: silentTransformationCount === 0 && dataLossCount === 0 ? 0 : dataLossCount
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Extractor de plan NARRATIVO/DESGLOSADO (PDFs institucionales):
    // líneas que EMPIEZAN con código numérico puro (2-6 dígitos) seguido
    // del nombre de la cuenta. El texto explicativo entre cuentas (párrafos
     // enteros, notas numeradas, continuaciones) NO es cuenta.
    // Ejemplos reales: "1135 Concesión de Préstamos a Corto Plazo..."
    //                  "11000 INGRESOS DE OPERACIÓN" + 5 párrafos
    //                  "13111 En Efectivo"
    // ──────────────────────────────────────────────────────────────
    static extractNarrativeAccounts(lines) {
        const accounts = [];
        // Códigos 1-6 dígitos (el MEFP usa desde "1 ACTIVO" hasta "111229 ...").
        const CODE_RE = /^(\d{1,6})\s+(.+)$/;
        const CODE_ONLY_RE = /^(\d{1,6})$/;
        // Dinámica contable MEFP: matrices "1 1 1 0" (dígitos sueltos
        // separados por espacios) — NO son cuentas.
        const DYNAMICS_RE = /^(\d\s)+\d*$/;

        // Primera pasada: marca cada línea como código (con/sin nombre) o texto
        const marks = lines.map(rawLine => {
            const line = String(rawLine ?? '').replace(/\u00A0/g, ' ').trim();
            if (!line) return { type: 'empty', line };
            const m = line.match(CODE_RE);
            if (m && m[2].trim().length <= 120) {
                // "1 1 1 0" → m[1]="1", m[2]="1 1 0": dinámica, no cuenta
                if (DYNAMICS_RE.test(line)) return { type: 'text', line };
                // Nota al pie MEFP: "N De uso exclusivo..." con N=1 dígito y
                // texto que empieza con "De uso": es la leyenda del plan, no
                // una cuenta hija del código N.
                if (/^De\s+uso\s+exclusivo/i.test(m[2].trim())) {
                    return { type: 'footnote', code: m[1], line };
                }
                return { type: 'code_named', code: m[1], name: m[2].trim(), line };
            }
            const mo = line.match(CODE_ONLY_RE);
            // En modo NARRATIVO un número solo en su línea es número de página
            // o nota, NO una cuenta (el MEFP siempre escribe "código + nombre").
            // Los code_bare quedan SOLO para cuando ya confirmamos jerarquía.
            if (mo) return { type: 'page_number', code: mo[1], line };
            return { type: 'text', line };
        });

        // Segunda pasada: ensambla cuentas, absorbiendo nombres de líneas
        // siguientes cuando el código vino solo, y CONTINUACIONES de nombre
        // (líneas texto inmediatas tras una cuenta sin sentido prosa).
        const result = [];
        let pending = null; // cuenta esperando posible continuación de nombre
        for (const mark of marks) {
            if (mark.type === 'footnote') continue; // leyenda, no cuenta
            if (mark.type === 'page_number') continue; // paginación del documento
            if (mark.type === 'code_named' || mark.type === 'code_bare') {
                if (pending) result.push(pending);
                pending = mark.type === 'code_named'
                    ? { code: mark.code, name: mark.name, rawLine: mark.line }
                    : { code: mark.code, name: '', rawLine: mark.line, continuationLines: 0 };
                continue;
            }
            if (pending) {
                // ¿Continuación del nombre o párrafo explicativo?
                if (mark.type === 'text' && !pending.continuationClosed) {
                    if (pending.name === '' && pending.continuationLines < 2) {
                        // Primera/línea siguiente: es el nombre
                        pending.name = mark.line;
                        pending.continuationLines = 1;
                    } else if (pending.continuationLines === 1 && mark.line.length <= 60) {
                        // Segunda línea corta: continuación del nombre
                        pending.name += ' ' + mark.line;
                        pending.continuationLines = 2;
                    } else {
                        // Párrafo explicativo: cierra la absorción
                        pending.continuationClosed = true;
                    }
                }
                if (mark.type === 'empty') continue;
            }
        }
        if (pending) result.push(pending);

        // Normaliza cuentas sin nombre final
        const accounts2 = result.map(a => ({
            code: a.code,
            name: (a.name || '').trim() || `Cuenta ${a.code}`,
            rawLine: a.rawLine
        }));
        const rejected = marks.filter(m => m.type === 'text').map(m => m.line);
        return { accounts: accounts2, rejected };
    }

    // ──────────────────────────────────────────────────────────────
    // analyzeCanonicalDocument — entrada oficial desde adapters.
    // El analyzer NO conoce xlsx/pdfjs: solo ve CanonicalDocument.
    // ──────────────────────────────────────────────────────────────
    static analyzeCanonicalDocument(doc, opts = {}) {
        if (!doc || !doc.rows || doc.rows.length === 0) {
            return {
                analysis: null,
                error: 'Documento canónico vacío',
                extractionConfidence: 0
            };
        }

        // Detección de regiones/tablas sobre las filas canónicas
        const rawSheet = doc.rows.map(r => r.cells.map(c => c.rawValue));
        const regions = this.detectTableRegions(rawSheet);

        const contracts = [];
        for (const region of regions.regions) {
            const headerRow = doc.rows[region.headerRowIndex];
            const headers = headerRow
                ? headerRow.cells.map(c => c.displayValue ?? c.rawValue).filter(Boolean)
                : [];

            // Elige columnas de código/nombre con heurística de cabecera sobre evidencia canónica
            const codeCol = this._guessCodeColumn(headers, doc.rows, region);
            const nameCol = this._guessNameColumn(headers, codeCol);
            const parentCol = headers.findIndex(h => /padre|parent/i.test(String(h)));

            const dataRows = [];
            for (let r = region.dataStart; r < region.dataEnd && r < doc.rows.length; r++) {
                const row = doc.rows[r];
                const codeCell = row.cells[codeCol];
                const nameCell = row.cells[nameCol];
                const parentCell = parentCol >= 0 ? row.cells[parentCol] : null;
                if (!codeCell) continue;
                dataRows.push({
                    'CODIGO': codeCell.rawValue,
                    'NOMBRE': nameCell ? nameCell.rawValue : null,
                    ...(parentCell ? { 'Cuenta Padre': parentCell.rawValue } : {})
                });
            }
            if (dataRows.length === 0) continue;

            const contract = this.generateImportContract({
                fileName: doc.source.fileName,
                sheetName: doc.source.sheetNames ? doc.source.sheetNames[0] : (doc.source.format === 'pdf' ? `pages` : 'sheet'),
                headers,
                rows: dataRows,
                codeColumn: 'CODIGO',
                nameColumn: 'NOMBRE',
                parentColumn: parentCol >= 0 ? 'Cuenta Padre' : null,
                typeColumn: null
            });
            contract.region = region;
            contracts.push(contract);
        }

        // Ruta narrativa (PDFs institucionales desglosados): líneas completas
        // que empiezan con código + texto explicativo entre cuentas.
        if (doc.source.format === 'pdf' || doc.source.format === 'ocr') {
            const allLines = doc.rows.map(r =>
                r.cells.map(c => c.rawValue).filter(Boolean).join(' ').trim()
            );
            const narrative = this.extractNarrativeAccounts(allLines);
            const narrativePlausible = narrative.accounts.filter(a => this.isPlausibleCode(a.code));

            // Decide ruta: narrativa gana si produce cuentas plausibles con
            // jerarquía detectable (no solo números sueltos de índice/páginas).
            if (narrativePlausible.length >= 10) {
                const hierarchySignal = this._hasRealHierarchy(narrativePlausible.map(a => a.code));
                if (hierarchySignal) {
                    const contract = this.generateImportContract({
                        fileName: doc.source.fileName,
                        sheetName: `${doc.source.format}:narrative`,
                        headers: ['CODIGO', 'NOMBRE'],
                        rows: narrativePlausible.map(a => ({ 'CODIGO': a.code, 'NOMBRE': a.name })),
                        codeColumn: 'CODIGO', nameColumn: 'NOMBRE',
                        parentColumn: null, typeColumn: null
                    });
                    contract.region = {
                        id: 'narrative',
                        headerRowIndex: -1, headers: ['CODIGO', 'NOMBRE'],
                        dataStartRow: 0, dataEndRow: narrativePlausible.length,
                        titleRows: [], extractionMode: 'narrative',
                        rejectedLines: narrative.rejected.length
                    };
                    contracts.push(contract);
                }
            }
        }

        // ImportAnalysis: multi-región, el usuario decide qué región importar
        const allErrors = contracts.flatMap(c => c.errors);
        const analysis = {
            source: doc.source,
            extraction: {
                confidence: doc.extractionConfidence,
                ocrUsed: doc.ocrUsed,
                stats: doc.stats,
                warnings: doc.warnings
            },
            regions: contracts,
            warnings: regions.warnings || [],
            // Preflight gate global: si CUALQUIER región tiene BLOCK → STOP
            preflight: {
                hasBlocks: allErrors.some(e => e.severity === 'BLOCK'),
                blocks: allErrors.filter(e => e.severity === 'BLOCK'),
                reviewCount: contracts.reduce((s, c) => s + (c.warnings || []).filter(w => w.severity === 'REVIEW').length, 0),
                decision: allErrors.some(e => e.severity === 'BLOCK') ? 'STOP' :
                    (contracts.some(c => c.requiresConfirmation) ? 'USER_CONFIRM' : 'CONTINUE')
            }
        };

        // Regla de OCR: confianza baja → JAMÁS auto-import
        if (doc.ocrUsed && doc.extractionConfidence < 0.5) {
            analysis.preflight.decision = 'USER_CONFIRM';
            analysis.preflight.reviewCount += 1;
            analysis.warnings.push('OCR con confianza < 0.5: revisión humana obligatoria');
        }

        return analysis;
    }

    // ¿Un conjunto de códigos muestra jerarquía real? (prefijos compartidos)
    // Evita que un índice de páginas ("12", "22", "23"...) se tome como plan.
    // Acepta DOS tipos de jerarquía:
    //  a) prefijo textual literal (1 → 11 → 111)
    //  b) "pad-to-block" (13111 → 13110 → 13100 → 13000), el estilo de los
    //     clasificadores presupuestarios bolivianos y del PUCT de 9 dígitos.
    static _hasRealHierarchy(codes) {
        if (!codes || codes.length < 10) return false;
        const set = new Set(codes);
        let withParent = 0;
        for (const code of set) {
            let found = false;
            for (let len = 1; len < code.length; len++) {
                if (set.has(code.substring(0, len))) { found = true; break; } // a)
            }
            if (!found && this._inferBlockParent(code, set)) found = true;   // b)
            if (found) withParent++;
        }
        return (withParent / set.size) >= 0.25;
    }

    // Inferencia "pad-to-block": el padre de un código numérico puro es el
    // código existente más cercano que se obtiene truncando por la derecha y
    // rellenando con ceros hasta la longitud original (excluye self).
    // Ej.: 13111 → truncar "1311" → rellenar 5 → "13110" (existe) ✓
    //      13110 → truncar "131" → "13100" (existe) ✓
    //      11100 → truncar "11" → "11000" (existe) ✓   [Clasificador rubros]
    //      111001001 (PUCT 9d) → truncar → "111001000" (existe) ✓
    static _inferBlockParent(code, codeSet) {
        if (!/^\d+$/.test(code) || !codeSet || codeSet.size === 0) return null;
        for (let keep = code.length - 1; keep >= 1; keep--) {
            const prefix = code.substring(0, keep);
            const padded = prefix.padEnd(code.length, '0');
            if (padded !== code && codeSet.has(padded)) return padded;
        }
        return null;
    }

    // Evidencia contextual de pad-to-block: la relación matemática NO basta.
    // Exige consistencia con el documento (hermanos/raíz del mismo bloque).
    static _padBlockEvidence(code, parent, codeSet) {
        const reasons = [];
        if (code === parent) { reasons.push('self_parent'); return { accepted: false, confidence: 0, reasons }; }
        if (!codeSet.has(parent)) { reasons.push('parent_not_in_doc'); return { accepted: false, confidence: 0, reasons }; }
        if (!/^\d+$/.test(code) || !/^\d+$/.test(parent)) { reasons.push('not_numeric'); return { accepted: false, confidence: 0, reasons }; }
        if (code.length !== parent.length) { reasons.push('length_mismatch'); return { accepted: false, confidence: 0, reasons }; }

        const delta = Number(code) - Number(parent);
        if (!(delta > 0 && delta < 10000)) { reasons.push('delta_out_of_range'); return { accepted: false, confidence: 0, reasons }; }

        // ¿El padre es un "contenedor" (termina en 00 / 0 según nivel)?
        const parentZeros = (parent.match(/0+$/)?.[0] || '').length;
        const codeZeroTrim = code.replace(/0+$/, '');
        const parentZeroTrim = parent.replace(/0+$/, '');
        if (codeZeroTrim === parentZeroTrim) { reasons.push('same_stem'); return { accepted: false, confidence: 0, reasons }; }
        // ¿Padre comparte prefijo no-cero con el hijo? (familia real)
        const sharedPrefix = codeZeroTrim.startsWith(parentZeroTrim) || parentZeroTrim.startsWith(codeZeroTrim);
        // GUARDA ANTI-HERMANOS-RAÍZ: si el código y el padre tienen la MISMA
        // cantidad de dígitos significativos, son hermanos del mismo nivel,
        // NO padre-hijo. Ej. PGC: "10" (stem "1") y "11" (stem "1") son dos
        // raíces hermanas; "100" (stem "1" pero length 3) SÍ es hijo de "10".
        // En "10" vs "100": lengths difieren (2 vs 3) pero stems son "1" y "1".
        // La distinción real: el código debe ser ESTRICTAMENTE más largo que el
        // padre (length mayor) para ser hijo legítimo.
        if (code.length <= parent.length) {
            // Misma longitud (MEFP 13111→13110) se permite SOLO si el padre es
            // un contenedor con ceros finales y comparten todo el stem salvo
            // los últimos dígitos (el hijo es variante del bloque).
            const codeStem = codeZeroTrim;
            const parentStem = parentZeroTrim;
            const parentIsContainer = parentZeros >= 1;
            const sharesFullStem = codeStem.startsWith(parentStem) && codeStem.length > parentStem.length;
            // GUARDA ANTI-CLASE: si el stem del padre tiene 1 solo dígito
            // (PGC "10"→base "1"), cualquier código de la misma longitud
            // comparte ese stem → serían TODOS hijos de la misma raíz (10, 11,
            // 12... todos colgarían de "1X"). Eso colapsa la clase: rechazar.
            const parentBaseTooShort = parentStem.length <= 1 && code.length >= 2;
            if (!(parentIsContainer && sharesFullStem) || parentBaseTooShort) {
                return { accepted: false, confidence: 0, reasons: ['same_level_sibling'], details: { siblingCount: 0, parentZeros, sharedPrefix } };
            }
        }
        const siblingCount = [...codeSet].filter(c => c !== code && c !== parent && this._inferBlockParent(c, codeSet) === parent).length;
        // EVIDENCIA MÍNIMA: un bloque real tiene ≥1 hermano bajo el mismo padre.
        // Sin hermanos, la relación es matemáticamente posible pero NO hay
        // contexto que la respalde → se rechaza (jamás inventar padre).
        if (siblingCount === 0) {
            return { accepted: false, confidence: 0, reasons: ['no_siblings_context'], details: { siblingCount: 0, parentZeros, sharedPrefix } };
        }
        const confidence = (sharedPrefix ? 0.6 : 0.2) + Math.min(0.4, siblingCount * 0.15);
        const accepted = sharedPrefix && parentZeros >= 0;
        return {
            accepted,
            confidence: Math.min(1, confidence),
            reasons: accepted ? [] : ['weak_contextual_evidence'],
            details: { siblingCount, parentZeros, sharedPrefix, delta }
        };
    }

    // Versión eficiente (caché de hermanos por bloque) usada en el mapa de padres.
    static _resolveParentWithMethodFast(code, codeSet, effectiveParentMap, parentMap, config, blockParentOf, blockChildCount) {
        // 1) EXPLICIT
        const explicit = (effectiveParentMap && effectiveParentMap[code]) || (parentMap && parentMap[code]);
        if (explicit && codeSet.has(String(explicit)) && String(explicit) !== code) {
            return { parent: String(explicit), method: 'EXPLICIT_PARENT', confidence: 1.0, evidence: ['source_parent_column'], requiresReview: false };
        }
        // 2) calculateParent clásico por defecto (SEGMENT/PREFIX/longitud).
        //    Excepción: si el documento tiene señal de bloques (MEFP) y el
        //    blockAlt existe, difiere del calc y es aceptado por evidencia,
        //    el bloque gana (13110→13100, no el 13000 de la heurística).
        const calc = AccountPlanProfile.calculateParent(code, config);
        const calcOk = calc && codeSet.has(String(calc)) && String(calc) !== code;
        const blockAlt = blockParentOf.get(code) || null;
        // Evaluación de bloque O(1) con hijos precomputados
        let blockAccepted = null;
        if (blockAlt && codeSet.has(String(blockAlt)) && String(blockAlt) !== code) {
            blockAccepted = this._evaluateBlockPrecomputed(code, blockAlt, codeSet, blockChildCount);
        }
        if (calcOk && (!blockAccepted || !blockAccepted.accepted || blockAlt === calc)) {
            const method = config.hasSeparator ? 'SEGMENT' : 'PREFIX';
            return { parent: String(calc), method, confidence: 0.85, evidence: ['structural_hierarchy'], requiresReview: false };
        }
        if (blockAccepted && blockAccepted.accepted) {
            const hasBlockSig = this._hasBlockSignal(code, codeSet);
            return {
                parent: blockAlt, method: 'PAD_TO_BLOCK', confidence: blockAccepted.confidence,
                evidence: ['zero_padded_block', `siblings=${blockAccepted.details.siblingCount}`],
                requiresReview: blockAccepted.confidence < 0.7 || (calcOk && hasBlockSig && blockAlt !== calc)
            };
        }
        if (blockAccepted && !blockAccepted.accepted) {
            return { parent: null, method: 'PAD_TO_BLOCK_REJECTED', confidence: blockAccepted.confidence, evidence: blockAccepted.reasons, requiresReview: true };
        }
        // 2.5) SEGMENT_PAD: códigos CON separador donde el calc (truncado a
        //      "100") no está materializado. El plan real lista contenedores
        //      con ceros ("100-00-00"). Padre = cero del último segmento
        //      significativo, buscando en el set (100-10-01→100-10-00,
        //      100-10-00→100-00-00). Solo se aplica si el candidato existe.
        if (config.hasSeparator && code.includes(config.separator)) {
            const sep = config.separator;
            const segments = code.split(sep);
            for (let i = segments.length - 1; i >= 1; i--) {
                // Si este segmento es significativo, proponer cerearlo a partir de aquí
                if (!/^0+$/.test(segments[i])) {
                    const candidate = [...segments.slice(0, i), ...segments.slice(i).map(() => '0'.repeat(segments[i].length))].join(sep);
                    if (candidate !== code && codeSet.has(candidate)) {
                        return { parent: candidate, method: 'SEGMENT_PAD', confidence: 0.9, evidence: [`zero_padded_segment@${i}`], requiresReview: false };
                    }
                }
            }
        }
        if (calcOk) {
            const method = config.hasSeparator ? 'SEGMENT' : 'PREFIX';
            return { parent: String(calc), method, confidence: 0.85, evidence: ['structural_hierarchy'], requiresReview: false };
        }
        return { parent: null, method: 'OTHER', confidence: 0, evidence: ['no_parent_found'], requiresReview: true };
    }

    // Evaluación de bloque con contadores precomputados (O(1), sin iterar codeSet)
    static _evaluateBlockPrecomputed(code, parent, codeSet, blockChildCount) {
        if (code === parent) return { accepted: false, confidence: 0, reasons: ['self_parent'], details: { siblingCount: 0 } };
        if (!/^\d+$/.test(code) || !/^\d+$/.test(parent)) return { accepted: false, confidence: 0, reasons: ['not_numeric'], details: { siblingCount: 0 } };
        const parentZeros = (parent.match(/0+$/)?.[0] || '').length;
        const codeZeroTrim = code.replace(/0+$/, '');
        const parentZeroTrim = parent.replace(/0+$/, '');
        if (codeZeroTrim === parentZeroTrim) return { accepted: false, confidence: 0, reasons: ['same_stem'], details: { siblingCount: 0 } };
        const sharedPrefix = codeZeroTrim.startsWith(parentZeroTrim) || parentZeroTrim.startsWith(codeZeroTrim);
        if (code.length <= parent.length) {
            const parentIsContainer = parentZeros >= 1;
            const sharesFullStem = codeZeroTrim.startsWith(parentZeroTrim) && codeZeroTrim.length > parentZeroTrim.length;
            const parentBaseTooShort = parentZeroTrim.length <= 1 && code.length >= 2;
            if (!(parentIsContainer && sharesFullStem) || parentBaseTooShort) {
                return { accepted: false, confidence: 0, reasons: ['same_level_sibling'], details: { siblingCount: 0 } };
            }
        }
        const siblingCount = Math.max(0, (blockChildCount.get(parent) || 1) - 1); // resto de hijos bajo el mismo bloque
        if (siblingCount === 0) {
            return { accepted: false, confidence: 0, reasons: ['no_siblings_context'], details: { siblingCount: 0 } };
        }
        const confidence = (sharedPrefix ? 0.6 : 0.2) + Math.min(0.4, siblingCount * 0.15);
        const accepted = sharedPrefix;
        return {
            accepted,
            confidence: Math.min(1, confidence),
            reasons: accepted ? [] : ['weak_contextual_evidence'],
            details: { siblingCount, parentZeros, sharedPrefix }
        };
    }

    // Señal documental de bloques: si ≥40% de códigos numéricos de la misma
    // longitud son hijos de un bloque (pad-to-block) con hermanos, el documento
    // usa el patrón de bloques (clasificador MEFP) y debe ganar sobre la
    // heurística de longitud genérica.
    // Cache por dataset: la señal es una propiedad del CONJUNTO, no del código.
    // Calcularla por nodo era O(n²) por llamada → O(n³) total (minutos en 100k).
    static _blockSignalCache = new WeakMap();
    static _hasBlockSignal(code, codeSet) {
        if (!/^\d+$/.test(code) || codeSet.size < 6) return false;
        let cached = this._blockSignalCache.get(codeSet);
        if (cached !== undefined) return cached;
        const sameLen = [...codeSet].filter(c => c.length === code.length && /^\d+$/.test(c));
        if (sameLen.length < 6) { this._blockSignalCache.set(codeSet, false); return false; }
        const parentCounts = new Map();
        for (const c of sameLen) {
            const p = this._inferBlockParent(c, codeSet);
            if (p) parentCounts.set(p, (parentCounts.get(p) || 0) + 1);
        }
        let blockChildren = 0;
        for (const cnt of parentCounts.values()) {
            if (cnt >= 2) blockChildren += cnt; // bloques con ≥2 hijos
        }
        const result = blockChildren / sameLen.length >= 0.4;
        this._blockSignalCache.set(codeSet, result);
        return result;
    }

    // Resolución de padre con método + confianza auditable.
    static _resolveParentWithMethod(code, codeSet, effectiveParentMap, parentMap, config) {
        // 1) EXPLICIT (ya fuzzy-resuelto)
        const explicit = (effectiveParentMap && effectiveParentMap[code]) || (parentMap && parentMap[code]);
        if (explicit && codeSet.has(String(explicit)) && String(explicit) !== code) {
            return { parent: String(explicit), method: 'EXPLICIT_PARENT', confidence: 1.0, evidence: ['source_parent_column'], requiresReview: false };
        }
        // 2) calculateParent clásico (SEGMENT o PREFIX según config)
        const calc = AccountPlanProfile.calculateParent(code, config);
        if (calc && codeSet.has(String(calc)) && String(calc) !== code) {
            const method = config.hasSeparator ? 'SEGMENT' : 'PREFIX';
            return { parent: String(calc), method, confidence: 0.85, evidence: ['structural_hierarchy'], requiresReview: false };
        }
        // 3) PAD_TO_BLOCK con evidencia contextual
        const blockParent = this._inferBlockParent(code, codeSet);
        if (blockParent) {
            const ev = this._padBlockEvidence(code, blockParent, codeSet);
            if (ev.accepted) {
                return {
                    parent: blockParent, method: 'PAD_TO_BLOCK', confidence: ev.confidence,
                    evidence: ['zero_padded_block', `siblings=${ev.details.siblingCount}`, `delta=${ev.details.delta}`],
                    requiresReview: ev.confidence < 0.7
                };
            }
            return {
                parent: null, method: 'PAD_TO_BLOCK_REJECTED', confidence: ev.confidence,
                evidence: ev.reasons, requiresReview: true
            };
        }
        // 4) Sin padre inferible
        return { parent: null, method: 'OTHER', confidence: 0, evidence: ['no_parent_found'], requiresReview: true };
    }

    static _guessCodeColumn(headers, rows, region) {
        const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // 1) cabecera explícita
        const idx = headers.findIndex(h => { const n = norm(h); return /codigo|c[oó]digo|code/.test(n); });
        if (idx >= 0) return idx;
        // 2) primera columna con alta densidad de códigos plausibles en la región
        const sample = rows.slice(region.dataStart, Math.min(region.dataEnd, region.dataStart + 30));
        let best = 0, bestScore = -1;
        const maxCols = Math.min(8, (sample[0]?.cells.length) || 1);
        for (let c = 0; c < maxCols; c++) {
            let plausible = 0, total = 0;
            for (const r of sample) {
                const cell = r.cells[c];
                if (!cell || cell.rawValue === null) continue;
                total++;
                if (this.isPlausibleCode(this.sanitizeCode(cell.rawValue))) plausible++;
            }
            const score = total > 0 ? plausible / total : 0;
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return bestScore > 0.5 ? best : 0;
    }

    static _guessNameColumn(headers, codeCol) {
        const norm = h => String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const idx = headers.findIndex(h => { const n = norm(h); return /nombre|descripcion|detalle|cuenta/.test(n) && !/padre/.test(n); });
        if (idx >= 0) return idx;
        return codeCol === 0 ? 1 : 0;
    }

    // ──────────────────────────────────────────────────────────────
    // generateBulkPayload — ImportContract → payload /api/accounts/bulk
    // PREFLIGHT GATE: ningún BLOCK puede llegar al backend. Devuelve
    // { allowed: false } si hay errores bloqueantes. El importer NO
    // re-infiere nada: consume nodes tal cual.
    // ──────────────────────────────────────────────────────────────
    static generateBulkPayload(contract, companyId, { confirmedNatureMap = null } = {}) {
        const blocks = (contract.errors || []).filter(e => e.severity === 'BLOCK');
        if (blocks.length > 0) {
            return {
                allowed: false,
                reason: 'BLOCK errors present — preflight gate',
                blocks,
                payload: null
            };
        }
        if (contract.requiresConfirmation && !confirmedNatureMap) {
            return {
                allowed: false,
                reason: 'requiresConfirmation — naturalezas INFERRED sin confirmar',
                blocks: [],
                payload: null
            };
        }
        // Si el usuario confirmó las naturalezas de TODAS las raíces INFERRED,
        // los REVIEW restantes de naturaleza quedan resueltos. Los REVIEW
        // estructurales (implicitMissingParent, IMPLICIT_LEVEL_GAP) NO bloquean
        // el payload: se importan tal cual y quedan en warnings del contrato.
        if (contract.requiresConfirmation && confirmedNatureMap) {
            const inferredRoots = contract.nodes.filter(
                n => n.nature === 'INFERRED' && n.classification === 'ROOT'
            );
            const allConfirmed = inferredRoots.every(n => confirmedNatureMap[n.normalizedCode]);
            if (!allConfirmed) {
                return {
                    allowed: false,
                    reason: 'requiresConfirmation — faltan naturalezas raíz por confirmar',
                    blocks: [],
                    payload: null
                };
            }
        }

        const accounts = contract.nodes.map(n => {
            const typeValue = (confirmedNatureMap && confirmedNatureMap[n.code]) || n.type;
            return {
                code: n.normalizedCode,
                name: n.name,
                type: typeValue,
                level: n.level,
                parent_code: n.parent || null
            };
        });

        return {
            allowed: true,
            payload: { companyId, accounts },
            expectedCounts: {
                total: accounts.length,
                roots: contract.nodeCounts.roots,
                groups: contract.nodeCounts.groups,
                leaves: contract.nodeCounts.leaves
            }
        };
    }
}
