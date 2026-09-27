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
const { canImportReport, createImportSession } = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);

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

    const decimalProse = Analyzer.extractNarrativeAccounts([
        { text: '1.5 millones de bolivianos', allowDelimitedCode: false },
        { text: '1.1 ACTIVO CORRIENTE', allowDelimitedCode: true }
    ]);
    assert.equal(decimalProse.accounts.some(account => account.code === '1.5'), false);
    assert.equal(decimalProse.accounts.some(account => account.code === '1.1'), true);
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
