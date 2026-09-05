#!/usr/bin/env node
/**
 * test_import_wizard_u2.mjs — Suite del UniversalImportWizard pasos 1–6 (Fase 7 U-5).
 *
 *  A. Alcance estático: el wizard nuevo solo toca red en el paso 6 y solo a
 *     los dos endpoints productivos (/bulk + companies); no filtra
 *     inteligencia legacy y el montaje conserva el fallback.
 *  B. Contrato UI↔engine: con corpus real (DASH Hoja2) se verifica cada campo
 *     que consumen los pasos (incl. fingerprints pre/post y gates del resumen).
 *  C. CSV: el engine extrae y analiza CSV (capacidad nueva vs legacy).
 *  D. Detección de formatos.
 *
 * Uso: node scripts/test_import_wizard_u2.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const importDir = path.join(root, 'web-app/client/src/components/import');

const { detectFormat, ExcelAdapter, PdfAdapter, CsvAdapter } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/FormatAdapter.js')).href);
const { UniversalPlanAnalyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);
const { ImportContractValidator } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/ImportContractValidator.js')).href);
const { contractFingerprint } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/ImportContractSchema.js')).href);
const { deriveCompanyStructure } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/companyStructure.js')).href);
const { needsLegacyWizard, hasSingleDigitSymptom, gridFromDoc } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/puctGuard.js')).href);
const { readImportLog, appendImportLog, countImportLog } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/importLog.js')).href);
const { getImportEngineMode, setImportEngineMode, isUniversalEnabled } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/engineFlag.js')).href);
const S = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);

const CRITERIA = [];
let PASS = 0, FAIL = 0;
function criterion(id, ok, detail = '') {
    CRITERIA.push({ id, ok, detail });
    if (ok) PASS++; else FAIL++;
    console.log(`${ok ? '✅' : '❌'} [${id}] ${detail}`);
}
const T0 = Date.now();
function elapsed() { return `${((Date.now() - T0) / 1000).toFixed(1)}s`; }

const WIZ_FILES = ['UniversalImportWizard.jsx', 'ImportFileStep.jsx', 'ImportDiagnosticStep.jsx', 'ImportValidationStep.jsx', 'ImportReviewStep.jsx', 'ImportSummaryStep.jsx', 'ImportConfirmationStep.jsx', 'ImportErrorBoundary.jsx', 'engineFlag.js'];
const readWiz = (f) => fs.readFileSync(path.join(importDir, f), 'utf8');

// ─────────────────────────────────────────────────────────────
// A. ALCANCE ESTÁTICO
// ─────────────────────────────────────────────────────────────
{
    const contents = Object.fromEntries(WIZ_FILES.map(f => [f, readWiz(f)]));
    const components = WIZ_FILES.filter(f => f.endsWith('.jsx')).map(f => contents[f]).join('\n');
    const all = WIZ_FILES.map(f => contents[f]).join('\n');

    criterion('A1.noAxiosExceptConfirm', !WIZ_FILES.filter(f => f !== 'ImportConfirmationStep.jsx').map(f => contents[f]).join('\n').includes('axios'), 'axios solo existe en ImportConfirmationStep (paso 6)');
    criterion('A2.noFetch', !components.includes('fetch('), 'componentes del wizard: sin fetch()');
    criterion('A3.noXhrWs', !all.includes('XMLHttpRequest') && !all.includes('WebSocket'), 'sin XMLHttpRequest ni WebSocket');
    const noNetComponents = WIZ_FILES.filter(f => f !== 'ImportConfirmationStep.jsx' && f.endsWith('.jsx')).map(f => contents[f]).join('\n');
    criterion('A4.noApiCalls', !/axios|\.post\(|\.get\(|\.put\(|\.delete\(|XMLHttpRequest|WebSocket/.test(noNetComponents), 'pasos 1-5: sin invocaciones HTTP (el paso 6 concentra la red, verificado en A14-A16)');
    criterion('A5.localStorageOnlyFlag',
        !components.includes('localStorage') && contents['engineFlag.js'].includes('importEngine'),
        'localStorage solo en engineFlag.js (clave importEngine)');
    criterion('A6.noLegacyIntel', !all.includes('AccountPlanProfile') && WIZ_FILES.filter(f => contents[f].includes('SmartImportWizard')).join(',') === 'ImportErrorBoundary.jsx', 'AccountPlanProfile en ningún archivo; SmartImportWizard solo en ImportErrorBoundary (fallback de emergencia documentado)');

    // Allowlist de imports del orquestador
    const allow = new Set(['react', '../NexusModal.jsx', '../../utils/FormatAdapter.js', '../../utils/UniversalPlanAnalyzer.js', '../../context/CompanyContext.jsx', '../../importSession/index.js', './engineFlag.js', './puctGuard.js', './importLog.js', './ImportFileStep.jsx', './ImportDiagnosticStep.jsx', './ImportValidationStep.jsx', './ImportReviewStep.jsx', './ImportSummaryStep.jsx', './ImportConfirmationStep.jsx']);
    const imports = [...contents['UniversalImportWizard.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    const bad = imports.filter(i => !allow.has(i) && !i.startsWith('react'));
    criterion('A7.importAllowlist', imports.length > 0 && bad.length === 0, `imports del orquestador dentro de la allowlist (${imports.length} imports)${bad.length ? ' — fuera: ' + bad.join(',') : ''}`);

    const diagImports = [...contents['ImportDiagnosticStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A8.diagImports', diagImports.every(i => i === 'react' || i === '../../importSession/index.js'), 'ImportDiagnosticStep solo importa react + importSession (solo renderiza)');
    const fileImports = [...contents['ImportFileStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A9.fileImports', fileImports.every(i => i === 'react'), 'ImportFileStep solo importa react (presentacional puro)');
    const valImports = [...contents['ImportValidationStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A11.valImports', valImports.every(i => i === 'react' || i === '../../importSession/index.js' || i === '../../utils/ImportContractValidator.js'), 'ImportValidationStep: react + importSession + Validator del engine (presenta veredictos, no decide)');
    const revImports = [...contents['ImportReviewStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A12.revImports', revImports.every(i => i === 'react' || i === '../../importSession/index.js'), 'ImportReviewStep: react + importSession (overrides con traza, sin re-inferir)');
    const sumImports = [...contents['ImportSummaryStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A13.sumImports', sumImports.every(i => i === 'react' || i === '../../importSession/index.js' || i === '../../utils/ImportContractSchema.js'), 'ImportSummaryStep: react + importSession + Schema (fingerprints, sin red)');
    const confSrc = contents['ImportConfirmationStep.jsx'];
    const confImports = [...confSrc.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A14.confImports', confImports.every(i => ['react', 'axios', '../../api.js', '../../importSession/index.js', './companyStructure.js', './importLog.js', '../ToastProvider.jsx'].includes(i)), 'ImportConfirmationStep: react + axios + api + importSession + companyStructure + importLog + toast (único archivo con red)');
    const apiTargets = [...confSrc.matchAll(/\/api\/[a-zA-Z/_:-]*/g)].map(m => m[0]);
    const onlyKnown = apiTargets.every(t => t.startsWith('/api/accounts/bulk') || t.startsWith('/api/companies/'));
    criterion('A15.apiTargets', apiTargets.length >= 2 && onlyKnown, `paso 6 solo invoca endpoints productivos conocidos: ${[...new Set(apiTargets)].join(', ')}`);
    const structSrc = fs.readFileSync(path.join(importDir, 'companyStructure.js'), 'utf8');
    criterion('A16.bulkSemantics',
        confSrc.includes('BATCH_SIZE = 500') && confSrc.includes('successCount') && confSrc.includes('errorCount') && confSrc.includes('CancelToken') && confSrc.includes('deriveCompanyStructure') &&
        structSrc.includes('code_mask') && structSrc.includes('plan_structure'),
        'paso 6 replica la semántica del performImport clásico (lotes 500, success/errorCount, cancelación, PUT estructura post-import vía companyStructure pura)');

    const accounts = fs.readFileSync(path.join(root, 'web-app/client/src/pages/Accounts.jsx'), 'utf8');
    criterion('A10.mountFallback',
        accounts.includes('SmartImportWizard') && accounts.includes('UniversalImportWizard') && accounts.includes('isUniversalEnabled()'),
        'Accounts.jsx conserva SmartImportWizard (fallback) + montaje condicional por isUniversalEnabled()');
    criterion('A28.optIn',
        accounts.includes('open-universal-wizard') && accounts.includes('setShowUniversalWizard') && !accounts.includes('setImportEngineMode'),
        'opt-in U-9: botón dedicado que monta el universal sin tocar el flag global');
    const boundarySrc = contents['ImportErrorBoundary.jsx'];
    criterion('A17.boundaryMechanics',
        boundarySrc.includes('getDerivedStateFromError') && boundarySrc.includes('componentDidCatch') &&
        boundarySrc.includes("setImportEngineMode('legacy')") && boundarySrc.includes('<SmartImportWizard'),
        'ImportErrorBoundary: captura render, persiste fallback legacy y monta el clásico con los mismos callbacks');
    criterion('A18.boundaryMount',
        accounts.includes('ImportErrorBoundary') && accounts.includes('<UniversalImportWizard'),
        'Accounts.jsx monta el universal dentro del boundary (fallback automático ante fallos)');
    criterion('A19.modeBanner',
        contents['UniversalImportWizard.jsx'].includes('u2-mode-banner') && contents['UniversalImportWizard.jsx'].includes('u2-use-classic-btn'),
        'orquestador muestra banner de modo + botón de cambio manual al clásico');
    // U-8: limpieza bloqueada — sin imports muertos conocidos
    const revSrc = contents['ImportReviewStep.jsx'];
    criterion('A20.noDeadImports', !revSrc.includes('summaryOf'), 'ImportReviewStep sin summaryOf muerto (U-8)');
    const harnessSrc = fs.readFileSync(path.join(root, 'web-app/client/e2e-harness.html'), 'utf8');
    criterion('A21.noDeadHarnessImport', !harnessSrc.includes('nodesFingerprint'), 'e2e-harness sin import muerto de nodesFingerprint (U-8)');
    // U-8 condición: jamás activación global de Universal en código de app
    const appFiles = [];
    const walkSrc = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walkSrc(p); continue; }
            if (/\.(jsx?|html)$/.test(e.name)) appFiles.push(p);
        }
    };
    walkSrc(path.join(root, 'web-app/client/src'));
    const activators = appFiles.filter(f => {
        const c = fs.readFileSync(f, 'utf8');
        return c.includes(`setImportEngineMode('universal')`) || c.includes(`setImportEngineMode("universal")`);
    });
    criterion('A22.noGlobalActivation', activators.length === 0, 'ningún archivo de app activa Universal globalmente (PUCT sigue legacy por defecto)' + (activators.length ? ` — infractores: ${activators.join(',')}` : ''));
}

// ─────────────────────────────────────────────────────────────
// B. CONTRATO UI↔ENGINE (corpus real DASH/Hoja2)
// ─────────────────────────────────────────────────────────────
{
    const buf = fs.readFileSync(path.join(root, 'PUCT/Planes de cuentas.xlsx'));
    const file = new File([buf], 'Planes de cuentas.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const doc = await ExcelAdapter.extract({ file, sheetName: 'Hoja2' });
    criterion('B1.sheets', Array.isArray(doc.source.sheetNames) && doc.source.sheetNames.length > 1, `extracción expone sheetNames (${doc.source.sheetNames.length} hojas) para el selector`);
    const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(doc);
    criterion('B2.regions', analysis.regions.length >= 1, `${analysis.regions.length} región(es) utilizable(s)`);
    const c = analysis.regions[0];
    criterion('B3.nodes', c.nodes.length >= 200 && c.dataLoss.unaccountedRows === 0 && c.silentCorruptionCount === 0, `${c.nodes.length} nodos, unaccounted=0, silent=0`);

    const m = c.columnMapping || {};
    criterion('B4.mapping',
        ['codeColumn', 'nameColumn', 'parentColumn', 'typeColumn'].every(k => k in m) && typeof m.confidence === 'number',
        'columnMapping trae code/name/parent/type + confidence numérica');
    const observedLevels = new Set(c.nodes.map(n => n.level));
    criterion('B5.hierarchy',
        c.hierarchy && c.separator === '-' && observedLevels.size >= 3,
        `jerarquía: separator="-", niveles observados en nodos=[${[...observedLevels].sort((a, b) => a - b).join(',')}] (DASH no declara levelLengths: la UI muestra observados)`);
    criterion('B6.confidence',
        c.confidence && typeof c.confidence.overall === 'number' && c.confidence.overall >= 0 && c.confidence.overall <= 1,
        `confianza global numérica (${c.confidence?.overall})`);

    const CLASS = new Set(['ROOT', 'GROUP', 'LEAF', 'UNKNOWN']);
    const badNodes = c.nodes.filter(n =>
        typeof n.normalizedCode !== 'string' || !n.normalizedCode ||
        !n.parentInfo || typeof n.parentInfo.method !== 'string' ||
        typeof n.parentInfo.confidence !== 'number' || !Array.isArray(n.parentInfo.evidence) ||
        !Array.isArray(n.transformations) || typeof n.nature !== 'string' ||
        !CLASS.has(n.classification) || typeof n.isPostable !== 'string');
    criterion('B7.nodeShape', badNodes.length === 0, `los ${c.nodes.length} nodos traen parentInfo{method,confidence,evidence}, transformations[], nature, classification e isPostable`);
    criterion('B8.errors', Array.isArray(c.errors) && Array.isArray(c.warnings) && typeof c.requiresConfirmation === 'boolean', 'errors/warnings arrays + requiresConfirmation boolean');

    const session = S.createImportSession({
        source: { fileName: file.name, fileSize: file.size },
        extraction: { confidence: doc.extractionConfidence, ocrUsed: !!doc.ocrUsed, stats: doc.stats || null, warnings: doc.warnings || null },
        regions: analysis.regions
    });
    const sum = S.summaryOf(session);
    const hasKeys = (o, ks) => ks.every(k => k in o);
    criterion('B9.summaryShape',
        hasKeys(sum.nodeCounts, ['original', 'effective', 'excluded', 'roots', 'groups', 'leaves']) &&
        hasKeys(sum.issues, ['blocks', 'reviewWarnings', 'reviewWarningsUnresolved', 'unknownNatureUnresolved', 'canImport', 'reasons']) &&
        hasKeys(sum.reconciliation, ['rowsTotal', 'validRows', 'rejectedRows']) &&
        hasKeys(sum.dataLoss, ['silentCorruptionCount', 'unaccountedRows']),
        'summaryOf expone nodeCounts/issues/reconciliation/dataLoss que consume el diagnóstico');
    const eff = S.effectiveContractOf(session);
    const n0 = eff.nodes[0];
    criterion('B10.sampleRender',
        eff.nodes.length > 0 && typeof n0.normalizedCode === 'string' && typeof n0.level === 'number' && typeof (n0.name || '') === 'string',
        'primer nodo renderizable (código/nivel/nombre)');

    // Paso 3: validación externa + gates + simulación en memoria (DASH trae 1 BLOCK real)
    const ext = ImportContractValidator.validate(eff);
    criterion('B11.validatorShape',
        typeof ext.valid === 'boolean' && Array.isArray(ext.errors) && Array.isArray(ext.warnings),
        `ImportContractValidator.validate → {valid:${ext.valid}, errors:${ext.errors.length}, warnings:${ext.warnings.length}}`);
    const rep = S.canImportReport(session);
    criterion('B12.gates',
        rep.can === false && Array.isArray(rep.reasons) && rep.reasons.length > 0 && rep.reasons.every(r => typeof r === 'string'),
        `canImportReport bloquea DASH con ${rep.reasons.length} motivo(s) accionable(s)`);
    const sim = S.simulate(session, { companyId: null });
    criterion('B13.simulation',
        sim.allowed === false && sim.blocks.length >= 1 && typeof sim.reason === 'string' && typeof sim.fingerprint === 'string',
        `simulate en memoria: allowed=false por gate (${sim.blocks.length} BLOCK), fingerprint presente, sin red`);
}

// ─────────────────────────────────────────────────────────────
// E. FLUJOS DE REVISIÓN (las secuencias exactas que ejecuta el paso 4)
// ─────────────────────────────────────────────────────────────
{
    const rNode = (code, extra = {}) => Object.assign({
        code, rawCode: code, name: code, normalizedCode: code, transformations: [],
        requiresReview: false, level: 1, parent: null,
        parentInfo: { code: null, method: 'EXPLICIT', confidence: 1, evidence: [], requiresReview: false },
        type: 'Activo', nature: 'EXPLICIT', natureConfidence: 1, natureReason: 'source_column',
        natureSource: 'source_column', classification: 'LEAF', isPostable: 'EXPLICIT_TRUE', postableConfidence: 1
    }, extra);
    const rContract = mkReviewContractNodes => ({
        contractVersion: '1.0', schemaVersion: '1.0', analyzerVersion: '2.1.0',
        source: { file: 'r.xlsx', sheet: 'S', headers: ['CODIGO', 'NOMBRE'], rowCount: mkReviewContractNodes.length },
        columnMapping: { codeColumn: 0, nameColumn: 1, parentColumn: null, typeColumn: null },
        hierarchy: { separator: null, levelLengths: [], levelCount: 0 }, separator: null, levels: [],
        rootNodes: [], nodeCounts: { total: mkReviewContractNodes.length, roots: 0, groups: 0, leaves: mkReviewContractNodes.length },
        leafCounts: mkReviewContractNodes.length,
        stats: { totalRows: mkReviewContractNodes.length, validRows: mkReviewContractNodes.length, rejectedRows: 0 },
        nodes: mkReviewContractNodes, transformations: [], rejectedRows: [],
        warnings: [{ type: 'IMPLICIT_LEVEL_GAP', severity: 'REVIEW', from: '1', to: '11', message: 'Salto implícito' }],
        errors: [], confidence: { overall: 0.75, secondBest: 0, ambiguityMargin: 0.2 },
        requiresConfirmation: true,
        dataLoss: { silentTransformationCount: 0, semanticCollisionCount: 0, identityCollisionCount: 0, droppedRowCount: 0, droppedCellCount: 0, unmappedColumnCount: 0, unresolvedNodeCount: 0, dataLossCount: 0, unaccountedRows: 0, collisions: [] },
        silentCorruptionCount: 0
    });
    const reviewContract = rContract([
        rNode('1', { name: 'ACTIVO', classification: 'ROOT', nature: 'INFERRED', natureConfidence: 0.6, isPostable: 'INFERRED_TRUE' }),
        rNode('11', { name: 'CAJA', level: 2, parent: '1', cls: undefined, classification: 'LEAF', parentInfo: { code: '1', method: 'PAD_TO_BLOCK', confidence: 0.91, evidence: ['hermano en bloque'], requiresReview: true } }),
        rNode('1101', { name: 'CAJA MN', level: 3, parent: '11', classification: 'LEAF' })
    ]);

    // B14: bulk type (la secuencia del botón "Asignar tipo"): N overrides con traza
    let s = S.createImportSession({ regions: [reviewContract] });
    const rid = s.regions[0].regionId;
    for (const uid of [`${rid}:0`, `${rid}:1`, `${rid}:2`]) {
        s = S.applyOverride(s, uid, 'type', 'Pasivo');
    }
    const effB14 = S.effectiveContractOf(s);
    criterion('B14.bulk', effB14.nodes.every(n => n.type === 'Pasivo') && s.overrides.length === 3 && s.overrides.every(o => 'originalValue' in o && 'at' in o), 'bulk type: 3 overrides con traza, effective refleja los 3');

    // B15: excluir → editar excluida → re-incluir (el override sobrevive y se aplica)
    s = S.excludeRow(s, `${rid}:1`);
    s = S.applyOverride(s, `${rid}:1`, 'name', 'CAJA EDITADA');
    criterion('B15.excludedEdit', S.effectiveContractOf(s).nodes.length === 2, 'override sobre fila excluida no entra al effective');
    s = S.excludeRow(s, `${rid}:1`, false);
    const effB15 = S.effectiveContractOf(s);
    criterion('B15b.reapply', effB15.nodes.length === 3 && effB15.nodes[1].name === 'CAJA EDITADA', 'al re-incluir, el override se re-aplica');

    // B16: resolver warning + nodo + confirmar raíz INFERRED → gates en verde
    s = S.resolveReview(s, `${rid}:w0`);
    s = S.resolveReview(s, `${rid}:1`);
    s = S.confirmNature(s, `${rid}:0`, 'Activo');
    criterion('B16.gatesClear', S.canImport(s) === true, 'warn + nodo resueltos + raíz confirmada → canImport=true');

    // B17: lote con un uid inválido no tumba la secuencia (semántica del handler bulk)
    let s2 = S.createImportSession({ regions: [reviewContract] });
    const rid2 = s2.regions[0].regionId;
    let applied = 0;
    for (const uid of [`${rid2}:0`, `${rid2}:99`, `${rid2}:2`]) {
        try { s2 = S.applyOverride(s2, uid, 'type', 'Gasto'); applied++; }
        catch { /* uid inválido: se omite y se sigue */ }
    }
    criterion('B17.bulkRobust', applied === 2 && S.effectiveContractOf(s2).nodes.filter(n => n.type === 'Gasto').length === 2, 'bulk con uid inválido: aplica los válidos sin lanzar');
}

// ─────────────────────────────────────────────────────────────
// F. RESUMEN (fingerprints pre/post + puertas del paso 5)
// ─────────────────────────────────────────────────────────────
{
    const fpNode = (code, extra = {}) => Object.assign({
        code, rawCode: code, name: code, normalizedCode: code, transformations: [],
        requiresReview: false, level: 1, parent: null,
        parentInfo: { code: null, method: 'EXPLICIT', confidence: 1, evidence: [], requiresReview: false },
        type: 'Activo', nature: 'EXPLICIT', natureConfidence: 1, natureReason: 'source_column',
        natureSource: 'source_column', classification: 'LEAF', isPostable: 'EXPLICIT_TRUE', postableConfidence: 1
    }, extra);
    const mkFpContract = () => ({
        contractVersion: '1.0', schemaVersion: '1.0', analyzerVersion: '2.1.0',
        source: { file: 'f.xlsx', sheet: 'S', headers: ['CODIGO', 'NOMBRE'], rowCount: 3 },
        columnMapping: { codeColumn: 0, nameColumn: 1, parentColumn: null, typeColumn: null },
        hierarchy: { separator: null, levelLengths: [], levelCount: 0 }, separator: null, levels: [],
        rootNodes: ['1'], nodeCounts: { total: 3, roots: 1, groups: 1, leaves: 1 }, leafCounts: 1,
        stats: { totalRows: 3, validRows: 3, rejectedRows: 0 },
        nodes: [
            fpNode('1', { name: 'ACTIVO', classification: 'ROOT' }),
            fpNode('11', { name: 'CAJA', level: 2, parent: '1', classification: 'GROUP', parentInfo: { code: '1', method: 'PREFIX', confidence: 1, evidence: [], requiresReview: false } }),
            fpNode('1101', { name: 'CAJA MN', level: 3, parent: '11', classification: 'LEAF', parentInfo: { code: '11', method: 'PREFIX', confidence: 1, evidence: [], requiresReview: false } })
        ],
        transformations: [], rejectedRows: [], warnings: [], errors: [],
        confidence: { overall: 0.9, secondBest: 0, ambiguityMargin: 0.2 }, requiresConfirmation: false,
        dataLoss: { silentTransformationCount: 0, semanticCollisionCount: 0, identityCollisionCount: 0, droppedRowCount: 0, droppedCellCount: 0, unmappedColumnCount: 0, unresolvedNodeCount: 0, dataLossCount: 0, unaccountedRows: 0, collisions: [] },
        silentCorruptionCount: 0
    });
    const fpContract = mkFpContract();
    let s = S.createImportSession({ regions: [fpContract] });
    const rid = s.regions[0].regionId;
    const fpOrig = contractFingerprint(s.regions[0].contract);
    const fpEff1 = contractFingerprint(S.effectiveContractOf(s));
    const fpEff2 = contractFingerprint(S.effectiveContractOf(s));
    criterion('B18.fpStable', typeof fpOrig === 'string' && fpOrig.length > 0 && fpEff1 === fpEff2, 'huellas no vacías y fingerprint del effective determinista (el effective es una vista derivada, no un clon)');
    s = S.applyOverride(s, `${rid}:0`, 'name', 'ACTIVO EDITADO');
    const fpChanged = contractFingerprint(S.effectiveContractOf(s));
    criterion('B18b.fpChanges', fpChanged !== fpOrig, 'fingerprint cambia tras un override (trazabilidad pre/post del resumen)');

    const sumClean = S.summaryOf(S.createImportSession({ regions: [mkFpContract()] }));
    criterion('B19.gatesData',
        sumClean.dataLoss.silentCorruptionCount === 0 && sumClean.dataLoss.unaccountedRows === 0 && sumClean.reconciliation.rowsTotal === 3 && sumClean.reconciliation.validRows === 3,
        'summaryOf expone silent/unaccounted + reconciliación que exige el gate 5→6');

    // B20: derivación de estructura (misma fórmula que el clásico; null si no hay longitudes)
    const dashMask = deriveCompanyStructure({ separator: '-', levels: [3, 5, 7], hierarchy: { levelLengths: [3, 5, 7] } });
    const dashPlan = dashMask && JSON.parse(dashMask.plan_structure);
    criterion('B20.maskSep',
        dashMask && dashMask.code_mask === '###-##-##' && dashPlan && dashPlan.levelsCount === 3 && dashPlan.separator === '-' && dashPlan.regex === '^\\d+(?:\\-\\d+)*$',
        `separador → mask '###-##-##' + plan_structure idéntico al clásico (mask=${dashMask && dashMask.code_mask})`);
    const fixedMask = deriveCompanyStructure({ separator: null, levels: [], hierarchy: { levelLengths: [1, 2, 3, 6, 9] } });
    criterion('B20b.maskFixed',
        fixedMask && fixedMask.code_mask === '#########' && JSON.parse(fixedMask.plan_structure).regex === '^\\d+$',
        `longitud fija → mask de 9 (mask=${fixedMask && fixedMask.code_mask})`);
    criterion('B20c.maskNull',
        deriveCompanyStructure({ separator: '.', levels: null, hierarchy: { levelLengths: [] } }) === null &&
        deriveCompanyStructure(null) === null,
        'sin longitudes declaradas → null (el PUT se omite; jamás máscara inventada ni vacía)');
}

// ─────────────────────────────────────────────────────────────
// H. PUCT-GUARD (U-9: exclusión dura, testeable sin motor)
// ─────────────────────────────────────────────────────────────
{
    const mkDoc = (grid) => ({ rows: grid.map(cells => ({ cells: cells.map(rawValue => ({ rawValue })) })) });
    const puctGrid = [['C', 'G', 'SG', 'CP', 'CA', 'NOMBRE'], ['1', '', '', '', '', 'ACTIVO']];
    const rA = needsLegacyWizard(mkDoc(puctGrid));
    criterion('H1.header5col', rA.excluded === true && rA.signal === 'puct-5col' && rA.reason.length > 0, 'cabecera C,G,SG,CP,CA → excluido con motivo');

    const singleGrid = [['CODIGO', 'NOMBRE']];
    for (let i = 0; i < 60; i++) singleGrid.push([String((i % 5) + 1), 'CUENTA ' + i]);
    const rB = needsLegacyWizard(mkDoc(singleGrid));
    criterion('H2.singleDigit', rB.excluded === true && rB.signal === 'single-digit-codes', 'columna 1-dígito ×60 con nombres → excluido');

    const dashGrid = [['CODIGO', 'DESCRIPCION'], ['100-00-00', 'ACTIVO'], ['100-10-00', 'CAJA']];
    criterion('H3.dashPass', needsLegacyWizard(mkDoc(dashGrid)).excluded === false, 'DASH no excluido');
    const dotGrid = [['CODIGO', 'NOMBRE'], ['1', 'ACTIVO'], ['1.1', 'CAJA'], ['1.1.01', 'CAJA MN']];
    criterion('H4.dottedPass', needsLegacyWizard(mkDoc(dotGrid)).excluded === false, 'punteado corto no excluido (<50 filas)');
    criterion('H5.emptyDoc', needsLegacyWizard(null).excluded === false && needsLegacyWizard({ rows: [] }).excluded === false, 'doc vacío no excluido');

    const mkNodes = (codes) => codes.map(c => ({ normalizedCode: c, code: c }));
    const puctLike = { nodes: Array.from({ length: 150 }, (_, i) => ({ normalizedCode: String((i % 5) + 1), code: String((i % 5) + 1) })) };
    const rC = hasSingleDigitSymptom([puctLike]);
    criterion('H6.symptomHit', rC.excluded === true && rC.signal === 'single-digit-contract', 'contrato 150n×5 códigos 1-dígito → síntoma');
    const dashLike = { nodes: mkNodes(['100-00-00', '100-10-00', '100-10-01']) };
    criterion('H7.symptomMiss', hasSingleDigitSymptom([dashLike]).excluded === false && hasSingleDigitSymptom([]).excluded === false, 'contrato sano / vacío → sin síntoma');

    const guardSrc = fs.readFileSync(path.join(importDir, 'puctGuard.js'), 'utf8');
    criterion('H8.pure', !/^\s*import\s/m.test(guardSrc) && !guardSrc.includes('require('), 'puctGuard.js: cero dependencias (puro)');
}

// ─────────────────────────────────────────────────────────────
// I. IMPORT LOG (U-9: monitoreo sin PII, D3 sin companyId)
// ─────────────────────────────────────────────────────────────
{
    const logSrc = fs.readFileSync(path.join(importDir, 'importLog.js'), 'utf8');
    const idHits = ['companyId', 'company_id', 'selectedCompany', 'nit', 'legal_name']
        .filter(t => new RegExp(`\\b${t}\\b`).test(logSrc));
    criterion('I1.noIdentifiers', idHits.length === 0, 'importLog sin identificadores empresariales' + (idHits.length ? ` — hallado: ${idHits.join(',')}` : ''));
    criterion('I2.emptyEnv', JSON.stringify(readImportLog()) === '[]' && countImportLog() === 0, 'sin window: lectura vacía determinista');
    const rec = appendImportLog({ at: 123, fileName: 'x.csv', nodes: 3, successCount: 3, errorCount: 0, companyPut: 'skipped', fp: 'abc', status: 'completed', companyId: 999 });
    const keys = Object.keys(rec).sort().join(',');
    criterion('I3.recordShape', keys === 'at,companyPut,errorCount,fileName,fp,nodes,status,successCount' && !('companyId' in rec), `registro con campos exactos y sin companyId (${keys})`);
}

// ─────────────────────────────────────────────────────────────
// G. FEATURE FLAG (lógica pura; en Node no hay window → default legacy)
// ─────────────────────────────────────────────────────────────
{
    criterion('B21.flagDefault', getImportEngineMode() === 'legacy' && isUniversalEnabled() === false, 'sin window/URL/storage → default legacy (producción intacta por defecto)');
    criterion('B21b.flagSet', setImportEngineMode('universal') === 'universal', 'setImportEngineMode acepta valores válidos sin lanzar');
    let threw = false;
    try { setImportEngineMode('turbo'); } catch { threw = true; }
    criterion('B21c.flagInvalid', threw, 'setImportEngineMode rechaza valores inválidos');
}

// ─────────────────────────────────────────────────────────────
// C. CSV (capacidad nueva vs legacy)
// ─────────────────────────────────────────────────────────────
{
    const text = 'CODIGO,NOMBRE\n1,ACTIVO\n11,CAJA\n1101,CAJA MN\n';
    const csvFile = new File([text], 'plan.csv', { type: 'text/csv' });
    const doc = await CsvAdapter.extract(csvFile);
    const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(doc);
    const totalNodes = analysis.regions.reduce((s, r) => s + r.nodes.length, 0);
    criterion('C1.csv', analysis.regions.length >= 1 && totalNodes >= 2, `CSV: ${analysis.regions.length} región(es), ${totalNodes} nodos`);
    const s = S.createImportSession({ source: { fileName: 'plan.csv' }, regions: analysis.regions });
    criterion('C2.csvSession', S.summaryOf(s).nodeCounts.original >= 2, 'CSV produce sesión diagnosticable');
}

// ─────────────────────────────────────────────────────────────
// D. FORMATOS
// ─────────────────────────────────────────────────────────────
{
    criterion('D1.unsupported', detectFormat('plan.docx') === null, 'detectFormat(.docx) = null (detenerse, no adivinar)');
    criterion('D2.adapters',
        detectFormat('a.CSV') === CsvAdapter && detectFormat('b.PDF') === PdfAdapter && detectFormat('c.XLSX') === ExcelAdapter,
        'detectFormat resuelve CSV/PDF/Excel (case-insensitive)');
}

// ─────────────────────────────────────────────────────────────
// RESUMEN
// ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(95));
console.log(`RESULTADO WIZARD U-8: ${PASS} PASS / ${FAIL} FAIL — ${elapsed()}`);
console.log('='.repeat(95));
console.log('\n── CRITERIOS ──');
for (const c of CRITERIA) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.id} — ${c.detail}`);
}
process.exit(FAIL > 0 ? 1 : 0);
