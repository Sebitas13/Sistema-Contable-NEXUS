#!/usr/bin/env node
/**
 * test_import_session.mjs — Suite de la capa de dominio ImportSession (Fase 7 U-1).
 *
 * Cubre: creación, multi-región, overrides con traza, exclusión sin reindexar,
 * confirmación de naturaleza, resolución de REVIEW, Effective Contract derivado,
 * canImport (BLOCK/REVIEW/UNKNOWN/silent/unaccounted/válido), summaryOf,
 * simulate (payload en memoria), cero red, determinismo, inmutabilidad y
 * casos negativos.
 *
 * Uso: node scripts/test_import_session.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const S = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);
const { UniversalPlanAnalyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);

const FIXED_CLOCK = 1700000000000;
const now = () => FIXED_CLOCK;

// ── utilidades de reporte ─────────────────────────────────────
const CRITERIA = [];
let PASS = 0, FAIL = 0;
function criterion(id, ok, detail = '') {
    CRITERIA.push({ id, ok, detail });
    if (ok) PASS++; else FAIL++;
    console.log(`${ok ? '✅' : '❌'} [${id}] ${detail}`);
}
const T0 = Date.now();
function elapsed() { return `${((Date.now() - T0) / 1000).toFixed(1)}s`; }

// ── fixtures ──────────────────────────────────────────────────
function mkNode({ code, name = code, level = 1, parent = null, cls = 'LEAF', nature = 'EXPLICIT',
    type = 'Activo', piMethod = 'EXPLICIT', piReq = false, postable = 'EXPLICIT_TRUE',
    reqReview = false, rawCode = null }) {
    return {
        code,
        rawCode: rawCode ?? code,
        name,
        normalizedCode: code,
        transformations: [],
        requiresReview: reqReview,
        level,
        parent,
        parentInfo: { code: parent, method: piMethod, confidence: piReq ? 0.5 : 1, evidence: [], requiresReview: piReq },
        type,
        nature,
        natureConfidence: nature === 'EXPLICIT' ? 1 : 0.6,
        natureReason: nature === 'EXPLICIT' ? 'source_column' : 'root_position_first_digit',
        natureSource: nature === 'EXPLICIT' ? 'source_column' : 'UniversalPlanAnalyzer',
        classification: cls,
        isPostable: postable,
        postableConfidence: 1
    };
}

function mkContract({ nodes, errors = [], warnings = [], requiresConfirmation = false,
    dataLoss = null, silentCorruptionCount = 0, stats = null, region = null }) {
    const roots = nodes.filter(n => n.classification === 'ROOT').length;
    const groups = nodes.filter(n => n.classification === 'GROUP').length;
    const leaves = nodes.filter(n => n.classification === 'LEAF').length;
    const dl = dataLoss || {
        silentTransformationCount: 0, semanticCollisionCount: 0, identityCollisionCount: 0,
        droppedRowCount: 0, droppedCellCount: 0, unmappedColumnCount: 0, unresolvedNodeCount: 0,
        dataLossCount: 0, unaccountedRows: 0, collisions: []
    };
    const c = {
        contractVersion: '1.0', schemaVersion: '1.0', analyzerVersion: '2.1.0',
        source: { file: 'fixture.xlsx', sheet: 'S', headers: ['CODIGO', 'NOMBRE'], rowCount: nodes.length },
        columnMapping: { codeColumn: 0, nameColumn: 1, parentColumn: null, typeColumn: null, confidence: 0.9, ambiguous: false, scored: false, ambiguityMargin: null },
        hierarchy: { separator: null, levelLengths: [], levelCount: 0 },
        separator: null, levels: [],
        rootNodes: nodes.filter(n => n.classification === 'ROOT').map(n => n.code),
        nodeCounts: { total: nodes.length, roots, groups, leaves }, leafCounts: leaves,
        stats: stats || { totalRows: nodes.length, validRows: nodes.length, rejectedRows: 0 },
        nodes, transformations: [], rejectedRows: [],
        warnings, errors,
        confidence: { overall: 0.9, secondBest: 0, ambiguityMargin: 0.2 },
        requiresConfirmation, dataLoss: dl,
        silentCorruptionCount
    };
    if (region) c.region = region;
    return c;
}

function engineContract({ rows, fileName = 'eng.xlsx', sheetName = 'S' }) {
    return UniversalPlanAnalyzer.generateImportContract({
        fileName, sheetName,
        headers: ['CODIGO', 'NOMBRE'], rows,
        codeColumn: 'CODIGO', nameColumn: 'NOMBRE', parentColumn: null, typeColumn: null
    });
}

// Fixture limpio (todo EXPLICIT, sin errores, sin pérdida)
const N = () => [
    mkNode({ code: '1', name: 'ACTIVO', level: 1, cls: 'ROOT', nature: 'EXPLICIT', type: 'Activo' }),
    mkNode({ code: '11', name: 'CAJA', level: 2, parent: '1', cls: 'GROUP', type: 'Activo' }),
    mkNode({ code: '1101', name: 'CAJA MN', level: 3, parent: '11', cls: 'LEAF', type: 'Activo' })
];
const cleanContract = mkContract({ nodes: N() });

// ─────────────────────────────────────────────────────────────
// 1. CREACIÓN + VALIDACIONES DE ENTRADA
// ─────────────────────────────────────────────────────────────
{
    const s = S.createImportSession({ source: { fileName: 'a.xlsx' }, regions: [cleanContract], now });
    criterion('S1.create', !!s && s.regions.length === 1 && s.activeRegionId === s.regions[0].regionId && s.overrides.length === 0, 'crea sesión con 1 región y región activa = primera');
    criterion('S2.id', typeof s.id === 'string' && s.id.length > 0 && s.createdAt === FIXED_CLOCK, 'id/createdAt deterministas con reloj fijo');
    try { S.createImportSession({ regions: [] }); criterion('S3.empty', false, 'regions[] vacío debía lanzar'); }
    catch { criterion('S3.empty', true, 'regions[] vacío lanza TypeError'); }
    try { S.createImportSession({ regions: [{ nope: 1 }] }); criterion('S4.malformed', false, 'región sin contract debía lanzar'); }
    catch { criterion('S4.malformed', true, 'región sin contract.nodes lanza TypeError'); }
    try { S.createImportSession({ regions: [cleanContract], activeRegionId: 'nope' }); criterion('S5.badActive', false, 'activeRegionId inexistente debía lanzar'); }
    catch { criterion('S5.badActive', true, 'activeRegionId inexistente lanza TypeError'); }
}

// ─────────────────────────────────────────────────────────────
// 2. MULTI-REGIÓN (caso MEFP: tabla + narrativa)
// ─────────────────────────────────────────────────────────────
{
    const c2 = mkContract({ nodes: N() });
    const session = S.createImportSession({
        source: { fileName: 'mefp.pdf' },
        regions: [
            { regionId: 'tabla', meta: { extractionMode: 'table' }, contract: cleanContract },
            { regionId: 'narrative', meta: { extractionMode: 'narrative' }, contract: c2 }
        ],
        now
    });
    criterion('M1.regions', session.regions.length === 2 && session.activeRegionId === 'tabla', '2 regiones; activa = tabla');
    const s2 = S.applyOverride(session, 'tabla:0', 'name', 'ACTIVO EDITADO');
    const s3 = S.selectRegion(s2, 'narrative');
    criterion('M2.switch', s3.activeRegionId === 'narrative', 'selectRegion cambia región activa');
    const effNarr = S.effectiveContractOf(s3);
    const effTabla = S.effectiveContractOf(s2);
    criterion('M3.independent', effNarr.nodes[0].name === 'ACTIVO' && effTabla.nodes[0].name === 'ACTIVO EDITADO', 'overrides de tabla no contaminan narrative (y viceversa)');
    criterion('M4.preserve', S.effectiveContractOf(S.selectRegion(s3, 'tabla')).nodes[0].name === 'ACTIVO EDITADO', 'al volver a tabla, el override sigue presente');
    criterion('M5.dedupeRegionId', session.regions.map(r => r.regionId).join(',') === 'tabla,narrative', 'regionId derivados son deterministas');
    try { S.selectRegion(session, 'zz'); criterion('M6.badSel', false, 'selectRegion región inexistente debía lanzar'); }
    catch { criterion('M6.badSel', true, 'selectRegion región inexistente lanza'); }
}

// ─────────────────────────────────────────────────────────────
// 3. OVERRIDES CON TRAZA + EFFECTIVE CONTRACT
// ─────────────────────────────────────────────────────────────
{
    let s = S.createImportSession({ regions: [cleanContract], now });
    const snapOriginal = JSON.stringify(s.regions[0].contract);
    s = S.applyOverride(s, 'region_0:0', 'name', 'ACTIVO NUEVO');
    s = S.applyOverride(s, 'region_0:0', 'name', 'ACTIVO NUEVO 2');
    s = S.applyOverride(s, 'region_0:0', 'type', 'Pasivo');
    s = S.applyOverride(s, 'region_0:2', 'level', 4);
    s = S.applyOverride(s, 'region_0:2', 'code', '1102');

    const eff = S.effectiveContractOf(s);
    criterion('O1.trace', s.overrides.length === 4 && s.overrides.every(o => o.uid && o.field && 'originalValue' in o && 'value' in o && o.at === FIXED_CLOCK), '4 overrides con uid/field/originalValue/value/at');
    criterion('O2.original', s.overrides.find(o => o.uid === 'region_0:0' && o.field === 'name').originalValue === 'ACTIVO', 'originalValue capturado del contract original');
    criterion('O3.keepFirstOriginal', s.overrides.filter(o => o.uid === 'region_0:0' && o.field === 'name').length === 1 && s.overrides.find(o => o.uid === 'region_0:0' && o.field === 'name').value === 'ACTIVO NUEVO 2', 'override repetido actualiza value sin duplicar y conserva 1 registro');
    criterion('O4.effective', eff.nodes[0].name === 'ACTIVO NUEVO 2' && eff.nodes[0].type === 'Pasivo', 'effective refleja name+type');
    criterion('O5.codeSync', eff.nodes[2].code === '1102' && eff.nodes[2].normalizedCode === '1102' && eff.nodes[2].rawCode === '1101', 'override de code sincroniza code/normalizedCode y conserva rawCode');
    criterion('O6.immutable', JSON.stringify(s.regions[0].contract) === snapOriginal, 'contract original idéntico byte a byte tras 4 overrides');
    const eff2 = S.effectiveContractOf(s);
    criterion('O7.deterministicEff', JSON.stringify(eff) === JSON.stringify(eff2), 'effectiveContractOf es determinista (misma sesión → mismo JSON)');
    eff.nodes[0].name = 'MUTADO';
    const eff3 = S.effectiveContractOf(s);
    criterion('O8.effNotShared', eff3.nodes[0].name === 'ACTIVO NUEVO 2', 'mutar un effective devuelto no afecta derivaciones futuras');
    criterion('O9.noop', S.applyOverride(s, 'region_0:0', 'name', 'ACTIVO NUEVO 2') === s, 'override con valor idéntico es no-op (misma referencia)');
    criterion('O10.counts', eff.nodeCounts.total === 3 && eff.nodeCounts.roots === 1, 'nodeCounts recalculados por conteo de classification');
    try { S.applyOverride(s, 'region_0:0', 'parent', 'x'); criterion('O11.field', false, 'campo parent no editable debía lanzar'); }
    catch { criterion('O11.field', true, 'campo no whitelisted lanza TypeError'); }
    try { S.applyOverride(s, 'region_0:0', 'name', ''); criterion('O12.empty', false, 'override vacío debía lanzar'); }
    catch { criterion('O12.empty', true, 'override con valor vacío lanza TypeError'); }
    try { S.applyOverride(s, 'region_0:99', 'name', 'x'); criterion('O13.uid', false, 'uid inexistente debía lanzar'); }
    catch { criterion('O13.uid', true, 'uid de nodo inexistente lanza TypeError'); }
    try { S.applyOverride(s, 'malformed', 'name', 'x'); criterion('O14.badUid', false, 'uid malformado debía lanzar'); }
    catch { criterion('O14.badUid', true, 'uid malformado lanza TypeError'); }
}

// ─────────────────────────────────────────────────────────────
// 4. EXCLUSIÓN SIN REINDEXACIÓN
// ─────────────────────────────────────────────────────────────
{
    let s = S.createImportSession({ regions: [cleanContract], now });
    s = S.applyOverride(s, 'region_0:1', 'name', 'CAJA EDITADA');
    s = S.excludeRow(s, 'region_0:1');
    const rows = S.applyExclusions(s);
    const eff = S.effectiveContractOf(s);
    criterion('E1.excluded', s.exclusions.length === 1 && eff.nodes.length === 2 && eff.nodes[0].code === '1' && eff.nodes[1].code === '1101', 'excluir nodo 1 → effective sin ese nodo');
    criterion('E2.noReindex', rows.map(r => r.nodeIndex).join(',') === '0,2' && rows[1].uid === 'region_0:2', 'uid/nodeIndex NO se reindexan (0,2); uid estable');
    s = S.excludeRow(s, 'region_0:1', false);
    const effAfter = S.effectiveContractOf(s);
    criterion('E3.reapplyAfterReinclude', effAfter.nodes.length === 3 && effAfter.nodes[1].name === 'CAJA EDITADA', 'override sobrevive en sesión y se re-aplica al re-incluir la fila');
    const effWhileExcluded = S.effectiveContractOf(S.excludeRow(S.applyOverride(s, 'region_0:1', 'name', 'OTRO'), 'region_0:1'));
    criterion('E3b.notInPayloadWhileExcluded', effWhileExcluded.nodes.length === 2 && effWhileExcluded.nodes.every(n => n.name !== 'OTRO'), 'override de fila excluida NO entra al effective mientras está excluida');
    criterion('E4.reinclude', S.effectiveContractOf(s).nodes.length === 3, 'excludeRow(uid,false) re-incluye');
    try { S.excludeRow(s, 'region_0:77'); criterion('E5.badExcl', false, 'excluir uid inexistente debía lanzar'); }
    catch { criterion('E5.badExcl', true, 'excluir uid inexistente lanza TypeError'); }
    // exclusión en región A no afecta región B
    const sA = S.createImportSession({ regions: [{ regionId: 'a', contract: cleanContract }, { regionId: 'b', contract: mkContract({ nodes: N() }) }], now });
    const sB = S.excludeRow(sA, 'a:0');
    criterion('E6.crossRegion', S.effectiveContractOf(sB, { regionId: 'a' }).nodes.length === 2 && S.effectiveContractOf(sB, { regionId: 'b' }).nodes.length === 3, 'excluir en región a no toca b');
}

// ─────────────────────────────────────────────────────────────
// 5. CONFIRMACIÓN DE NATURALEZA + UNKNOWN
// ─────────────────────────────────────────────────────────────
{
    const unknownContract = mkContract({
        nodes: [
            mkNode({ code: '9', name: 'ORDEN', level: 1, cls: 'ROOT', nature: 'INFERRED', type: 'Activo', postable: 'UNKNOWN' }),
            mkNode({ code: '91', name: 'CUENTAS DE ORDEN', level: 2, parent: '9', cls: 'LEAF', type: 'Activo', postable: 'INFERRED_TRUE' })
        ],
        requiresConfirmation: true
    });
    let s = S.createImportSession({ regions: [unknownContract], now });
    criterion('U1.gate', S.canImport(s) === false, 'UNKNOWN sin confirmar → canImport=false');
    s = S.confirmNature(s, 'region_0:0', 'Orden');
    const eff = S.effectiveContractOf(s);
    criterion('U2.type', eff.nodes[0].type === 'Orden' && s.natureConfirmations[0].code === '9' && s.natureConfirmations[0].nature === 'Orden', 'confirmNature aplica tipo y guarda code/nature');
    criterion('U3.gateOk', S.canImport(s) === true, 'UNKNOWN confirmado → canImport=true');
    criterion('U4.simAllowed', S.simulate(s, { companyId: 'c1' }).allowed === true, 'simulate con naturaleza confirmada → allowed');
    criterion('U5.payloadType', S.simulate(s, { companyId: 'c1' }).payload.accounts.find(a => a.code === '9').type === 'Orden', 'payload usa el tipo confirmado');
    try { S.confirmNature(s, 'region_0:0', ''); criterion('U6.emptyNature', false, 'confirmNature vacío debía lanzar'); }
    catch { criterion('U6.emptyNature', true, 'confirmNature con valor vacío lanza'); }
}

// ─────────────────────────────────────────────────────────────
// 6. RESOLUCIÓN DE REVIEW (warnings y nodos)
// ─────────────────────────────────────────────────────────────
{
    const reviewContract = mkContract({
        nodes: [
            mkNode({ code: '1', name: 'ACTIVO', level: 1, cls: 'ROOT', nature: 'EXPLICIT' }),
            mkNode({ code: '11', name: 'CAJA', level: 2, parent: '1', cls: 'GROUP', nature: 'EXPLICIT' }),
            mkNode({ code: '1101', name: 'CAJA MN', level: 3, parent: '11', cls: 'LEAF', nature: 'EXPLICIT', piReq: true })
        ],
        warnings: [{ type: 'IMPLICIT_LEVEL_GAP', severity: 'REVIEW', from: '1', to: '11', message: 'Salto implícito' }],
        errors: []
    });
    let s = S.createImportSession({ regions: [reviewContract], now });
    criterion('R1.gate', S.canImport(s) === false, 'REVIEW (warn + nodo) sin resolver → canImport=false');
    const report = S.canImportReport(s);
    criterion('R2.reasons', report.reasons.some(r => r.includes('REVIEW sin resolver')), 'canImportReport explica los REVIEW');
    s = S.resolveReview(s, 'region_0:w0');
    criterion('R3.afterWarn', S.canImport(s) === false, 'resolver solo el warning → sigue false (queda REVIEW de nodo)');
    s = S.resolveReview(s, 'region_0:2');
    criterion('R4.afterNode', S.canImport(s) === true, 'resolver warning + nodo → canImport=true');
    const s2 = S.createImportSession({ regions: [reviewContract], now });
    try { S.resolveReview(s2, 'zzz:w0'); criterion('R5.badTarget', false, 'resolver target de región inexistente debía lanzar'); }
    catch { criterion('R5.badTarget', true, 'resolveReview con región desconocida lanza'); }
}

// ─────────────────────────────────────────────────────────────
// 7. canImport: BLOCK / silentCorruption / unaccounted
// ─────────────────────────────────────────────────────────────
{
    const dupContract = mkContract({
        nodes: [
            mkNode({ code: '1', name: 'ACTIVO', level: 1, cls: 'ROOT' }),
            mkNode({ code: '11', name: 'CAJA', level: 2, parent: '1', cls: 'GROUP' }),
            mkNode({ code: '1101', name: 'CAJA MN', level: 3, parent: '11', cls: 'LEAF' }),
            mkNode({ code: '1101', name: 'CAJA MN2', level: 3, parent: '11', cls: 'LEAF' })
        ],
        errors: [{ type: 'duplicateCode', severity: 'BLOCK', code: '1101', count: 2, message: 'Código duplicado exacto "1101" x2' }]
    });
    let s = S.createImportSession({ regions: [dupContract], now });
    criterion('B1.gate', S.canImport(s) === false, 'BLOCK de duplicado → canImport=false');
    s = S.excludeRow(s, 'region_0:3');
    criterion('B2.still', S.canImport(s) === false, 'excluir UNA de las dos filas duplicadas → sigue false (queda 1 ocurrencia)');
    s = S.excludeRow(s, 'region_0:2');
    criterion('B3.clear', S.canImport(s) === true, 'excluir TODAS las filas del código bloqueado → BLOCK limpio (sin política de dedup: el usuario removió las filas)');
    const eff = S.effectiveContractOf(s);
    criterion('B4.severity', eff.errors.length === 0 && eff.errors.every(e => e.severity === 'BLOCK'), 'no se convierte ni inventa severidad; el error desaparece con la causa');

    const silentContract = mkContract({ nodes: N(), silentCorruptionCount: 1, dataLoss: { dataLossCount: 1, silentTransformationCount: 1, unaccountedRows: 0 } });
    criterion('B5.silent', S.canImport(S.createImportSession({ regions: [silentContract], now })) === false, 'silentCorruptionCount=1 → canImport=false');

    const unaccContract = mkContract({ nodes: N(), dataLoss: { dataLossCount: 2, silentTransformationCount: 0, unaccountedRows: 2 } });
    criterion('B6.unacc', S.canImport(S.createImportSession({ regions: [unaccContract], now })) === false, 'unaccountedRows=2 → canImport=false');
}

// ─────────────────────────────────────────────────────────────
// 8. INTEGRACIÓN CON EL ENGINE (contrato real + duplicados reales)
// ─────────────────────────────────────────────────────────────
{
    const contract = engineContract({ rows: [
        { CODIGO: '1', NOMBRE: 'ACTIVO' },
        { CODIGO: '11', NOMBRE: 'CAJA' },
        { CODIGO: '1101', NOMBRE: 'CAJA MN' },
        { CODIGO: '1101', NOMBRE: 'CAJA MN' }
    ] });
    criterion('I1.engineContract', contract.nodes.length === 4 && contract.errors.some(e => e.type === 'duplicateCode' && e.severity === 'BLOCK'), 'engine produce contrato con 4 nodos y BLOCK duplicateCode');
    let s = S.createImportSession({ source: { fileName: 'eng.xlsx' }, regions: [contract], now });
    const sim1 = S.simulate(s, { companyId: 'c1' });
    criterion('I2.simBlocked', sim1.allowed === false && sim1.ok === false && sim1.blocks.length === 1, 'simulate sobre contrato con BLOCK → allowed=false (gate preflight)');
    // raíz INFERRED sin confirmar (+ REVIEW de nodo raíz del engine)
    criterion('I3.confNeeded', S.canImport(s) === false, 'contrato engine con raíz INFERRED sin confirmar → canImport=false');
    s = S.confirmNature(s, `${s.regions[0].regionId}:0`, 'Activo');
    criterion('I3b.stillReview', S.canImport(s) === false, 'confirmar naturaleza NO resuelve el REVIEW de nodo de la raíz (mecánica separada)');
    s = S.resolveReview(s, 'region_0:0');
    s = S.excludeRow(s, 'region_0:3');
    criterion('I4.stillBlock', S.canImport(s) === false, 'excluir 1 duplicado real → sigue bloqueado');
    s = S.excludeRow(s, 'region_0:2');
    const report = S.canImportReport(s);
    criterion('I5.gatesOk', report.can === true && report.reasons.length === 0, 'engine real: BLOCK limpio + raíz confirmada → canImport=true');
    const sim2 = S.simulate(s, { companyId: 'c1' });
    criterion('I6.payload', sim2.allowed === true && sim2.payload.companyId === 'c1' && sim2.payload.accounts.length === 2 && sim2.fingerprint !== null, 'simulate produce payload en memoria con fingerprint');
    const sum = S.summaryOf(s);
    criterion('I7.summary', sum.nodeCounts.original === 4 && sum.nodeCounts.effective === 2 && sum.nodeCounts.excluded === 2 && sum.issues.canImport === true, 'summaryOf: original=4, effective=2, excluidas=2, canImport');
    criterion('I8.immutEngine', JSON.stringify(s.regions[0].contract) === JSON.stringify(contract), 'contract del engine inmutable tras todo el flujo');
}

// ─────────────────────────────────────────────────────────────
// 9. CERO RED (runtime + estático)
// ─────────────────────────────────────────────────────────────
{
    const guard = () => { throw new Error('NETWORK ACCESS DETECTED'); };
    const oldFetch = globalThis.fetch, oldXhr = globalThis.XMLHttpRequest, oldWs = globalThis.WebSocket, oldAxios = globalThis.axios;
    globalThis.fetch = guard; globalThis.XMLHttpRequest = guard; globalThis.WebSocket = guard; globalThis.axios = guard;
    let networkError = null;
    try {
        const c = mkContract({ nodes: N() });
        const s = S.createImportSession({ regions: [c], now });
        S.applyOverride(s, 'region_0:0', 'name', 'X');
        S.excludeRow(s, 'region_0:2');
        S.effectiveContractOf(s);
        S.canImport(s);
        S.canImportReport(s);
        S.summaryOf(s);
        S.simulate(s, { companyId: 'c1' });
        const s2 = S.confirmNature(S.createImportSession({ regions: [mkContract({ nodes: N(), requiresConfirmation: true })], now }), 'region_0:0', 'Activo');
        S.simulate(s2, { companyId: 'c1' });
    } catch (e) {
        networkError = e.message;
    } finally {
        globalThis.fetch = oldFetch; globalThis.XMLHttpRequest = oldXhr; globalThis.WebSocket = oldWs; globalThis.axios = oldAxios;
    }
    criterion('N1.runtime', networkError === null, 'todas las operaciones (incl. simulate) funcionan con fetch/XHR/WebSocket/axios saboteados');

    const srcFiles = [
        path.join(root, 'web-app/client/src/importSession/createImportSession.js'),
        path.join(root, 'web-app/client/src/importSession/index.js')
    ];
    const dangerous = ['axios', 'XMLHttpRequest', 'fetch(', 'localStorage', 'sessionStorage', 'document.', 'window.', 'navigator.', 'WebSocket', 'http://', 'https://', "from 'react'", "require("];
    const hits = [];
    for (const f of srcFiles) {
        const content = fs.readFileSync(f, 'utf8');
        for (const d of dangerous) {
            if (content.includes(d)) hits.push(`${path.basename(f)} contiene "${d}"`);
        }
    }
    criterion('N2.static', hits.length === 0, 'ImportSession no referencia APIs de red/DOM/React: ' + (hits.length === 0 ? 'limpio' : hits.join('; ')));
}

// ─────────────────────────────────────────────────────────────
// 10. DETERMINISMO Y PURIDAD (misma entrada → mismo resultado)
// ─────────────────────────────────────────────────────────────
{
    const run = () => {
        let s = S.createImportSession({ source: { fileName: 'f.xlsx' }, regions: [cleanContract, mkContract({ nodes: N() })], now });
        s = S.applyOverride(s, 'region_0:0', 'name', 'A1');
        s = S.applyOverride(s, 'region_1:1', 'level', 9);
        s = S.excludeRow(s, 'region_0:1');
        s = S.confirmNature(s, 'region_1:0', 'Pasivo');
        const sRev = S.resolveReview(
            S.createImportSession({ regions: [mkContract({ nodes: N(), warnings: [{ severity: 'REVIEW', type: 'x', message: 'm' }] })], now }),
            'region_0:w0'
        );
        s = S.selectRegion(s, 'region_1');
        return JSON.stringify({ s, eff: S.effectiveContractOf(s), sum: S.summaryOf(s), sim: S.simulate(s, { companyId: 'c' }), sRev });
    };
    criterion('D1.deterministic', run() === run(), 'secuencia completa idéntica 2× con reloj fijo → JSON idéntico (sin variación salvo at/id: ambos fijos)');
    const s1 = S.createImportSession({ regions: [cleanContract] });
    const s2 = S.createImportSession({ regions: [cleanContract] });
    criterion('D2.realClockVariesOnlyAt', s1.overrides.length === 0 && s1.regions[0].regionId === s2.regions[0].regionId, 'dos sesiones sin reloj: estructura idéntica (at/id difieren solo por reloj real)');
}

// ─────────────────────────────────────────────────────────────
// 11. FROZEN: mutar el original lanza (garantía de inmutabilidad)
// ─────────────────────────────────────────────────────────────
{
    const s = S.createImportSession({ regions: [cleanContract], now });
    let threw = false;
    try { s.regions[0].contract.nodes[0].code = '999'; } catch { threw = true; }
    criterion('F1.frozen', threw, 'contract original deep-frozen: mutación lanza TypeError');
    let threw2 = false;
    try { s.overrides.push({ x: 1 }); } catch { threw2 = true; }
    criterion('F2.sessionFrozen', threw2, 'sesión congelada: mutar overrides[] lanza');
}

// ─────────────────────────────────────────────────────────────
// RESUMEN
// ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(95));
console.log(`RESULTADO IMPORT SESSION: ${PASS} PASS / ${FAIL} FAIL — ${elapsed()}`);
console.log('='.repeat(95));
console.log('\n── CRITERIOS ──');
for (const c of CRITERIA) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.id} — ${c.detail}`);
}
process.exit(FAIL > 0 ? 1 : 0);
