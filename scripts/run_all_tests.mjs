#!/usr/bin/env node
/**
 * run_all_tests.mjs — Runner formal de la suite de motores de importación.
 *
 * npm test → ejecuta, en orden:
 *   1. benchmark_adversarial.mjs   (casos tramposos sintéticos)
 *   2. shadow_tests.mjs            (goldens reales + verdad de tierra TXT/PDF)
 *   3. contract_audit.mjs          (auditoría de contrato: versionado, validador,
 *                                   reconciliación, idempotencia, performance)
 *   4. production_gate.mjs         (production readiness: fidelidad Excel, adapter
 *                                   forense, payload parity, pad-to-block II, etc.)
 *   5. test_import_session.mjs       (ImportSession U-1: capa pura de sesión)
 *   6. test_import_wizard_u2.mjs     (Wizard U-5: alcance estático + contrato UI↔engine)
 *
 * Exit code != 0 si alguna suite falla.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = [
    { file: 'benchmark_adversarial.mjs', label: 'Adversarial 42 casos' },
    { file: 'shadow_tests.mjs', label: 'Shadow/goldens reales' },
    { file: 'contract_audit.mjs', label: 'Auditoría de contrato' },
    { file: 'production_gate.mjs', label: 'Production readiness gate' },
    { file: 'test_import_session.mjs', label: 'ImportSession (U-1, puro)' },
    { file: 'test_import_wizard_u2.mjs', label: 'Wizard U-5 (pasos 1-6)' }
];

let failures = 0;
for (const suite of suites) {
    console.log(`\n${'='.repeat(70)}\n▶ SUITE: ${suite.label} (${suite.file})\n${'='.repeat(70)}`);
    const res = spawnSync(process.execPath, [path.join(__dirname, suite.file)], { stdio: 'inherit', encoding: 'utf8' });
    if (res.status !== 0) {
        console.error(`❌ Suite ${suite.file} FALLÓ (exit ${res.status})`);
        failures++;
    } else {
        console.log(`✅ Suite ${suite.file} OK`);
    }
}

console.log(`\n${'='.repeat(70)}`);
if (failures === 0) {
    console.log('✅ npm test: TODAS LAS SUITES PASAN');
} else {
    console.error(`❌ npm test: ${failures} suite(s) fallaron`);
}
process.exit(failures > 0 ? 1 : 0);
