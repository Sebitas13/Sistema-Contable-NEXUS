#!/usr/bin/env node
/**
 * test_import_wizard_u2.mjs — Suite del UniversalImportWizard pasos 1–3 (Fase 7 U-3).
 *
 *  A. Alcance estático: el wizard nuevo no toca red/backend, no filtra
 *     inteligencia legacy (SmartImportWizard/AccountPlanProfile) y el montaje
 *     en Accounts.jsx conserva el fallback legacy.
 *  B. Contrato UI↔engine: con corpus real (DASH Hoja2) se verifica que cada
 *     campo que consumen Diagnóstico y Validación/Simulación existe con la
 *     forma esperada (incl. ImportContractValidator + simulate en memoria).
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

const WIZ_FILES = ['UniversalImportWizard.jsx', 'ImportFileStep.jsx', 'ImportDiagnosticStep.jsx', 'ImportValidationStep.jsx', 'engineFlag.js'];
const readWiz = (f) => fs.readFileSync(path.join(importDir, f), 'utf8');

// ─────────────────────────────────────────────────────────────
// A. ALCANCE ESTÁTICO
// ─────────────────────────────────────────────────────────────
{
    const contents = Object.fromEntries(WIZ_FILES.map(f => [f, readWiz(f)]));
    const components = WIZ_FILES.filter(f => f.endsWith('.jsx')).map(f => contents[f]).join('\n');
    const all = WIZ_FILES.map(f => contents[f]).join('\n');

    criterion('A1.noAxios', !all.includes('axios'), 'ningún archivo del wizard importa/usa axios');
    criterion('A2.noFetch', !components.includes('fetch('), 'componentes del wizard: sin fetch()');
    criterion('A3.noXhrWs', !all.includes('XMLHttpRequest') && !all.includes('WebSocket'), 'sin XMLHttpRequest ni WebSocket');
    criterion('A4.noApiCalls', !/axios|\.post\(|\.get\(|\.put\(|\.delete\(|XMLHttpRequest|WebSocket/.test(components), 'componentes: sin invocaciones HTTP (el nombre del endpoint destino aparece solo como texto informativo, jamás se llama)');
    criterion('A5.localStorageOnlyFlag',
        !components.includes('localStorage') && contents['engineFlag.js'].includes('importEngine'),
        'localStorage solo en engineFlag.js (clave importEngine)');
    criterion('A6.noLegacyIntel', !all.includes('SmartImportWizard') && !all.includes('AccountPlanProfile'), 'sin imports de SmartImportWizard ni AccountPlanProfile (cero inteligencia legacy)');

    // Allowlist de imports del orquestador
    const allow = new Set(['react', '../NexusModal.jsx', '../../utils/FormatAdapter.js', '../../utils/UniversalPlanAnalyzer.js', '../../importSession/index.js', './ImportFileStep.jsx', './ImportDiagnosticStep.jsx', './ImportValidationStep.jsx']);
    const imports = [...contents['UniversalImportWizard.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    const bad = imports.filter(i => !allow.has(i) && !i.startsWith('react'));
    criterion('A7.importAllowlist', imports.length > 0 && bad.length === 0, `imports del orquestador dentro de la allowlist (${imports.length} imports)${bad.length ? ' — fuera: ' + bad.join(',') : ''}`);

    const diagImports = [...contents['ImportDiagnosticStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A8.diagImports', diagImports.every(i => i === 'react' || i === '../../importSession/index.js'), 'ImportDiagnosticStep solo importa react + importSession (solo renderiza)');
    const fileImports = [...contents['ImportFileStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A9.fileImports', fileImports.every(i => i === 'react'), 'ImportFileStep solo importa react (presentacional puro)');
    const valImports = [...contents['ImportValidationStep.jsx'].matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    criterion('A11.valImports', valImports.every(i => i === 'react' || i === '../../importSession/index.js' || i === '../../utils/ImportContractValidator.js'), 'ImportValidationStep: react + importSession + Validator del engine (presenta veredictos, no decide)');

    const accounts = fs.readFileSync(path.join(root, 'web-app/client/src/pages/Accounts.jsx'), 'utf8');
    criterion('A10.mountFallback',
        accounts.includes('SmartImportWizard') && accounts.includes('UniversalImportWizard') && accounts.includes('isUniversalEnabled()'),
        'Accounts.jsx conserva SmartImportWizard (fallback) + montaje condicional por isUniversalEnabled()');
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
console.log(`RESULTADO WIZARD U-3: ${PASS} PASS / ${FAIL} FAIL — ${elapsed()}`);
console.log('='.repeat(95));
console.log('\n── CRITERIOS ──');
for (const c of CRITERIA) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.id} — ${c.detail}`);
}
process.exit(FAIL > 0 ? 1 : 0);
