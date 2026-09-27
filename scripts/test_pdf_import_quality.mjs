#!/usr/bin/env node
/**
 * Regresiones del importador PDF y fixtures publicos de planes de cuentas.
 * No escribe en la base de datos ni importa planes a ninguna empresa.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PdfAdapter, ExcelAdapter } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/FormatAdapter.js')).href);
const { UniversalPlanAnalyzer: Analyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);
const { AccountPlanProfile } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/AccountPlanProfile.js')).href);
const { applyOverride, canImportReport, createImportSession, effectiveContractOf, simulate } = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);
const { ImportContractValidator } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/ImportContractValidator.js')).href);

function localFile(relativePath) {
    return fs.readFileSync(path.join(root, relativePath));
}

async function analyzePdf(relativePath) {
    const bytes = Uint8Array.from(localFile(relativePath));
    const document = await PdfAdapter.extract(bytes);
    return { document, analysis: Analyzer.analyzeCanonicalDocument(document) };
}

// El PDF MEFP tiene el catalogo en paginas PDF 7-18; desde la 20 empieza la
// prosa descriptiva que repite codigos, pero no debe convertirse en cuentas.
{
    const { document, analysis } = await analyzePdf('PUCT/PlanDeCuentasPublicacionVer5.pdf');
    const section = Analyzer.selectPdfPlanSection(document);
    assert.equal(analysis.regions.length, 1, 'el catalogo PDF debe generar un solo contrato');
    assert.equal(section.method, 'section-heading');
    assert.deepEqual({ start: section.startPage, end: section.endPage }, { start: 7, end: 18 });

    const contract = analysis.regions[0];
    assert.equal(contract.region.extractionMode, 'narrative');
    assert.deepEqual(contract.region.pageRange, { start: 7, end: 18 });
    assert.equal(contract.nodes.length, 379, 'debe recuperar el catalogo sin importar pies ni prosa');
    assert.equal(contract.hierarchy.levelCount, contract.hierarchy.levelLengths.length,
        'el contador de niveles debe coincidir con las longitudes declaradas');
    assert.deepEqual(
        contract.nodes.slice(0, 3).map(node => [node.normalizedCode, node.name]),
        [['1', 'ACTIVO'], ['11', 'ACTIVO CORRIENTE'], ['111', 'Disponible']]
    );
    for (const code of ['11121', '11122', '11123', '11124', '11125', '11126', '11127', '11128', '11129']) {
        assert.ok(contract.nodes.some(node => node.normalizedCode === code), `no debe rechazar la cuenta ${code}`);
    }
    assert.equal(contract.nodes.filter(node => /grupo de cuentas del activo/i.test(node.name)).length, 0);
    assert.equal((contract.errors || []).filter(error => error.severity === 'BLOCK').length, 0);
    assert.equal((contract.rejectedRows || []).length, 0);

    const codeSet = new Set(contract.nodes.map(node => node.normalizedCode));
    const deepestNodes = contract.nodes.filter(node => node.level === contract.hierarchy.levelCount);
    assert.ok(deepestNodes.length > 0);
    assert.ok(deepestNodes.every(node => node.parent && codeSet.has(node.parent) && !node.parentInfo.requiresReview),
        'el padre inmediato de cada cuenta del ultimo nivel debe existir en el plan');

    const rootIndex = contract.nodes.findIndex(node => node.normalizedCode === '2');
    const session = createImportSession({ regions: [contract] });
    const correctedRoot = applyOverride(session, `${session.regions[0].regionId}:${rootIndex}`, 'code', '3');
    const correctedRootGate = canImportReport(correctedRoot);
    assert.ok(correctedRootGate.reasons.some(reason => reason.includes('padre «2»') && reason.includes('ya no existe')),
        'una correccion de codigo no puede dejar que hijos sigan apuntando al codigo anterior');
    assert.equal(simulate(correctedRoot).allowed, false,
        'la simulacion tampoco debe ofrecer un payload con referencias a padres inexistentes');
    assert.equal(ImportContractValidator.validate(effectiveContractOf(correctedRoot)).valid, false,
        'el validador independiente debe rechazar referencias a padres no materializados');

    const decimalProse = Analyzer.extractNarrativeAccounts([
        { text: '1.5 millones de bolivianos', allowDelimitedCode: false },
        { text: '1.1 ACTIVO CORRIENTE', allowDelimitedCode: true }
    ]);
    assert.equal(decimalProse.accounts.some(account => account.code === '1.5'), false);
    assert.equal(decimalProse.accounts.some(account => account.code === '1.1'), true);
}

// La derivación del padre distingue prefijos consecutivos de códigos con
// bloques de relleno sin depender del nombre del plan ni de códigos concretos.
{
    assert.equal(AccountPlanProfile.calculateParent('98765', {
        hasSeparator: false, levelLengths: [1, 2, 3, 4, 5], levelCount: 5
    }), '98760', 'regresión: el helper compartido conserva el relleno histórico para el importador clásico');
    assert.equal(AccountPlanProfile.calculateParent('123456789', {
        hasSeparator: false, levelLengths: [1, 2, 3, 6, 9], levelCount: 5
    }), '123456000');
    assert.equal(AccountPlanProfile.calculateParent('123456', {
        hasSeparator: false, levelLengths: [2, 4, 6], levelCount: 3,
        materializedCodes: new Set(['123456', '1234', '123400'])
    }), '1234', 'un prefijo de nivel ya materializado prevalece sobre el relleno candidato');
    assert.equal(AccountPlanProfile.calculateParent('123456', {
        hasSeparator: false, levelLengths: [2, 4, 6], levelCount: 3,
        materializedCodes: new Set(['123456', '123400'])
    }), '123400', 'el relleno solo se elige si el prefijo inmediato no está materializado');
    const competingParents = new Set(['123456', '1234', '123400']);
    assert.equal(Analyzer._evaluateBlockPrecomputed(
        '123456', '123400', competingParents, new Map([['123400', 2]])
    ).accepted, true, 'la alternativa de bloque del caso sintético tiene evidencia de hermanos');
    const resolved = Analyzer._resolveParentWithMethodFast(
        '123456', competingParents, null, null,
        { hasSeparator: false, levelLengths: [2, 4, 6], levelCount: 3 },
        new Map([['123456', '123400']]), new Map([['123400', 2]])
    );
    assert.equal(resolved.parent, '1234',
        'un padre de prefijo materializado debe prevalecer aunque exista una alternativa por bloques');

    const paddedOnly = new Set(['123456']);
    const noGhost = Analyzer._resolveParentWithMethodFast(
        '123456', paddedOnly, null, null,
        { hasSeparator: false, levelLengths: [2, 4, 6], levelCount: 3 },
        new Map([['123456', '123400']]), new Map([['123400', 2]])
    );
    assert.equal(noGhost.parent, null,
        'si no existe ni prefijo ni candidato rellenado, el importador no inventa un padre');

    const similarCodes = new Set(['123', '012']);
    const exactPrefix = Analyzer._resolveParentWithMethodFast(
        '123', similarCodes, null, null,
        { hasSeparator: false, levelLengths: [2, 3], levelCount: 2 }, new Map(), new Map()
    );
    assert.equal(exactPrefix.parent, null,
        'un código visualmente parecido no materializa el prefijo exacto requerido');

    const decimal = Analyzer._resolveParentWithMethodFast(
        '1.1.01', new Set(['1', '1.1', '1.1.01']), null, null,
        { hasSeparator: true, separator: '.', levelLengths: [1, 2, 5], levelCount: 3 }, new Map(), new Map()
    );
    assert.equal(decimal.parent, '1.1', 'la jerarquía decimal elige el segmento padre exacto materializado');

    const variableWidths = Analyzer._resolveParentWithMethodFast(
        '1101', new Set(['1', '11', '1101']), null, null,
        { hasSeparator: false, levelLengths: [1, 2, 4], levelCount: 3 }, new Map(), new Map()
    );
    assert.equal(variableWidths.parent, '11', 'los códigos 1→2→4 mantienen su padre materializado');

    const uniformWidths = Analyzer._resolveParentWithMethodFast(
        '123456', new Set(['12', '1234', '123456']), null, null,
        { hasSeparator: false, levelLengths: [2, 4, 6], levelCount: 3 }, new Map(), new Map()
    );
    assert.equal(uniformWidths.parent, '1234', 'regresión: anchos uniformes existentes mantienen padre; no se altera fixed-width');

    const fixedWidthCodes = ['100000', '110000', '110100', '110101', '200000', '210000', '210100'];
    const fixedWidthProfile = AccountPlanProfile.analyze(fixedWidthCodes.map(code => ({ code })));
    const fixedWidthContract = Analyzer.generateImportContract({
        fileName: 'synthetic-fixed-width.xlsx',
        sheetName: 'Plan',
        headers: ['CODIGO', 'NOMBRE'],
        rows: fixedWidthCodes.map(code => ({ CODIGO: code, NOMBRE: `Cuenta ${code}` })),
        codeColumn: 'CODIGO',
        nameColumn: 'NOMBRE'
    });
    assert.deepEqual(fixedWidthContract.hierarchy.levelLengths, [6]);
    assert.ok(fixedWidthContract.hierarchy.levelCount >= fixedWidthProfile.levelsCount,
        'regresión: levelCount conserva la señal lógica previa aunque levelLengths colapse; el arreglo completo queda separado');
}

// PDF APS complementa el corpus con jerarquia por puntos y numeracion variable.
{
    const { analysis } = await analyzePdf('PUCT/Plan_de_cuentas_APS_RA_0656_2024.pdf');
    assert.equal(analysis.regions.length, 1);
    const contract = analysis.regions[0];
    assert.equal(contract.nodes.length, 67);
    for (const code of ['1.1', '1.1.1', '1.1.1.01', '1.1.1.01.1']) {
        assert.ok(contract.nodes.some(node => node.normalizedCode === code), `no debe perder el codigo ${code}`);
    }
    assert.ok(contract.nodes.some(node => node.normalizedCode === '2.1.1.01.1.02'),
        'debe recuperar el codigo valido aunque el PDF tenga un guion decorativo antes del codigo');
}

// Evidencia espacial: un código punteado separado de su nombre es cuenta;
// un decimal que inicia prosa en una celda no lo es.
{
    const makeRow = (page, values) => ({
        cells: values.map((value, col) => ({
            rawValue: value.text,
            page,
            col,
            x: value.x,
            width: value.width
        }))
    });
    const rows = [
        makeRow(1, [{ text: 'Plan de cuentas', x: 70, width: 100 }]),
        makeRow(2, [
            { text: '1.', x: 80, width: 14 },
            { text: 'Introducción', x: 155, width: 80 }
        ])
    ];
    const accounts = [
        ['1.', 'ACTIVO'], ['1.1', 'ACTIVO CORRIENTE'], ['1.1.1', 'DISPONIBILIDADES'],
        ['1.1.1.01', 'Caja'], ['1.1.1.02', 'Bancos'], ['1.1.2', 'INVERSIONES'],
        ['1.1.2.01', 'Plazo fijo'], ['1.1.2.02', 'Otros'], ['1.2', 'ACTIVO NO CORRIENTE'],
        ['1.2.1', 'BIENES DE USO'], ['2', 'PASIVO'], ['2.1', 'PASIVO CORRIENTE'],
        ['2.1.1', 'OBLIGACIONES']
    ];
    for (const [code, name] of accounts) {
        rows.push(makeRow(2, [
            { text: code, x: 80, width: code.length * 7 },
            { text: name, x: 155, width: name.length * 6 }
        ]));
        if (code === '1.') {
            rows.push(makeRow(2, [
                { text: '1.', x: 80, width: 14 },
                { text: 'Introducción', x: 155, width: 80 }
            ]));
        }
    }
    rows.push(makeRow(2, [{ text: '1.5 millones de bolivianos', x: 80, width: 190 }]));
    rows.push(makeRow(4, [{ text: 'Descripción de las cuentas', x: 70, width: 170 }]));
    const document = {
        source: { format: 'pdf', fileName: 'synthetic.pdf', sheetNames: null },
        rows,
        extractionConfidence: 1,
        ocrUsed: false,
        warnings: null,
        stats: {}
    };
    const analysis = Analyzer.analyzeCanonicalDocument(document);
    assert.equal(analysis.regions.length, 1);
    assert.equal(analysis.regions[0].nodes.length, accounts.length);
    assert.ok(analysis.regions[0].nodes.some(node => node.normalizedCode === '1' && node.name === 'ACTIVO'));
    assert.equal(analysis.regions[0].nodes.some(node => /introducci[oó]n/i.test(node.name)), false);
    assert.equal(analysis.regions[0].nodes.some(node => node.normalizedCode === '1.5'), false);
}

// El XLSX oficial de TCE-PR prueba la extraccion fiel, no compatibilidad
// contable boliviana ni aprobacion automatica por el analizador.
{
    const bytes = Uint8Array.from(localFile('PUCT/PCASP_TCE_PR_2026_v1.0a.xlsx'));
    const document = await ExcelAdapter.extract(bytes.buffer);
    assert.equal(document.source.sheetNames[0], 'PCASP');
    assert.ok(document.source.sheetNames.includes('Contas Incluídas'));
    assert.ok(document.rows.length > 7000);
    const header = document.rows.find(row => row.cells.some(cell => cell.rawValue === 'CLASSE'));
    assert.ok(header, 'debe preservar los encabezados de la hoja principal');
    assert.ok(header.cells.some(cell => cell.rawValue === 'CONTA'));
    assert.ok(header.cells.some(cell => cell.rawValue === 'TÍTULO'));
}

// Falta de padre: revision pendiente que cierra el gate. El salto entre hijos
// con padre presente queda como WARNING informativo y no crea errores.
{
    const makeContract = codes => Analyzer.generateImportContract({
        fileName: 'sequence-gap.xlsx',
        sheetName: 'Plan',
        headers: ['CODIGO', 'NOMBRE'],
        rows: codes.map(code => ({ CODIGO: code, NOMBRE: `Cuenta ${code}` })),
        codeColumn: 'CODIGO',
        nameColumn: 'NOMBRE'
    });
    const gapContract = makeContract(['151', '151.01', '151.03']);
    const gap = gapContract.warnings.find(warning => warning.type === 'SEQUENCE_GAP');
    assert.equal(gap?.severity, 'WARNING');
    assert.equal(gap?.missingCount, 1);
    assert.equal(gapContract.errors.length, 0);

    const terminalCodeContract = makeContract(['151', '151.01', '151.03', '151.99']);
    const sequenceWarnings = terminalCodeContract.warnings.filter(warning => warning.type === 'SEQUENCE_GAP');
    assert.equal(sequenceWarnings.length, 1, 'ignora saltos amplios y cuentas terminales .99');
    assert.equal(terminalCodeContract.confidence.overall, 0.9, 'un aviso informativo no reduce la confianza');

    const missingParentContract = makeContract(['151.01', '151.03']);
    assert.ok(missingParentContract.nodes.every(node => node.parentInfo.requiresReview));
    const session = createImportSession({ regions: [missingParentContract] });
    const gate = canImportReport(session);
    assert.equal(gate.can, false, 'padres sin resolver deben impedir confirmar la importacion');
    assert.ok(gate.reasons.some(reason => reason.includes('REVIEW de nodo sin resolver')));
}

// Los problemas estructurales se diagnostican al importar, no en Estados Financieros.
{
    const financialStatements = fs.readFileSync(path.join(root, 'web-app/client/src/pages/FinancialStatements.jsx'), 'utf8');
    const importDiagnostic = fs.readFileSync(path.join(root, 'web-app/client/src/components/import/ImportDiagnosticStep.jsx'), 'utf8');
    assert.equal(financialStatements.includes('Revisión del reporte'), false);
    assert.equal(financialStatements.includes('reportMetadata?.warnings'), false);
    assert.ok(importDiagnostic.includes('u2-informational-warnings'));
    assert.ok(importDiagnostic.includes('u2-pdf-page-range'));
    assert.ok(importDiagnostic.includes('nodeReviewsUnresolved'));
}

{
    const dottedRoot = Analyzer.extractNarrativeAccounts(['1. ACTIVO']);
    assert.equal(dottedRoot.accounts[0]?.code, '1.');
    const contract = Analyzer.generateImportContract({
        fileName: 'terminal-dot.txt',
        sheetName: 'Plan',
        headers: ['CODIGO', 'NOMBRE'],
        rows: [{ CODIGO: '1.', NOMBRE: 'ACTIVO' }],
        codeColumn: 'CODIGO',
        nameColumn: 'NOMBRE'
    });
    assert.equal(contract.nodes[0]?.normalizedCode, '1');
}

console.log('PASS: PDF MEFP (379 cuentas), PDF APS (67), XLSX TCE-PR y gates de jerarquia/importacion.');
