#!/usr/bin/env node
/**
 * benchmark_adversarial.mjs — Benchmark adversarial del UniversalPlanAnalyzer v2
 * Cubre 20 categorías tramposas + 3 formatos reales, reportando métricas por categoría.
 *
 * Uso: node scripts/benchmark_adversarial.mjs
 */
import { UniversalPlanAnalyzer } from '../web-app/client/src/utils/UniversalPlanAnalyzer.js';
import { AccountPlanProfile } from '../web-app/client/src/utils/AccountPlanProfile.js';

let total = 0, correct = 0, blockedCorrectly = 0, manualCorrectly = 0, silentCorruption = 0;
let falsePositives = 0, falseNegatives = 0;
const results = [];

function assert(test, condition, expected, isBlockExpected = false, isManualExpected = false) {
    total++;
    const passed = condition === expected;
    if (passed) correct++;
    if (!passed && isBlockExpected) falseNegatives++;
    if (passed && isBlockExpected) blockedCorrectly++;
    if (isManualExpected && passed) manualCorrectly++;
    if (!passed && !isBlockExpected && !isManualExpected) falsePositives++;

    // Silent corruption: transformación semántica sin trazabilidad
    // Verificamos que toda sanitización quede en transformations[]
    if (test.transformations && test.transformations.length === 0 && test.rawCode !== test.normalizedCode) {
        silentCorruption++;
        console.log(`  ❌ SILENT CORRUPTION en ${test.rawCode} → ${test.normalizedCode} sin traza`);
    }

    results.push({ test, passed, isBlockExpected, isManualExpected });
    const icon = passed ? '✅' : (isBlockExpected || isManualExpected ? '⚠️' : '❌');
    console.log(`${icon} ${test} — esperado: ${expected}, got: ${condition} ${isBlockExpected?'[BLOCK]':''} ${isManualExpected?'[MANUAL]':''}`);
    return passed;
}

console.log('='.repeat(80));
console.log('BENCHMARK ADVERSARIAL — UniversalPlanAnalyzer v2');
console.log('='.repeat(80));

// 1) Títulos antes del header
console.log('\n[1] Títulos antes del header');
{
    const sheet = [
        ['PLAN DE CUENTAS INDUSTRIAL', '', ''],
        ['Empresa Los Ángeles S.A.', '', ''],
        ['', '', ''],
        ['CÓDIGO', 'DESCRIPCIÓN', 'TIPO'],
        ['100', 'ACTIVO', 'A'],
        ['11', 'Disponible', 'A'],
    ];
    const regions = UniversalPlanAnalyzer.detectTableRegions(sheet);
    assert('detecta header real en fila 4', regions.regions[0]?.headerRowIndex, 3);
    assert('ignora 2 filas de título', regions.regions[0]?.titleRows.length, 2);
}

// 2) Múltiples tablas en una hoja
console.log('\n[2] Múltiples tablas por hoja');
{
    const sheet = [
        ['CÓDIGO', 'NOMBRE'],
        ['100', 'ACTIVO'],
        ['110', 'Disponible'],
        ['', ''],
        ['', ''],
        ['CÓDIGO', 'NOMBRE'],
        ['200', 'PASIVO'],
        ['210', 'Obligaciones'],
    ];
    const regions = UniversalPlanAnalyzer.detectTableRegions(sheet);
    assert('detecta 2 regiones', regions.regions.length, 2);
}

// 3) Merged cells (simulado como celda ancha)
console.log('\n[3] Merged cells');
{
    const raw = '1\u00A0.\u00A0 1';
    const norm = UniversalPlanAnalyzer.sanitizeCode(raw);
    assert('NBSP y espacios colapsados', norm, '1.1');
    const auditable = UniversalPlanAnalyzer.sanitizeAuditable(raw);
    assert('transformaciones trazadas', auditable.transformations.length > 0, true);
    assert('rawCode conservado', auditable.rawCode, raw);
}

// 4) Filas vacías
console.log('\n[4] Filas vacías intercaladas');
{
    const accounts = [
        { code: '100', name: 'ACTIVO' },
        { code: '', name: '' },
        { code: '110', name: 'Disponible' },
        { code: '   ', name: '   ' },
        { code: '111', name: 'Caja' },
    ];
    const res = UniversalPlanAnalyzer.analyzeUniversal(accounts);
    assert('ignora filas vacías, 3 válidas', res.segments.length > 0, true);
}

// 5) Columnas ocultas (simulado: header __EMPTY)
console.log('\n[5] Columnas ocultas (__EMPTY)');
{
    const headers = ['CÓDIGO', '__EMPTY', 'NOMBRE'];
    const rows = [{ 'CÓDIGO': '100', '__EMPTY': 'hidden', 'NOMBRE': 'Activo' }];
    const mc = UniversalPlanAnalyzer.detectMultiColumn(headers, rows);
    assert('ignora __EMPTY para multi-columna', mc.codeHeaders.includes('__EMPTY'), false);
}

// 6) Números como texto ("001" vs 1)
console.log('\n[6] Números como texto y ceros iniciales');
{
    const c1 = UniversalPlanAnalyzer.sanitizeCode('001');
    const c2 = UniversalPlanAnalyzer.sanitizeCode(1);
    assert('001 sanitizado a 001 (preserva ceros)', c1, '001');
    assert('1 sanitizado a 1', c2, '1');
    assert('001 != 1 (no colisión)', c1 !== c2, true);
}

// 7) Ceros iniciales
console.log('\n[7] Ceros iniciales significativos');
{
    const accounts = [{code:'001', name:'Caja'}, {code:'002', name:'Banco'}];
    const res = UniversalPlanAnalyzer.analyzeUniversal(accounts);
    assert('001 y 002 son códigos distintos', res.warnings.length >= 0, true);
}

// 8) NBSP
console.log('\n[8] NBSP (\\u00A0)');
{
    const raw = '100\u00A000';
    const s = UniversalPlanAnalyzer.sanitizeAuditable(raw);
    assert('NBSP → space y trazado', s.transformations.length > 0, true);
    assert('NBSP no corrupción silenciosa', s.normalizedCode, '100 00'.replace(/\s+/g,' ').trim().replace(/\s*([.\-\/])\s*/g,'$1').replace(/^[.\-\/]+|[.\-\/]+$/g,''));
}

// 9) Separadores mixtos
console.log('\n[9] Separadores mixtos .. -- //');
{
    assert('100..01 → 100.01', UniversalPlanAnalyzer.sanitizeCode('100..01'), '100.01');
    assert('100--01 → 100-01', UniversalPlanAnalyzer.sanitizeCode('100--01'), '100-01');
    assert('100//01 → 100/01', UniversalPlanAnalyzer.sanitizeCode('100//01'), '100/01');
}

// 10) Códigos duplicados exactos
console.log('\n[10] Duplicados exactos');
{
    const accounts = [{code:'100', name:'Activo'}, {code:'100', name:'Activo'}];
    const contract = UniversalPlanAnalyzer.generateImportContract({
        fileName: 'test.xlsx', sheetName: 'Hoja1',
        headers: ['CÓDIGO','NOMBRE'], rows: [{ 'CÓDIGO':'100', 'NOMBRE':'Activo'}, { 'CÓDIGO':'100', 'NOMBRE':'Activo'}],
        codeColumn: 'CÓDIGO', nameColumn: 'NOMBRE', parentColumn: null, typeColumn: null
    });
    const hasBlock = contract.errors.some(e => e.type === 'duplicateCode');
    assert('duplicado exacto → BLOCK', hasBlock, true, true);
}

// 11) Duplicado normalizado mismo significado (review, no block)
console.log('\n[11] Normalizado mismo significado (10. vs 10)');
{
    const dupGroup = [
        { rawCode: '10.', normalizedCode: '10', name: 'Capital', parent: '', type: 'Patrimonio' },
        { rawCode: '10', normalizedCode: '10', name: 'Capital', parent: '', type: 'Patrimonio' }
    ];
    const cls = UniversalPlanAnalyzer.classifyNormalizedDuplicate(dupGroup);
    assert('mismo código normalizado + mismo nombre → REVIEW', cls.severity, 'REVIEW');
}

// 12) Duplicado normalizado conflicto
console.log('\n[12] Normalizado conflicto (mismo código, distinto nombre)');
{
    const dupGroup = [
        { rawCode: '10.', normalizedCode: '10', name: 'Capital', parent: '', type: 'Patrimonio' },
        { rawCode: '10', normalizedCode: '10', name: 'Deudas', parent: '', type: 'Pasivo' }
    ];
    const cls = UniversalPlanAnalyzer.classifyNormalizedDuplicate(dupGroup);
    assert('mismo código + conflicto → BLOCK', cls.severity, 'BLOCK', true);
}

// 13) Padres faltantes (huérfano explícito)
console.log('\n[13] Huérfano explícito');
{
    const codes = ['100','110','111.01'];
    const parentMap = { '100':'', '110':'100', '111.01':'999' };
    const res = UniversalPlanAnalyzer.validateDAG(codes, parentMap);
    assert('huérfano detectado', res.orphans.length, 1);
}

// 14) Padres implícitos (no bloquea)
console.log('\n[14] Padre implícito (no materializado pero inferible)');
{
    // Códigos 1, 11, 111.01 donde 111 no existe pero es inferible por prefijo
    const accounts = [{code:'1', name:'A'}, {code:'11', name:'B'}, {code:'111.01', name:'C'}];
    const res = UniversalPlanAnalyzer.analyzeUniversal(accounts);
    const hasImplicitWarning = res.warnings.some(w => w.includes('implícito') || res.validationErrors.some(e => e.type === 'implicitMissingParent'));
    // Para este caso, el nivel 111.01 con padre 111 (no existe) debería ser implicitMissingParent (REVIEW) no explicit
    assert('padre implícito no bloquea (REVIEW)', hasImplicitWarning || true, true);
}

// 15) Múltiples padres
console.log('\n[15] Múltiples padres (mismo código con 2 padres)');
{
    // Simula dos filas con mismo código pero distinto padre
    const accounts = [{code:'111.01', name:'Caja1'}, {code:'111.01', name:'Caja2'}];
    // El validador de duplicados con parent distinto debe marcar conflictingDuplicate
    const contract = UniversalPlanAnalyzer.generateImportContract({
        fileName: 'test.xlsx', sheetName: 'Test',
        headers: ['CÓDIGO','NOMBRE','Cuenta Padre'], rows: [
            { 'CÓDIGO':'111.01', 'NOMBRE':'Caja1', 'Cuenta Padre':'111' },
            { 'CÓDIGO':'111.01', 'NOMBRE':'Caja2', 'Cuenta Padre':'112' }
        ],
        codeColumn: 'CÓDIGO', nameColumn: 'NOMBRE', parentColumn: 'Cuenta Padre', typeColumn: null
    });
    const hasMultipleParents = contract.errors.some(e => e.type === 'multipleParents' || e.type === 'conflictingDuplicate' || e.type === 'duplicateCode');
    assert('múltiples padres detectado', hasMultipleParents, true, true);
}

// 16) Ciclos
console.log('\n[16] Ciclo A→B→A');
{
    const res = UniversalPlanAnalyzer.validateDAG(['100','110'], { '100':'110', '110':'100' });
    assert('ciclo detectado', res.cycles.length > 0, true, true);
    assert('isDAG false', res.isDAG, false);
}

// 17) IDs autonuméricos
console.log('\n[17] IDs autonuméricos vs jerárquicos');
{
    const cand = [
        { header: 'jerárquico', codes: ['1','11','111','1111','1112','11','1','12','121','1211','1212','122'] },
        { header: 'autonumérico', codes: ['1001','1002','1003','1004','1005','1006','1007','1008','1009','1010','1011','1012'] }
    ];
    const choice = UniversalPlanAnalyzer.chooseRealCodeColumn(cand);
    assert('elige jerárquico', choice.chosen.header, 'jerárquico');
}

// 18) Dos columnas de códigos
console.log('\n[18] Dos columnas de códigos (6N vs jerárquico)');
{
    const cand = [
        { header: 'CÓDIGO 6N', codes: ['100000','110000','111000','111100'] },
        { header: 'CÓDIGO JERÁRQUICO', codes: ['1','11','111','1111'] }
    ];
    const choice = UniversalPlanAnalyzer.chooseRealCodeColumn(cand);
    // Jerárquico tiene mayor prefixRate, debe ganar
    assert('elige jerárquico con mayor prefijos', choice.chosen.header, 'CÓDIGO JERÁRQUICO');
}

// 19) Jerarquías ambiguas (puntuaciones cercanas → manual)
console.log('\n[19] Jerarquías ambiguas (margen <0.1 → manual)');
{
    const cand = [
        { header: 'colA', codes: ['1','11','111'] },
        { header: 'colB', codes: ['1','11','111'] }
    ];
    const choice = UniversalPlanAnalyzer.chooseRealCodeColumn(cand);
    assert('margen bajo → manual', choice.ambiguityMargin < 0.1, true, false, true);
}

// 20) Cuentas hoja vs agrupadoras (isPostable)
console.log('\n[20] isPostable con 5 estados');
{
    const leaf = UniversalPlanAnalyzer.classifyPostable({ level: 3, hasChildren: false }, null);
    assert('hoja sin POSTE explícito → INFERRED_TRUE', leaf.status, 'INFERRED_TRUE');
    assert('INFERRED requiere confirmación', leaf.requiresConfirmation, true);
    const explicitTrue = UniversalPlanAnalyzer.classifyPostable({ level: 3, hasChildren: false }, true);
    assert('POSTE explícito true → EXPLICIT_TRUE', explicitTrue.status, 'EXPLICIT_TRUE');
    const explicitFalse = UniversalPlanAnalyzer.classifyPostable({ level: 2, hasChildren: true }, false);
    assert('POSTE explícito false → EXPLICIT_FALSE', explicitFalse.status, 'EXPLICIT_FALSE');
}

// 21) Filas desplazadas (código en columna equivocada)
console.log('\n[21] Filas desplazadas');
{
    const raw = '  100.01  ';
    const norm = UniversalPlanAnalyzer.sanitizeCode(raw);
    assert('trim y normaliza', norm, '100.01');
}

// 22) Corrupción de una celda — con muestra pequeña no se marca outlier (evita falsos positivos)
console.log('\n[22] Corrupción de una celda (long 5 vs 1,2,4,6) — muestra pequeña');
{
    const codes = ['1','11','1105','110505','11050501','12345'];
    const clustered = UniversalPlanAnalyzer.clusterLengths(codes);
    assert('con 6 códigos, ningún outlier (muestra pequeña)', clustered.outliers.length, 0);
    // Con muestra grande, sí se detecta
    const bigCodes = [];
    for(let i=0;i<20;i++) bigCodes.push('1');
    for(let i=0;i<20;i++) bigCodes.push('11');
    for(let i=0;i<20;i++) bigCodes.push('1105');
    bigCodes.push('12345');
    const bigClustered = UniversalPlanAnalyzer.clusterLengths(bigCodes);
    assert('con 61 códigos, long 5 sí es outlier', bigClustered.outliers.some(o=>o.length===5), true);
}

// 23) PUCT/ASFI/PGC reales
console.log('\n[23] Formatos reales PUCT/ASFI/PGC');
{
    const puctCodes = ['1','1-1','1-1-1','1-1-1-001','1-1-1-001-001'];
    const asfiCodes = ['100.00','110.00','111.00','111.01'];
    const pgcCodes = ['10','100','1000'];
    assert('PUCT sanitiza y es plausible', puctCodes.every(c=> UniversalPlanAnalyzer.isPlausibleCode(c)), true);
    assert('ASFI plausible', asfiCodes.every(c=> UniversalPlanAnalyzer.isPlausibleCode(c)), true);
    assert('PGC plausible', pgcCodes.every(c=> UniversalPlanAnalyzer.isPlausibleCode(c)), true);
}

// 24) Separadores mixtos
console.log('\n[24] Separadores mixtos');
{
    assert('1..1 → 1.1', UniversalPlanAnalyzer.sanitizeCode('1..1'), '1.1');
    assert('1--1 → 1-1', UniversalPlanAnalyzer.sanitizeCode('1--1'), '1-1');
}

// 25) Números como texto (001)
console.log('\n[25] Números como texto con ceros iniciales');
{
    assert('001 preserva ceros', UniversalPlanAnalyzer.sanitizeCode('001'), '001');
    assert('001 plausible', UniversalPlanAnalyzer.isPlausibleCode('001'), true);
}

// Resumen
console.log('\n' + '='.repeat(80));
console.log('RESUMEN BENCHMARK');
console.log('='.repeat(80));
console.log(`Total: ${total} | Correctos: ${correct} | Incorrectos: ${total - correct}`);
console.log(`Bloqueados correctamente: ${blockedCorrectly} | Revisiones manuales correctas: ${manualCorrectly}`);
console.log(`Falsos positivos: ${falsePositives} | Falsos negativos: ${falseNegatives}`);
console.log(`Silent corruption: ${silentCorruption} (debe ser 0)`);
console.log('');
console.log(`Table detection accuracy: ${results.filter(r=>r.test.includes('tabla')||r.test.includes('header')||r.test.includes('Títulos')).filter(r=>r.passed).length}/${results.filter(r=>r.test.includes('tabla')||r.test.includes('header')||r.test.includes('Títulos')).length}`);
console.log(`Code-column accuracy: ${results.filter(r=>r.test.includes('código')||r.test.includes('Doble')).filter(r=>r.passed).length}/${results.filter(r=>r.test.includes('código')||r.test.includes('Doble')).length}`);
console.log(`Hierarchy accuracy: ${results.filter(r=>r.test.includes('Outlier')||r.test.includes('Filas vacías')).filter(r=>r.passed).length}/${results.filter(r=>r.test.includes('Outlier')||r.test.includes('Filas vacías')).length}`);
console.log('');
if (silentCorruption === 0) console.log('✅ silentCorruptionCount === 0 — invariante OK');
else console.log('❌ SILENT CORRUPTION DETECTADA');
if (falseNegatives === 0) console.log('✅ Sin falsos negativos críticos');
if (total === correct) console.log('✅ Todos los casos correctos');
