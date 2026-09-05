#!/usr/bin/env node
/**
 * shadow_differential.mjs — Diferencial shadow legacy vs universal (Fase 7 U-7).
 *
 * Por archivo del corpus definido: réplica documentada del pipeline legacy
 * (filtros + configs + AccountPlanProfile, ver ShadowComparator) vs contrato
 * universal por la RUTA CANÓNICA (ExcelAdapter + analyzeCanonicalDocument,
 * la misma que usa el wizard y el E2E de navegador).
 *
 * Veredictos: SAME | IMPROVEMENT | INTENTIONAL_CHANGE | REGRESSION | UNKNOWN.
 * Gate: 0 REGRESSION y 0 UNKNOWN sin allowlist en el corpus definido.
 * UNKNOWN falla en cerrado (exige triage humano, no se oculta).
 * PGC = VACUOUS (ninguna ruta automática lo cubre; parser especial aparte).
 * Hoja1 = INFORMATIONAL (el comportamiento legacy en dual-code es indefinido
 * por construcción: longitudes arbitrarias (i+1)*2).
 *
 * Uso: node scripts/shadow_differential.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const require2 = createRequire(import.meta.url);
const XLSX = require2(path.join(root, 'web-app/client/node_modules/xlsx'));

const { ExcelAdapter } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/FormatAdapter.js')).href);
const { UniversalPlanAnalyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);
const SC = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/ShadowComparator.js')).href);

const CRITERIA = [];
let PASS = 0, FAIL = 0;
function criterion(id, ok, detail = '') {
    CRITERIA.push({ id, ok, detail });
    if (ok) PASS++; else FAIL++;
    console.log(`${ok ? '✅' : '❌'} [${id}] ${detail}`);
}
const T0 = Date.now();
function elapsed() { return `${((Date.now() - T0) / 1000).toFixed(1)}s`; }

// Allowlist revisada por humano (empieza vacía; cada entrada cita evidencia).
// Formato: { file, code='*', field='*', reason }
const ALLOWLIST = [];

function readGrid(file, sheet) {
    const wb = XLSX.readFile(path.join(root, file));
    const ws = wb.Sheets[sheet];
    if (!ws) throw new Error(`hoja no encontrada: ${sheet}`);
    const records = XLSX.utils.sheet_to_json(ws, { defval: null });
    return SC.gridFromRecords(records);
}

async function universalContract(file, sheet) {
    const buf = fs.readFileSync(path.join(root, file));
    const f = new File([buf], path.basename(file));
    const doc = await ExcelAdapter.extract({ file: f, sheetName: sheet });
    const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(doc);
    return { analysis, contract: analysis.regions[0] || null, doc };
}

function sourceCodesOf(grid) {
    const set = new Set();
    for (const row of grid) {
        for (const cell of row) {
            const v = (cell ?? '').toString().trim();
            if (v) set.add(v);
        }
    }
    return set;
}

// ─────────────────────────────────────────────────────────────
// 0. AUTOPOLICÍA — el comparador es infra de test, no app
// ─────────────────────────────────────────────────────────────
{
    const src = fs.readFileSync(path.join(root, 'web-app/client/src/utils/ShadowComparator.js'), 'utf8');
    // Usos prohibidos (las rutas de corpus 'PUCT/*.xlsx' en specs no cuentan: no son imports).
    const bannedUses = [`from 'xlsx'`, `from "xlsx"`, 'XLSX.', 'pdfjs', 'fetch(', 'XMLHttpRequest', 'localStorage', 'document.', 'window.', `from 'react'`, 'axios'];
    const hits = bannedUses.filter(b => src.includes(b));
    criterion('Z1.pure', hits.length === 0, 'ShadowComparator sin React/red/DOM/parsers' + (hits.length ? ` — hallado: ${hits.join(',')}` : ''));
    const appDirs = ['pages', 'components', 'context', 'services'];
    const invaders = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!/\.(jsx?|html)$/.test(e.name)) continue;
            const content = fs.readFileSync(p, 'utf8');
            if (content.includes('ShadowComparator')) invaders.push(path.relative(root, p));
        }
    };
    for (const d of appDirs) walk(path.join(root, 'web-app/client/src', d));
    const engineFiles = ['UniversalPlanAnalyzer.js', 'FormatAdapter.js', 'CanonicalDocument.js', 'ImportContractSchema.js', 'ImportContractValidator.js', 'CompatibilityAdapter.js', 'AccountPlanProfile.js'];
    for (const f of engineFiles) {
        const content = fs.readFileSync(path.join(root, 'web-app/client/src/utils', f), 'utf8');
        if (content.includes('ShadowComparator')) invaders.push('utils/' + f);
    }
    criterion('Z2.scope', invaders.length === 0, 'ningún archivo de app/engine importa ShadowComparator' + (invaders.length ? ` — invasores: ${invaders.join(',')}` : ''));
    criterion('Z3.allowlistEmpty', ALLOWLIST.length === 0, `allowlist empieza vacía (${ALLOWLIST.length} entradas)`);
}

// ─────────────────────────────────────────────────────────────
// 1. MECANISMO — la clasificación funciona (sintético)
// ─────────────────────────────────────────────────────────────
{
    const fakeContract = (nodes) => ({ nodes });
    const N = (code, extra = {}) => Object.assign({
        code, rawCode: code, name: 'N-' + code, normalizedCode: code, transformations: [],
        requiresReview: false, level: 1, parent: null,
        parentInfo: { code: null, method: 'EXPLICIT', confidence: 1, evidence: [], requiresReview: false },
        type: 'Activo', nature: 'EXPLICIT', classification: 'LEAF', isPostable: 'EXPLICIT_TRUE'
    }, extra);
    const src = new Set(['1', '11', '111']);

    // SAME total
    let r = SC.classify(
        [{ code: '1', name: 'N-1', level: 1, parent_code: null }],
        fakeContract([N('1')]),
        { file: 'T', sourceCodes: src });
    criterion('M1.same', r.verdict === 'PASS' && r.counts.SAME === 1, 'idéntico → PASS/SAME');

    // only_in_universal con traza → IMPROVEMENT
    r = SC.classify(
        [{ code: '1', name: 'N-1', level: 1, parent_code: null }],
        fakeContract([N('1'), N('11', { name: 'N-11' })]),
        { file: 'T', sourceCodes: src });
    criterion('M2.improvement', r.counts.IMPROVEMENT === 1 && r.verdict === 'PASS', 'fila recuperada con traza → IMPROVEMENT (no bloquea)');

    // only_in_legacy → REGRESSION
    r = SC.classify(
        [{ code: '1', name: 'N-1', level: 1, parent_code: null }, { code: '11', name: 'N-11', level: 2, parent_code: '1' }],
        fakeContract([N('1')]),
        { file: 'T', sourceCodes: src });
    criterion('M3.regression', r.verdict === 'REGRESSION' && r.counts.REGRESSION === 1, 'fila perdida → REGRESSION (bloquea)');

    // allowlist convierte a INTENTIONAL_CHANGE con cita
    r = SC.classify(
        [{ code: '1', name: 'N-1', level: 1, parent_code: null }, { code: '11', name: 'N-11', level: 2, parent_code: '1' }],
        fakeContract([N('1')]),
        { file: 'T', sourceCodes: src, allowlist: [{ file: 'T', code: '11', field: 'membership', reason: 'rechazo correcto documentado' }] });
    criterion('M4.allowlist', r.verdict === 'PASS' && r.counts.INTENTIONAL_CHANGE === 1 && /rechazo correcto/.test(r.items[0].reason), 'allowlist reclasifica con cita');

    // parent: legacy dangling + universal en-set → IMPROVEMENT
    r = SC.classify(
        [{ code: '100', name: 'N', level: 3, parent_code: '10' }],
        fakeContract([
            N('100', { level: 3, parent: '100-00', parentInfo: { code: '100-00', method: 'X', confidence: 1, evidence: [], requiresReview: false } }),
            N('100-00', { level: 2, parent: null })
        ]),
        { file: 'T', sourceCodes: new Set(['100', '100-00']) });
    const pv = r.items.find(i => i.field === 'parent');
    criterion('M5.parentFix', pv && pv.verdict === 'IMPROVEMENT', 'padre dangling en legacy + en-set en universal → IMPROVEMENT');

    // name distinto → UNKNOWN (falla en cerrado)
    r = SC.classify(
        [{ code: '1', name: 'OTRO', level: 1, parent_code: null }],
        fakeContract([N('1')]),
        { file: 'T', sourceCodes: src });
    criterion('M6.unknown', r.verdict === 'UNKNOWN', 'nombre distinto → UNKNOWN (bloquea hasta triage)');
}

// ─────────────────────────────────────────────────────────────
// 2. DIFERENCIAL EN CORPUS
//    - gated (DASH, ASFI): paridad automática determinista → gate estricto
//      0 REGRESSION + 0 UNKNOWN.
//    - informational (PUCT5C, VARLEN, Hoja1): el legacy-automático es
//      degenerado en estos formatos (ver hallazgos U-7); se reporta sin gate.
// ─────────────────────────────────────────────────────────────
const MODES = { DASH: 'gated', ASFI: 'gated', PUCT5C: 'informational', VARLEN: 'informational' };
for (const spec of SC.DIFFERENTIAL_CORPUS) {
    const mode = MODES[spec.key] || 'gated';
    try {
        const grid = readGrid(spec.file, spec.sheet);
        const { tuples, droppedTitles } = SC.tuplesFromGrid(grid, spec.kind);
        const detected = SC.detectLegacyKind(tuples);
        // La suite construye con el kind DETECTADO (= lo que el wizard haría).
        const legacy = SC.buildLegacyPreview(detected.kind, tuples);
        const { analysis, contract } = await universalContract(spec.file, spec.sheet);
        if (!contract) {
            criterion(`${spec.key}.regions`, false, `${spec.key}: la ruta canónica no produjo regiones`);
            continue;
        }
        const result = SC.classify(legacy.rows, contract, { file: spec.key, sourceCodes: sourceCodesOf(grid), allowlist: ALLOWLIST });
        const s = result.summary;
        console.log(`   ${spec.key} [${mode}]: legacy-kind=${detected.kind} legacyU=${s.legacyCount} universalU=${s.universalCount} matched=${s.matched} SAME=${s.SAME} IMP=${s.IMPROVEMENT} INT=${s.INTENTIONAL_CHANGE} REG=${s.REGRESSION} UNK=${s.UNKNOWN} (legacy-descartadas=${legacy.dropped}, regiones=${analysis.regions.length})`);
        for (const it of result.items.filter(i => i.verdict === 'REGRESSION' || i.verdict === 'UNKNOWN').slice(0, 8)) {
            console.log(`      [${it.verdict}] ${it.code} ${it.field}: legacy=${JSON.stringify(it.legacy)?.slice(0, 60)} universal=${JSON.stringify(it.universal)?.slice(0, 60)} — ${it.reason}`);
        }
        if (mode === 'gated') {
            criterion(`${spec.key}.gate`, result.verdict === 'PASS', `${spec.key}: veredicto ${result.verdict} (REG=${s.REGRESSION} UNK=${s.UNKNOWN})`);
        } else {
            criterion(`${spec.key}.reported`, true, `${spec.key} [informational]: REG=${s.REGRESSION} UNK=${s.UNKNOWN} IMP=${s.IMPROVEMENT} — ver §U-7 hallazgos`);
        }
    } catch (e) {
        criterion(`${spec.key}.exception`, false, `${spec.key}: excepción ${e.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// 2b. HALLAZGO U-7/PUCT: fusión multicolumna sin cablear
// ─────────────────────────────────────────────────────────────
{
    try {
        const { contract } = await universalContract('PUCT/puct.xlsx', 'PUCT');
        const uniq = new Set((contract ? contract.nodes : []).map(n => n.normalizedCode));
        const singleDigit = [...uniq].every(c => /^[1-9]$/.test(c));
        const analyzerSrc = fs.readFileSync(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js'), 'utf8');
        const fuseCalls = (analyzerSrc.match(/fuseMultiColumnRow\(/g) || []).length;
        const detectCalls = (analyzerSrc.match(/detectMultiColumn\(/g) || []).length;
        // 1 definición + 0 llamadas = 1 aparición de cada nombre en el fuente.
        criterion('PUCT5C.fusionGap', singleDigit && uniq.size <= 9 && fuseCalls <= 1 && detectCalls <= 1,
            `canónico PUCT5C: ${uniq.size} códigos únicos (${[...uniq].slice(0, 9).join(',')}) — fusión sin cablear (fuse×${fuseCalls}, detect×${detectCalls} menciones). Engine gap documentado, no gate.`);
    } catch (e) {
        criterion('PUCT5C.fusionGap', false, `excepción ${e.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// 3. PGC = VACUOUS (ninguna ruta automática lo cubre)
// ─────────────────────────────────────────────────────────────
{
    try {
        const grid = readGrid('PUCT/Planes de cuentas.xlsx', 'Hoja6');
        const { tuples } = SC.tuplesFromGrid(grid, 'generic');
        const legacy = SC.buildLegacyPreview('generic', tuples);
        const { contract } = await universalContract('PUCT/Planes de cuentas.xlsx', 'Hoja6');
        const uCount = contract ? contract.nodes.length : 0;
        const vacuous = legacy.rows.length < 10 && uCount < 10;
        criterion('PGC.vacuous', vacuous, `PGC: legacy=${legacy.rows.length} universal=${uCount} — VACUOUS documentado (parser especial cubierto en Node, no auto-seleccionado)`);
    } catch (e) {
        criterion('PGC.exception', false, `PGC: excepción ${e.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// 4. Hoja1 = INFORMATIONAL (legacy indefinido en dual-code)
// ─────────────────────────────────────────────────────────────
{
    try {
        const grid = readGrid('PUCT/Planes de cuentas.xlsx', 'Hoja1');
        const { tuples } = SC.tuplesFromGrid(grid, 'generic');
        const legacy = SC.buildLegacyPreview('generic', tuples);
        const { contract } = await universalContract('PUCT/Planes de cuentas.xlsx', 'Hoja1');
        const uCount = contract ? contract.nodes.length : 0;
        console.log(`   Hoja1: legacy(genérico)=${legacy.rows.length} universal=${uCount} — INFORMATIONAL (legacy aplica longitudes (i+1)*2 arbitrarias en dual-code)`);
        criterion('HOJA1.reported', true, `Hoja1 reportada sin gate (legacy=${legacy.rows.length}, universal=${uCount})`);
    } catch (e) {
        criterion('HOJA1.exception', false, `Hoja1: excepción ${e.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// RESUMEN
// ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(95));
console.log(`RESULTADO SHADOW DIFFERENTIAL: ${PASS} PASS / ${FAIL} FAIL — ${elapsed()}`);
console.log('='.repeat(95));
console.log('\n── CRITERIOS ──');
for (const c of CRITERIA) {
    console.log(`${c.ok ? '✅' : '❌'} ${c.id} — ${c.detail}`);
}
process.exit(FAIL > 0 ? 1 : 0);
