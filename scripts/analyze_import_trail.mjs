#!/usr/bin/env node
/**
 * analyze_import_trail.mjs — Analiza una bitácora exportada del wizard universal.
 *
 * Modo de uso:
 *   node scripts/analyze_import_trail.mjs "<ruta al .json>" [--file="PUCT/Planes de cuentas.xlsx"]
 *
 * Hace:
 *  1. Resumen del camino: extracciones, análisis, validaciones, simulaciones,
 *     acciones del usuario (overrides/exclusiones/confirmaciones/resoluciones/
 *     bulk) y resultado.
 *  2. REPLAY DETERMINISTA: reconstruye la sesión desde el contrato del motor
 *     (mismo archivo y hoja de la última extracción) aplicando las acciones de
 *     la bitácora en orden, y compara la huella del payload con la registrada.
 *     Misma entrada + mismas acciones ⇒ misma huella.
 *
 * No forma parte de `npm test`: es una herramienta de monitoreo del piloto.
 * NO toca app, engine, backend, DB ni red.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const trailPath = args.find(a => !a.startsWith('--'));
const fileArg = (args.find(a => a.startsWith('--file=')) || '').slice('--file='.length) || 'PUCT/Planes de cuentas.xlsx';
if (!trailPath || !fs.existsSync(trailPath)) {
    console.error('Uso: node scripts/analyze_import_trail.mjs "<bitacora.json>" [--file="PUCT/Planes de cuentas.xlsx"]');
    process.exit(2);
}

const { ExcelAdapter } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/FormatAdapter.js')).href);
const { UniversalPlanAnalyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);
const S = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);
const { compactFingerprint } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/importTrail.js')).href);

const trail = JSON.parse(fs.readFileSync(trailPath, 'utf8'));
const ev = trail.events || [];
const countBy = (arr, fn) => {
    const m = new Map();
    for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log('BITÁCORA:', path.basename(trailPath));
console.log(`  id=${trail.id} archivo=${trail.fileName} fecha=${new Date(trail.at).toLocaleString()} eventos=${ev.length}`);
console.log('  eventos por tipo:', JSON.stringify(countBy(ev, e => e.kind)));

const ex = ev.filter(e => e.kind === 'extraction');
console.log('  extracciones:', ex.map(e => `hoja=${JSON.stringify(e.sheet)} filas=${e.rows}`).join(' | '));
const an = ev.filter(e => e.kind === 'analysis');
const lastA = an[an.length - 1];
if (lastA) for (const r of (lastA.regions || [])) {
    console.log(`  análisis: nodos=${r.nodes} blocks=${r.blocks} reviews=${r.reviews} reqConf=${r.requiresConfirmation}`);
}
for (const v of ev.filter(e => e.kind === 'validation')) {
    console.log(`  validación paso=${v.step} can=${v.can} motivos=${(v.reasons || []).length}${(v.reasons || []).length ? ' — p.ej. ' + String(v.reasons[0]).slice(0, 110) : ''}`);
}
for (const s of ev.filter(e => e.kind === 'simulation')) {
    console.log(`  simulación: allowed=${s.allowed} total=${s.total} atConfirm=${!!s.atConfirm} fp=${s.fingerprint ? String(s.fingerprint).length + ' chars' : '—'}`);
}
const acts = ev.filter(e => ['override', 'exclude', 'include', 'confirm', 'resolve', 'bulk'].includes(e.kind));
console.log('  acciones:', JSON.stringify(countBy(acts, e => e.kind)));
const bulks = ev.filter(e => e.kind === 'bulk');
if (bulks.length) console.log('  bulk:', JSON.stringify(bulks.map(b => ({ value: b.value, uids: (b.uids || []).length }))));
const lastRes = [...ev].reverse().find(e => e.kind === 'result');
console.log(lastRes
    ? `  resultado: ${lastRes.status} ok=${lastRes.successCount} err=${lastRes.errorCount} total=${lastRes.total} companyPut=${lastRes.companyPut}`
    : '  ⚠️ SIN evento result (import no confirmado, interrumpido o guardado fallido)');

// ── REPLAY ──
const sheet = ex.length ? ex[ex.length - 1].sheet : null;
if (!sheet) { console.log('\nREPLAY: sin extracción de hoja en la bitácora (no aplica).'); process.exit(0); }
try {
    const buf = fs.readFileSync(path.join(root, fileArg));
    const file = new File([buf], path.basename(fileArg));
    const doc = await ExcelAdapter.extract({ file, sheetName: sheet });
    const analysis = UniversalPlanAnalyzer.analyzeCanonicalDocument(doc);
    let session = S.createImportSession({ source: { fileName: path.basename(fileArg) }, regions: analysis.regions });
    let applied = 0; let skipped = 0;
    for (const e of ev) {
        try {
            if (e.kind === 'override') { session = S.applyOverride(session, e.uid, e.field, e.value); applied++; }
            else if (e.kind === 'exclude') { session = S.excludeRow(session, e.uid, true); applied++; }
            else if (e.kind === 'include') { session = S.excludeRow(session, e.uid, false); applied++; }
            else if (e.kind === 'confirm') { session = S.confirmNature(session, e.uid, e.nature); applied++; }
            else if (e.kind === 'resolve') { session = S.resolveReview(session, e.target); applied++; }
            else if (e.kind === 'bulk') { for (const uid of (e.uids || [])) { try { session = S.applyOverride(session, uid, 'type', e.value); } catch { skipped++; } } applied++; }
        } catch { skipped++; }
    }
    const sim = S.simulate(session, { companyId: null });
    const total = sim.expectedCounts ? sim.expectedCounts.total : sim.effectiveNodeCount;
    const lastSim = [...ev].reverse().find(e => e.kind === 'simulation');
    const fpNow = sim.fingerprint ? compactFingerprint(String(sim.fingerprint)) : null;
    const fpTrail = lastSim && lastSim.fingerprint ? String(lastSim.fingerprint) : null;
    console.log(`\nREPLAY (${fileArg} · hoja ${sheet}): acciones=${applied} omitidas=${skipped} canImport=${S.canImport(session)} total=${total}`);
    if (fpTrail && fpNow) {
        const matches = fpTrail.startsWith('u9fp1:')
            ? fpTrail === fpNow
            : fpTrail === String(sim.fingerprint);
        console.log(`REPLAY fingerprint: ${matches ? '✅ IDÉNTICO a la bitácora' : '❌ DIFIERE (revisar)'}`);
    } else {
        console.log('REPLAY fingerprint: no comparable (falta huella en bitácora o replay).');
    }
    if (lastRes && lastRes.status === 'completed') {
        console.log(`REPLAY vs resultado: ${total} vs ${lastRes.total} → ${total === lastRes.total ? '✅ coincide' : '❌ difiere'}`);
    }
} catch (err) {
    console.log('\nREPLAY: ❌ ' + err.message);
    process.exitCode = 1;
}
