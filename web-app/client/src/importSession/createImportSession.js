/**
 * importSession/createImportSession.js — Capa de dominio de la sesión de importación.
 *
 * Fase 7 (U-1). Capa PURA: sin React, sin DOM, sin red, sin I/O y sin
 * almacenamiento persistente del navegador.
 *
 * REGLA DE ORO: esta capa NO analiza, NO parsea, NO infiere, NO valida contratos
 * y NO genera inteligencia nueva. Se limita a administrar:
 *
 *     ImportContract (original, inmutable)
 *     + UserOverrides (ediciones/confirmaciones/resoluciones con traza)
 *     + Effective Contract (derivado determinista)
 *     + simulación/resumen (bajo demanda)
 *
 * Toda inteligencia sigue viviendo en:
 *     FormatAdapter → CanonicalDocument → UniversalPlanAnalyzer
 *     → ImportContractValidator → CompatibilityAdapter
 *
 * Invariantes:
 *   1. contract original es inmutable (deep-frozen al crear la sesión).
 *   2. Los overrides jamás mutan el Contract original.
 *   3. Cada override conserva { uid, field, originalValue, value, at }.
 *   4. Excluir una fila NO renumera nodos: uid = `${regionId}:${nodeIndex}` estable.
 *   5. effectiveContract es SIEMPRE derivable de forma determinista.
 *   6. simulate() usa EXCLUSIVAMENTE CompatibilityAdapter.toBulkPayload(...)
 *      y jamás toca la red.
 *   7. Misma entrada + mismas operaciones = mismo resultado (salvo at).
 *
 * Los updaters son puros: devuelven una sesión NUEVA; nunca mutan la anterior.
 */

import { CompatibilityAdapter } from '../utils/CompatibilityAdapter.js';
import { contractFingerprint } from '../utils/ImportContractSchema.js';

const EDITABLE_FIELDS = new Set(['code', 'name', 'type', 'level']);

// ─────────────────────────────────────────────────────────────
// Utilidades internas
// ─────────────────────────────────────────────────────────────

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Congela en profundidad estructuras JSON-plain (no funciones/Date). */
function deepFreeze(value) {
    if (!isPlainObject(value) && !Array.isArray(value)) return value;
    for (const k of Object.keys(value)) {
        deepFreeze(value[k]);
    }
    return Object.freeze(value);
}

function nowOf(session) {
    return typeof session._now === 'function' ? session._now() : Date.now();
}

/** Deriva un regionId determinista y seguro (sin ':'). */
function sanitizeRegionId(base) {
    const clean = String(base ?? '')
        .replace(/:/g, '_')
        .replace(/[^A-Za-z0-9_.\-]/g, '_')
        .slice(0, 60);
    return clean || 'region';
}

function uidOf(regionId, nodeIndex) {
    return `${regionId}:${nodeIndex}`;
}

/** Convierte la entrada de regiones en entradas internas normalizadas. */
function normalizeRegions(regions) {
    if (!Array.isArray(regions) || regions.length === 0) {
        throw new TypeError('ImportSession: se requiere al menos una región');
    }
    const used = new Set();
    return regions.map((item, i) => {
        const contract = item && typeof item === 'object' && item.contract ? item.contract : item;
        if (!contract || !Array.isArray(contract.nodes)) {
            throw new TypeError(`ImportSession: región ${i} no contiene un ImportContract con nodes[]`);
        }
        const base = item && typeof item === 'object' && item.regionId
            ? item.regionId
            : (contract.region && contract.region.id) || `region_${i}`;
        let regionId = sanitizeRegionId(base);
        let n = 1;
        while (used.has(regionId)) {
            regionId = sanitizeRegionId(`${base}_${n++}`);
        }
        used.add(regionId);
        const meta = (item && typeof item === 'object' && item.meta) || {};
        return {
            regionId,
            meta: Object.assign(
                {
                    extractionMode: contract.region?.extractionMode || 'table',
                    sheet: contract.source?.sheet ?? null,
                    fileName: contract.source?.file ?? null
                },
                meta
            ),
            contract: deepFreeze(contract)
        };
    });
}

function findRegion(session, regionId) {
    if (!session || !Array.isArray(session.regions)) {
        throw new TypeError('ImportSession: sesión inválida');
    }
    const target = regionId ?? session.activeRegionId;
    const region = session.regions.find(r => r.regionId === target);
    if (!region) {
        throw new TypeError(`ImportSession: región desconocida "${target}"`);
    }
    return region;
}

function parseUid(session, uid) {
    const sep = typeof uid === 'string' ? uid.lastIndexOf(':') : -1;
    if (sep <= 0 || sep === uid.length - 1) {
        throw new TypeError(`ImportSession: uid inválido "${uid}" (formato esperado regionId:nodeIndex)`);
    }
    const regionId = uid.slice(0, sep);
    const indexStr = uid.slice(sep + 1);
    if (!/^\d+$/.test(indexStr)) {
        throw new TypeError(`ImportSession: uid inválido "${uid}" (nodeIndex debe ser entero)`);
    }
    const nodeIndex = Number.parseInt(indexStr, 10);
    const region = session.regions.find(r => r.regionId === regionId);
    if (!region) {
        throw new TypeError(`ImportSession: región desconocida en uid "${uid}"`);
    }
    if (!region.contract.nodes[nodeIndex]) {
        throw new TypeError(`ImportSession: nodo ${nodeIndex} inexistente en región "${regionId}"`);
    }
    return { region, nodeIndex };
}

/** Copia profunda JSON-plain (los contracts son deep-frozen y puros). */
function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (isPlainObject(value)) {
        const out = {};
        for (const k of Object.keys(value)) out[k] = clonePlain(value[k]);
        return out;
    }
    return value;
}

/** Mantiene SOLO issues clave-código cuyo código sigue presente en nodes. */
function clearCodeKeyedIssues(issues, codesPresent) {
    return (issues || []).filter(issue => {
        if (issue && typeof issue === 'object' && typeof issue.code === 'string' && issue.code) {
            return codesPresent.has(issue.code);
        }
        return true;
    });
}

function sessionExcludedUids(session, region) {
    const prefix = `${region.regionId}:`;
    return new Set(session.exclusions.filter(u => u.startsWith(prefix)));
}

function sessionOverridesOf(session, region) {
    return session.overrides.filter(o => o.regionId === region.regionId);
}

function sessionNatureConfirmationsOf(session, region) {
    return session.natureConfirmations.filter(e => e.regionId === region.regionId);
}

function sessionReviewResolutionsOf(session, region) {
    return session.reviewResolutions.filter(r => r.regionId === region.regionId);
}

/** Deriva el contrato efectivo (puro, determinista). Nunca muta el original. */
function effectiveRegionContract(session, region) {
    const c = region.contract;
    const excludedUids = sessionExcludedUids(session, region);
    const overrideMap = new Map(); // uid -> { field -> value }
    for (const ov of sessionOverridesOf(session, region)) {
        if (excludedUids.has(ov.uid)) continue;
        if (!overrideMap.has(ov.uid)) overrideMap.set(ov.uid, {});
        overrideMap.get(ov.uid)[ov.field] = ov.value;
    }
    const natureMap = new Map(); // uid -> nature (tipo confirmado)
    for (const conf of sessionNatureConfirmationsOf(session, region)) {
        if (excludedUids.has(conf.uid)) continue;
        natureMap.set(conf.uid, conf.nature);
    }

    const codesPresent = new Set();
    const nodes = [];
    for (let index = 0; index < c.nodes.length; index++) {
        if (excludedUids.has(uidOf(region.regionId, index))) continue;
        const node = c.nodes[index];
        const uid = uidOf(region.regionId, index);
        const out = {
            code: node.code,
            rawCode: node.rawCode,
            name: node.name,
            normalizedCode: node.normalizedCode,
            transformations: node.transformations ? node.transformations.slice() : [],
            requiresReview: node.requiresReview,
            level: node.level,
            parent: node.parent,
            parentInfo: node.parentInfo
                ? { ...node.parentInfo, evidence: (node.parentInfo.evidence || []).slice() }
                : { code: null, method: 'OTHER', confidence: 0, evidence: [], requiresReview: true },
            type: node.type,
            nature: node.nature,
            natureConfidence: node.natureConfidence,
            natureReason: node.natureReason,
            natureSource: node.natureSource,
            classification: node.classification,
            isPostable: node.isPostable,
            postableConfidence: node.postableConfidence
        };
        const ov = overrideMap.get(uid);
        if (ov) {
            if ('code' in ov) { out.code = ov.code; out.normalizedCode = ov.code; }
            if ('name' in ov) out.name = ov.name;
            if ('type' in ov) out.type = ov.type;
            if ('level' in ov) out.level = ov.level;
        }
        if (natureMap.has(uid)) {
            out.type = natureMap.get(uid);
        }
        codesPresent.add(out.normalizedCode);
        nodes.push(out);
    }

    const errors = clearCodeKeyedIssues(c.errors || [], codesPresent);
    const warnings = clearCodeKeyedIssues(c.warnings || [], codesPresent);
    const rootCount = nodes.filter(n => n.classification === 'ROOT').length;
    const groupCount = nodes.filter(n => n.classification === 'GROUP').length;
    const leafCount = nodes.filter(n => n.classification === 'LEAF').length;

    return {
        contractVersion: c.contractVersion,
        schemaVersion: c.schemaVersion,
        analyzerVersion: c.analyzerVersion,
        source: c.source ? clonePlain(c.source) : undefined,
        columnMapping: c.columnMapping ? clonePlain(c.columnMapping) : undefined,
        hierarchy: c.hierarchy ? clonePlain(c.hierarchy) : undefined,
        separator: c.separator,
        levels: c.levels ? c.levels.slice() : [],
        rootNodes: nodes.filter(n => n.classification === 'ROOT').map(n => n.code),
        nodeCounts: { total: nodes.length, roots: rootCount, groups: groupCount, leaves: leafCount },
        leafCounts: leafCount,
        stats: c.stats ? { ...c.stats, validRows: nodes.length } : undefined,
        nodes,
        transformations: nodes
            .filter(n => n.transformations && n.transformations.length > 0)
            .map(n => ({ code: n.code, transformations: n.transformations })),
        rejectedRows: c.rejectedRows ? clonePlain(c.rejectedRows) : [],
        warnings,
        errors,
        confidence: c.confidence ? clonePlain(c.confidence) : undefined,
        requiresConfirmation: c.requiresConfirmation
            && nodes.some(n => n.nature === 'INFERRED' && n.classification === 'ROOT'),
        dataLoss: c.dataLoss ? clonePlain(c.dataLoss) : undefined,
        silentCorruptionCount: c.silentCorruptionCount ?? 0,
        region: c.region ? clonePlain(c.region) : undefined,
        _originalNodeCount: c.nodes.length
    };
}

function confirmedNatureMapOf(session, region) {
    const map = {};
    const excludedUids = sessionExcludedUids(session, region);
    for (const conf of sessionNatureConfirmationsOf(session, region)) {
        if (excludedUids.has(conf.uid)) continue;
        map[conf.code] = conf.nature;
    }
    return map;
}

/** Motivos de bloqueo (semántica estricta de canImport). No valida: solo lee. */
function gateReasons(session, region) {
    const c = region.contract;
    const effective = effectiveRegionContract(session, region);
    const reasons = [];
    const excludedUids = sessionExcludedUids(session, region);
    const resolvedNodes = new Set(sessionReviewResolutionsOf(session, region).filter(r => r.uid).map(r => r.uid));
    const resolvedWarnKeys = new Set(sessionReviewResolutionsOf(session, region).filter(r => r.warnKey).map(r => r.warnKey));
    const confirmedUids = new Set(sessionNatureConfirmationsOf(session, region).map(e => e.uid));

    // 1) BLOCK sin resolver (presentes en el contrato efectivo)
    const blocks = effective.errors.filter(e => e && e.severity === 'BLOCK');
    if (blocks.length > 0) {
        reasons.push(`BLOCK sin resolver (${blocks.length}): ${blocks.map(b => b.code || `${b.from}→${b.to}`).join(', ')}`);
    }

    // 2) REVIEW de warnings (severity REVIEW del contrato original) sin resolución
    for (let wi = 0; wi < c.warnings.length; wi++) {
        const warn = c.warnings[wi];
        if (!warn || typeof warn !== 'object' || warn.severity !== 'REVIEW') continue;
        if (typeof warn.code === 'string' && warn.code && !effective.warnings.includes(warn)) {
            continue; // su código fue excluido por completo → el issue ya no aplica
        }
        const warnKey = `${region.regionId}:w${wi}`;
        if (!resolvedWarnKeys.has(warnKey)) {
            reasons.push(`REVIEW sin resolver (${warn.type || 'review'}: ${warn.code || warn.message})`);
        }
    }

    // 3) REVIEW por nodo (requiresReview / parentInfo.requiresReview) sin resolución
    for (let index = 0; index < c.nodes.length; index++) {
        const node = c.nodes[index];
        const uid = uidOf(region.regionId, index);
        if (excludedUids.has(uid)) continue;
        if (node.requiresReview || (node.parentInfo && node.parentInfo.requiresReview)) {
            if (!resolvedNodes.has(uid)) {
                reasons.push(`REVIEW de nodo sin resolver (${uid}: ${node.code}, método ${node.parentInfo?.method || '?'})`);
            }
        }
    }

    // 4) UNKNOWN (isPostable === 'UNKNOWN') sin confirmación de naturaleza
    for (let index = 0; index < c.nodes.length; index++) {
        const node = c.nodes[index];
        const uid = uidOf(region.regionId, index);
        if (excludedUids.has(uid)) continue;
        if (node.isPostable === 'UNKNOWN' && !confirmedUids.has(uid)) {
            reasons.push(`UNKNOWN sin confirmar (${uid}: ${node.code})`);
        }
    }

    // 5) Naturalezas raíz INFERRED sin confirmar (requiresConfirmation)
    if (effective.requiresConfirmation) {
        const map = confirmedNatureMapOf(session, region);
        const missing = effective.nodes.filter(n => n.nature === 'INFERRED' && n.classification === 'ROOT' && !map[n.normalizedCode]);
        if (missing.length > 0) {
            reasons.push(`Naturalezas raíz INFERRED sin confirmar (${missing.map(n => n.normalizedCode).join(', ')})`);
        }
    }

    // 6) silentCorruptionCount !== 0
    if ((c.silentCorruptionCount ?? 0) !== 0) {
        reasons.push(`silentCorruptionCount=${c.silentCorruptionCount} (debe ser 0)`);
    }

    // 7) unaccountedRows !== 0
    if ((c.dataLoss?.unaccountedRows ?? 0) !== 0) {
        reasons.push(`unaccountedRows=${c.dataLoss.unaccountedRows} (debe ser 0)`);
    }

    return reasons;
}

// ─────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────

/**
 * Crea una sesión a partir de los contracts (regiones) que ya produjo el engine.
 *
 * @param {object} opts
 * @param {object} [opts.source]           metadatos del archivo (opacos)
 * @param {object} [opts.extraction]       resumen de extracción (opacos)
 * @param {Array}  opts.regions            ImportContract[]  ó
 *                                         [{ regionId, meta, contract }]
 * @param {string} [opts.activeRegionId]   región activa inicial (default: primera)
 * @param {Function} [opts.now]            reloj inyectable para determinismo (tests)
 */
export function createImportSession({ source, extraction, regions, activeRegionId, now } = {}) {
    if (!Array.isArray(regions) || regions.length === 0) {
        throw new TypeError('ImportSession: createImportSession requiere regions[] no vacío');
    }
    const normalized = normalizeRegions(regions);
    const first = normalized[0].regionId;
    const active = activeRegionId ?? first;
    if (!normalized.some(r => r.regionId === active)) {
        throw new TypeError(`ImportSession: activeRegionId "${active}" no existe en regions[]`);
    }
    const session = {
        id: `s_${typeof now === 'function' ? now() : Date.now()}_${normalized.map(r => r.regionId).join('+')}`,
        createdAt: typeof now === 'function' ? now() : Date.now(),
        source: source ? deepFreeze(clonePlain(source)) : null,
        extraction: extraction ? deepFreeze(clonePlain(extraction)) : null,
        regions: normalized,
        activeRegionId: active,
        overrides: [],            // { uid, regionId, nodeIndex, field, originalValue, value, at }
        exclusions: [],           // uids `${regionId}:${nodeIndex}` (NO renumera)
        natureConfirmations: [],  // { uid, regionId, nodeIndex, code, nature, at }
        reviewResolutions: []     // { uid?, warnKey?, regionId, decision, at }
    };
    if (typeof now === 'function') session._now = now;
    return deepFreeze(session);
}

/** Cambia la región activa. Los overrides de otras regiones se conservan. */
export function selectRegion(session, regionId) {
    const region = findRegion(session, regionId);
    if (region.regionId === session.activeRegionId) return session;
    return { ...session, activeRegionId: region.regionId };
}

/**
 * Registra un override de usuario con traza. NO muta el Contract original.
 * @param {string} field  uno de: code | name | type | level
 */
export function applyOverride(session, uid, field, value) {
    if (!EDITABLE_FIELDS.has(field)) {
        throw new TypeError(`ImportSession: campo no editable "${field}" (permitidos: code, name, type, level)`);
    }
    if (value === undefined || value === null || value === '') {
        throw new TypeError(`ImportSession: override sin valor para "${field}"`);
    }
    const { region, nodeIndex } = parseUid(session, uid);
    const existing = session.overrides.find(o => o.uid === uid && o.field === field);
    if (existing && String(existing.value) === String(value)) return session; // no-op determinista
    const originalValue = existing ? existing.originalValue : region.contract.nodes[nodeIndex][field];

    const next = session.overrides.filter(o => !(o.uid === uid && o.field === field));
    next.push({
        uid,
        regionId: region.regionId,
        nodeIndex,
        field,
        originalValue,
        value,
        at: nowOf(session)
    });
    return { ...session, overrides: next };
}

/** Excluye (o re-incluye con excluded=false) una fila. NO renumera nodos. */
export function excludeRow(session, uid, excluded = true) {
    const { region, nodeIndex } = parseUid(session, uid);
    const uidFull = uidOf(region.regionId, nodeIndex);
    if (excluded) {
        if (session.exclusions.includes(uidFull)) return session;
        return { ...session, exclusions: [...session.exclusions, uidFull] };
    }
    if (!session.exclusions.includes(uidFull)) return session;
    return { ...session, exclusions: session.exclusions.filter(u => u !== uidFull) };
}

/** Confirmación explícita de naturaleza/tipo del usuario sobre un nodo. */
export function confirmNature(session, uid, nature) {
    if (!nature || String(nature).trim() === '') {
        throw new TypeError('ImportSession: confirmNature requiere un valor de naturaleza/tipo');
    }
    const { region, nodeIndex } = parseUid(session, uid);
    const node = region.contract.nodes[nodeIndex];
    const natureValue = String(nature);
    const existing = session.natureConfirmations.find(e => e.uid === uid);
    if (existing && existing.nature === natureValue) return session;
    const next = session.natureConfirmations.filter(e => e.uid !== uid);
    next.push({
        uid,
        regionId: region.regionId,
        nodeIndex,
        code: node.normalizedCode ?? node.code,
        nature: natureValue,
        at: nowOf(session)
    });
    return { ...session, natureConfirmations: next };
}

/**
 * Resolución explícita de un REVIEW.
 * - target = uid de nodo (`regionId:index`) → resuelve REVIEW de nodo (padre inferido, etc.)
 * - target = `${regionId}:w${índice}` del warning original → resuelve REVIEW de warning
 */
export function resolveReview(session, target, decision = 'accept') {
    const parts = target.split(':');
    const regionId = parts.slice(0, parts.length - 1).join(':');
    if (!session.regions.some(r => r.regionId === regionId)) {
        throw new TypeError(`ImportSession: target inválido "${target}" (región desconocida)`);
    }
    const key = target;
    const existing = session.reviewResolutions.find(r => (r.uid ?? r.warnKey) === key);
    if (existing && existing.decision === String(decision)) return session;
    const isWarn = /:w\d+$/.test(target);
    const entry = isWarn
        ? { warnKey: target, regionId, decision: String(decision), at: nowOf(session) }
        : { uid: target, regionId, decision: String(decision), at: nowOf(session) };
    return { ...session, reviewResolutions: [...session.reviewResolutions, entry] };
}

/** Deriva el Effective Contract (determinista). Nunca muta el original. */
export function effectiveContractOf(session, { regionId } = {}) {
    const region = findRegion(session, regionId);
    return effectiveRegionContract(session, region);
}

/** Filtra los nodos del contract a los NO excluidos (vista de filas, sin reindexar). */
export function applyExclusions(session, { regionId } = {}) {
    const region = findRegion(session, regionId);
    const excludedUids = sessionExcludedUids(session, region);
    const out = [];
    for (let index = 0; index < region.contract.nodes.length; index++) {
        const uid = uidOf(region.regionId, index);
        if (excludedUids.has(uid)) continue;
        const node = region.contract.nodes[index];
        out.push({
            uid,
            nodeIndex: index,
            code: node.normalizedCode ?? node.code,
            name: node.name,
            level: node.level,
            parent: node.parent,
            parentInfo: node.parentInfo
        });
    }
    return out;
}

/**
 * Simulación: construye el payload en memoria vía CompatibilityAdapter.
 * GARANTÍA: jamás POST/PUT/DELETE ni red (el adapter es puro; la suite lo verifica).
 */
export function simulate(session, { companyId = null, regionId } = {}) {
    const region = findRegion(session, regionId);
    const effective = effectiveRegionContract(session, region);
    const confirmedNatureMap = confirmedNatureMapOf(session, region);
    let outcome;
    try {
        outcome = CompatibilityAdapter.toBulkPayload(effective, companyId, { confirmedNatureMap });
    } catch (err) {
        return {
            ok: false,
            allowed: false,
            error: `simulate falló: ${err && err.message ? err.message : String(err)}`,
            at: nowOf(session)
        };
    }
    let fingerprint = null;
    try {
        fingerprint = contractFingerprint(effective);
    } catch (err) {
        fingerprint = null;
    }
    return {
        ok: !!outcome.allowed,
        allowed: !!outcome.allowed,
        reason: outcome.reason ?? null,
        blocks: outcome.blocks ?? [],
        payload: outcome.payload ?? null,
        expectedCounts: outcome.expectedCounts ?? null,
        effectiveNodeCount: effective.nodes.length,
        fingerprint,
        at: nowOf(session)
    };
}

/** Evaluación de puertas de importación. Devuelve boolean estricto. */
export function canImport(session, { regionId } = {}) {
    return canImportReport(session, { regionId }).can;
}

/** Igual que canImport pero con motivos accionables (para la UI). */
export function canImportReport(session, { regionId } = {}) {
    const region = findRegion(session, regionId);
    const reasons = gateReasons(session, region);
    return { can: reasons.length === 0, reasons, regionId: region.regionId };
}

/** Resumen determinista de la región (agregaciones simples; no re-analiza). */
export function summaryOf(session, { regionId } = {}) {
    const region = findRegion(session, regionId);
    const c = region.contract;
    const effective = effectiveRegionContract(session, region);
    const reasons = gateReasons(session, region);
    const excludedUids = sessionExcludedUids(session, region);
    const resolvedWarnKeys = new Set(sessionReviewResolutionsOf(session, region).filter(r => r.warnKey).map(r => r.warnKey));
    const overridesHere = sessionOverridesOf(session, region);
    const natureHere = sessionNatureConfirmationsOf(session, region);
    const reviewHere = sessionReviewResolutionsOf(session, region);

    let reviewWarnings = 0;
    let reviewWarningsResolved = 0;
    for (let wi = 0; wi < c.warnings.length; wi++) {
        const warn = c.warnings[wi];
        if (!warn || typeof warn !== 'object' || warn.severity !== 'REVIEW') continue;
        reviewWarnings++;
        if (resolvedWarnKeys.has(`${region.regionId}:w${wi}`)) reviewWarningsResolved++;
    }
    let nodeReviews = 0;
    let nodeReviewsResolved = 0;
    let unknownNodes = 0;
    let unknownNodesConfirmed = 0;
    const confirmedUids = new Set(sessionNatureConfirmationsOf(session, region).map(e => e.uid));
    const resolvedNodeUids = new Set(sessionReviewResolutionsOf(session, region).filter(r => r.uid).map(r => r.uid));
    for (let index = 0; index < c.nodes.length; index++) {
        const node = c.nodes[index];
        const uid = uidOf(region.regionId, index);
        const excluded = excludedUids.has(uid);
        if (node.requiresReview || (node.parentInfo && node.parentInfo.requiresReview)) {
            nodeReviews++;
            if (!excluded && resolvedNodeUids.has(uid)) nodeReviewsResolved++;
        }
        if (node.isPostable === 'UNKNOWN') {
            unknownNodes++;
            if (!excluded && confirmedUids.has(uid)) unknownNodesConfirmed++;
        }
    }

    return {
        regionId: region.regionId,
        meta: clonePlain(region.meta),
        source: c.source ? clonePlain(c.source) : null,
        nodeCounts: {
            original: c.nodes.length,
            effective: effective.nodes.length,
            excluded: excludedUids.size,
            roots: effective.nodeCounts.roots,
            groups: effective.nodeCounts.groups,
            leaves: effective.nodeCounts.leaves
        },
        userActions: {
            overrides: overridesHere.length,
            exclusions: excludedUids.size,
            natureConfirmations: natureHere.length,
            reviewResolutions: reviewHere.length
        },
        issues: {
            blocks: (c.errors || []).filter(e => e && e.severity === 'BLOCK').length,
            blockUnresolved: reasons.filter(r => r.startsWith('BLOCK sin resolver')).length,
            reviewWarnings,
            reviewWarningsResolved,
            reviewWarningsUnresolved: Math.max(0, reviewWarnings - reviewWarningsResolved),
            nodeReviews,
            nodeReviewsResolved,
            nodeReviewsUnresolved: Math.max(0, nodeReviews - nodeReviewsResolved),
            unknownNature: unknownNodes,
            unknownNatureConfirmed: unknownNodesConfirmed,
            unknownNatureUnresolved: Math.max(0, unknownNodes - unknownNodesConfirmed),
            canImport: reasons.length === 0,
            reasons: reasons.slice()
        },
        dataLoss: {
            silentCorruptionCount: c.silentCorruptionCount ?? 0,
            dataLossCount: c.dataLoss?.dataLossCount ?? 0,
            unaccountedRows: c.dataLoss?.unaccountedRows ?? 0,
            droppedRowCount: c.dataLoss?.droppedRowCount ?? 0,
            silentTransformationCount: c.dataLoss?.silentTransformationCount ?? 0
        },
        reconciliation: {
            rowsTotal: c.stats?.totalRows ?? c.nodes.length,
            validRows: c.stats?.validRows ?? c.nodes.length,
            rejectedRows: c.stats?.rejectedRows ?? (c.rejectedRows ? c.rejectedRows.length : 0),
            transformedNodes: c.nodes.filter(n => n.transformations && n.transformations.length > 0).length
        },
        requiresConfirmation: effective.requiresConfirmation,
        confidence: c.confidence ? clonePlain(c.confidence) : null,
        canImport: reasons.length === 0
    };
}
