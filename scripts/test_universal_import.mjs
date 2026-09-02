#!/usr/bin/env node
/**
 * test_universal_import.mjs — Pruebas del UniversalPlanAnalyzer
 * contra los 6 formatos reales de PUCT/ + 7 sintéticos tramposos.
 *
 * Uso: node scripts/test_universal_import.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const require2 = createRequire(import.meta.url);

// Carga xlsx desde el cliente (donde está instalado)
let XLSX;
try {
    XLSX = require2(path.join(root, 'web-app/client/node_modules/xlsx'));
} catch {
    XLSX = require2('xlsx');
}

import { UniversalPlanAnalyzer } from '../web-app/client/src/utils/UniversalPlanAnalyzer.js';
import { AccountPlanProfile } from '../web-app/client/src/utils/AccountPlanProfile.js';

function readSheetRows(file, sheet) {
    const wb = XLSX.readFile(path.join(root, file));
    const ws = wb.Sheets[sheet || wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
    return rows;
}

function printHeader(title) {
    console.log('\n' + '='.repeat(70));
    console.log(title);
    console.log('='.repeat(70));
}

function testRealSheets() {
    printHeader('PRUEBAS REALES — Archivos de PUCT/');
    const tests = [
        { file: 'PUCT/puct.xlsx', sheet: 'PUCT', desc: 'PUCT oficial 5 columnas (C/G/SG/CP/CA)' },
        { file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja1', desc: 'Industrial 6N dual (100000 + jerárquico)' },
        { file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja2', desc: 'Plano con guiones 100-10-01' },
        { file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Plan de cuentas ASFI', desc: 'ASFI con Cuenta Padre explícita (dots)' },
        { file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja5', desc: 'Longitud variable sin separador (1,11,1105...)' },
        { file: 'PUCT/Planes de cuentas.xlsx', sheet: 'Hoja6', desc: 'PGC Español 1 col con punto final' },
    ];

    for (const t of tests) {
        console.log(`\n--- ${t.desc} — ${t.file}:${t.sheet} ---`);
        try {
            const rows = readSheetRows(t.file, t.sheet);
            console.log(`Filas: ${rows.length}  Columnas: ${Object.keys(rows[0]||{}).join(', ').slice(0,120)}`);
            // Intenta detectar código y nombre
            const headers = Object.keys(rows[0]||{});
            console.log(`Headers: ${headers.join(' | ').slice(0,180)}`);

            // Heurística para elegir columna código
            const codeCandidates = headers.filter(h => /c[oó]digo|codigo|code/i.test(h));
            console.log(`Candidatas código: ${codeCandidates.join(', ') || '(ninguna, usa primera col)'}`);

            // Muestra 5 filas de ejemplo
            for (let i = 0; i < Math.min(5, rows.length); i++) {
                const r = rows[i];
                const vals = headers.slice(0,5).map(h => String(r[h] ?? '').slice(0,30));
                console.log(`  fila${i+1}: ${vals.join(' | ')}`);
            }

            // Para PUCT multi-columna, detecta diagonal
            if (headers.includes('C') && headers.includes('G')) {
                const mc = UniversalPlanAnalyzer.detectMultiColumn(headers, rows.slice(0,15));
                console.log(`Multi-columna detectada: ${mc.isMultiColumn} (fuzzy=${mc.hasFuzzyPUCT}, diagonal=${mc.diagonalScore})`);
                if (mc.isMultiColumn) {
                    const fused = UniversalPlanAnalyzer.fuseMultiColumnRow(rows[4], headers);
                    console.log(`  Fusión ejemplo fila5: "${fused}"`);
                }
            }

            // Construye accounts para análisis (elige primera columna de código encontrada)
            let codeHeader = codeCandidates[0] || headers[0];
            // Hoja1 tiene dos: CÓDIGO 6N y CÓDIGO JERÁRQUICO — prueba ambos
            if (t.sheet === 'Hoja1') {
                const cands = headers.filter(h => /c[oó]digo/i.test(h));
                if (cands.length >= 2) {
                    const candData = cands.map(h => ({
                        header: h,
                        codes: rows.slice(0, 100).map(r => String(r[h] ?? '')).filter(Boolean)
                    }));
                    const choice = UniversalPlanAnalyzer.chooseRealCodeColumn(candData);
                    console.log(`Doble código — detalles:`);
                    choice.details.forEach(d => console.log(`  ${d.header}: uniq=${d.uniqRate.toFixed(2)} prefixRate=${d.prefixRate.toFixed(2)} score=${d.score.toFixed(2)}`));
                    console.log(`  Elegido: ${choice.chosen.header}`);
                    codeHeader = choice.chosen.header;
                }
            }

            const nameHeader = headers.find(h => /nombre|descripci[oó]n|cuenta/i.test(h) && !/c[oó]digo/i.test(h)) || headers[1] || headers[0];
            const accounts = rows.slice(0, 500).map(r => ({
                code: String(r[codeHeader] ?? '').trim(),
                name: String(r[nameHeader] ?? '').trim()
            })).filter(a => a.code && !/c[oó]digo/i.test(a.code.toLowerCase()));

            console.log(`Accounts para análisis: ${accounts.length} (code="${codeHeader}", name="${nameHeader}")`);
            if (accounts.length > 0) {
                const result = UniversalPlanAnalyzer.analyzeUniversal(accounts.slice(0,300), headers, rows.slice(0,20));
                console.log(`  Separador: ${result.separator || '(ninguno)'}  Niveles: ${result.levelsCount}  Segmentos: ${result.segments.length}`);
                console.log(`  Warnings: ${result.warnings.join('; ') || 'ninguno'}`);
                console.log(`  Outliers: ${result.outliers.length}  ValidLengths: ${result.validLengths || '—'}`);
                if (result.rootTypeSuggestions.length > 0) {
                    console.log(`  Raíces sugeridas (requieren confirmación):`);
                    result.rootTypeSuggestions.slice(0,5).forEach(s => console.log(`    ${s.code} "${s.name.slice(0,30)}" → ${s.suggestedType} ${s.needsConfirmation?'[confirmar]':''}`));
                }
                // Muestra nivel calculado para 5 códigos de ejemplo
                console.log(`  Niveles de ejemplo:`);
                accounts.slice(0,5).forEach(a => {
                    const lvl = AccountPlanProfile.calculateLevel(a.code, result);
                    const parent = AccountPlanProfile.calculateParent(a.code, result);
                    console.log(`    ${a.code} → nivel ${lvl} padre=${parent || '—'}`);
                });
            }

        } catch (e) {
            console.error(`  ERROR: ${e.message}`);
            console.error(e.stack.split('\n').slice(0,4).join('\n'));
        }
    }
}

function testSynthetic() {
    printHeader('PRUEBAS SINTÉTICAS — Casos tramposos');

    // 1) Outlier de longitud
    console.log('\n[1] Outlier: 100 códigos válidos (long 1,2,4,6) + 1 dedazo long 5');
    {
        const codes = [];
        for (let i=0;i<25;i++) codes.push('1');
        for (let i=0;i<25;i++) codes.push('11');
        for (let i=0;i<25;i++) codes.push('1105');
        for (let i=0;i<25;i++) codes.push('110505');
        codes.push('12345'); // outlier long 5
        const accounts = codes.map((c,i)=>({code:c, name:`Cuenta ${i}`}));
        const res = UniversalPlanAnalyzer.analyzeUniversal(accounts);
        console.log(`  Outliers detectados: ${res.outliers.length} -> ${res.outliers.map(o=>`len${o.length} x${o.count}`).join(', ') || 'ninguno'}`);
        console.log(`  Warnings: ${res.warnings.join('; ')}`);
        console.log(`  ValidLengths: ${res.validLengths}`);
        console.log(res.outliers.length===1 && res.outliers[0].length===5 ? '  ✅ Outlier correctamente filtrado' : '  ❌ Falló filtro outlier');
    }

    // 2) Ciclo
    console.log('\n[2] Ciclo: A(100) padre B(110), B padre A');
    {
        const codes = ['100','110','111'];
        const parentMap = { '100':'110', '110':'100', '111':'110' };
        const res = UniversalPlanAnalyzer.validateParentMap(codes, parentMap);
        console.log(`  Ciclos: ${res.cycles.length} Orphans: ${res.orphans.length} isDAG=${res.isDAG}`);
        console.log(res.cycles.length>0 ? `  ✅ Ciclo detectado: ${res.cycles[0].join(' -> ')}` : '  ❌ No detectó ciclo');
    }

    // 3) Huérfano
    console.log('\n[3] Huérfano: 111.01 padre 111.99 inexistente');
    {
        const codes = ['100','110','111','111.01'];
        const parentMap = { '100':'', '110':'100', '111':'110', '111.01':'111.99' };
        const res = UniversalPlanAnalyzer.validateParentMap(codes, parentMap);
        console.log(`  Huérfanos: ${res.orphans.length} -> ${res.orphans.map(o=>`${o.code}→${o.parent}`).join(', ')}`);
        console.log(res.orphans.length===1 ? '  ✅ Huérfano detectado' : '  ❌ Falló');
        console.log(`  Raíz con padre vacío no es huérfano: ${res.orphans.find(o=>o.code==='100')?'❌':'✅'}`);
    }

    // 4) Doble código: jerárquico vs autonumérico (12 códigos para superar umbral 10)
    console.log('\n[4] Doble código: jerárquico [1,11,111,1111] vs autonumérico [1001,1002,1003,1004]');
    {
        const cand = [
            { header: 'jerárquico', codes: ['1','11','111','1111','1112','11','1','12','121','1211','1212','122'] },
            { header: 'autonumérico', codes: ['1001','1002','1003','1004','1005','1006','1007','1008','1009','1010','1011','1012'] }
        ];
        const choice = UniversalPlanAnalyzer.chooseRealCodeColumn(cand);
        console.log(`  Elegido: ${choice.chosen.header} (score ${choice.bestScore.toFixed(2)})`);
        choice.details.forEach(d=>console.log(`    ${d.header}: prefixRate=${d.prefixRate.toFixed(2)} uniq=${d.uniqRate.toFixed(2)}`));
        console.log(choice.chosen.header==='jerárquico' ? '  ✅ Eligió jerárquico' : '  ❌ Falló elección');
    }

    // 5) Sanitización extrema
    console.log('\n[5] Sanitización: NBSP, espacios múltiples, separadores repetidos, trailing dot');
    {
        const tests = [
            ['1\u00A0.\u00A0 1', '1.1'],
            ['100..01', '100.01'],
            ['100--01', '100-01'],
            ['  10.  ', '10'],
            ['1 - 1 - 1', '1-1-1'],
        ];
        let ok=true;
        for(const [inp, exp] of tests){
            const out = UniversalPlanAnalyzer.sanitizeCode(inp);
            const pass = out===exp;
            console.log(`  "${inp.replace(/\u00A0/g,'<NBSP>')}" → "${out}" (esperado "${exp}") ${pass?'✅':'❌'}`);
            if(!pass) ok=false;
        }
        console.log(ok?'  ✅ Sanitización OK':'  ❌ Alguna falló');
    }

    // 6) Confirmación de naturaleza raíz (sugerencia, no imposición)
    console.log('\n[6] Naturalezas raíz: debe sugerir y marcar needsConfirmation');
    {
        const accounts = [
            {code:'1', name:'ACTIVO'}, {code:'2', name:'PASIVO'}, {code:'3', name:'PATRIMONIO'},
            {code:'11', name:'Disponible'}, {code:'111', name:'Caja'}
        ];
        const res = UniversalPlanAnalyzer.analyzeUniversal(accounts);
        console.log(`  Sugerencias: ${res.rootTypeSuggestions.length}`);
        res.rootTypeSuggestions.forEach(s=> console.log(`    ${s.code} → ${s.suggestedType} needsConfirmation=${s.needsConfirmation}`));
        const allNeedConfirm = res.rootTypeSuggestions.every(s=>s.needsConfirmation);
        console.log(allNeedConfirm ? '  ✅ Todas requieren confirmación' : '  ❌ Alguna no requiere confirmación');
    }

    // 7) Multi-columna por comportamiento (no solo cabecera)
    console.log('\n[7] Multi-columna por diagonal (cabeceras genéricas Rubro/Subrubro)');
    {
        const headers = ['Rubro','Subrubro','Cuenta','Subcuenta','Auxiliar'];
        const rows = [
            {Rubro:'1', Subrubro:'', Cuenta:'', Subcuenta:'', Auxiliar:''},
            {Rubro:'1', Subrubro:'1', Cuenta:'', Subcuenta:'', Auxiliar:''},
            {Rubro:'1', Subrubro:'1', Cuenta:'1', Subcuenta:'', Auxiliar:''},
            {Rubro:'1', Subrubro:'1', Cuenta:'1', Subcuenta:'001', Auxiliar:''},
            {Rubro:'1', Subrubro:'1', Cuenta:'1', Subcuenta:'001', Auxiliar:'001'},
        ];
        const mc = UniversalPlanAnalyzer.detectMultiColumn(headers, rows);
        console.log(`  isMultiColumn: ${mc.isMultiColumn} (fuzzy=${mc.hasFuzzyPUCT}, diag=${mc.diagonalScore})`);
        console.log(mc.isMultiColumn ? '  ✅ Detectado por comportamiento' : '  ❌ No detectado');
        if (mc.isMultiColumn) {
            const fused = UniversalPlanAnalyzer.fuseMultiColumnRow(rows[4], headers);
            console.log(`  Fusión fila5: "${fused}" (esperado "1-1-1-001-001") ${fused==='1-1-1-001-001'?'✅':'❌'}`);
        }
    }
}

testRealSheets();
testSynthetic();
printHeader('FIN — Revisa arriba los ✅/❌');
