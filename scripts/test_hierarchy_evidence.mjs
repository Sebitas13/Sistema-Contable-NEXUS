#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { UniversalPlanAnalyzer: Analyzer } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/UniversalPlanAnalyzer.js')).href);
const { ImportContractValidator } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/ImportContractValidator.js')).href);
const Session = await import(pathToFileURL(path.join(root, 'web-app/client/src/importSession/index.js')).href);
const { deriveCompanyStructure } = await import(pathToFileURL(path.join(root, 'web-app/client/src/components/import/companyStructure.js')).href);
const { CsvAdapter } = await import(pathToFileURL(path.join(root, 'web-app/client/src/utils/FormatAdapter.js')).href);

let checks = 0;
function check(label, assertion) {
    assert.ok(assertion, label);
    checks++;
    console.log(`PASS ${label}`);
}

function contract(headers, rows, options = {}) {
    return Analyzer.generateImportContract({
        fileName: 'hierarchy-evidence.csv',
        sheetName: 'Plan',
        headers,
        rows,
        codeColumn: 'CODIGO',
        nameColumn: 'NOMBRE',
        ...options
    });
}

const fixedRows = ['741258', '385091', '926437'].map(code => ({ CODIGO: code, NOMBRE: `Cuenta ${code}` }));
const unknownFixed = contract(['CODIGO', 'NOMBRE'], fixedRows, { parentColumn: null });
check('ancho físico único no se convierte en nivel lógico',
    unknownFixed.hierarchy.observedCodeLengths.join() === '6' &&
    unknownFixed.hierarchy.logicalLevelLengths.length === 0 &&
    unknownFixed.hierarchy.status === 'UNKNOWN' &&
    unknownFixed.nodes.every(node => node.level === null));
check('validator bloquea jerarquía fixed-width desconocida', !ImportContractValidator.validate(unknownFixed).valid);
check('companyStructure omite máscara derivada solo del ancho físico', deriveCompanyStructure(unknownFixed) === null);
check('profundidad explícita sin patrón de máscara no inventa longitud máxima',
    deriveCompanyStructure({ hierarchy: { status: 'EXPLICIT_PARENTS', observedCodeLengths: [3, 5], logicalLevelLengths: [], levelCount: 3 } }) === null);

const fixedWidthWithParents = contract(['CODIGO', 'NOMBRE'], [
    { CODIGO: '110000', NOMBRE: 'GRUPO' },
    { CODIGO: '111000', NOMBRE: 'SUBGRUPO' },
    { CODIGO: '112000', NOMBRE: 'SUBGRUPO 2' }
], { parentColumn: null });
let flatConfirmationRejected = false;
try {
    Session.confirmFlatHierarchy(Session.createImportSession({ regions: [fixedWidthWithParents] }));
} catch {
    flatConfirmationRejected = true;
}
check('no se ofrece confirmación plana si el analizador materializó padres',
    fixedWidthWithParents.hierarchy.status === 'UNKNOWN' &&
    fixedWidthWithParents.nodes.some(node => node.parent) &&
    fixedWidthWithParents.hierarchy.canConfirmFlat === false && flatConfirmationRejected);

let unknownSession = Session.createImportSession({ regions: [unknownFixed], now: () => 101 });
for (const warning of unknownFixed.warnings) {
    if (warning?.severity === 'REVIEW') {
        const index = unknownFixed.warnings.indexOf(warning);
        unknownSession = Session.resolveReview(unknownSession, `region_0:w${index}`);
    }
}
unknownFixed.nodes.forEach((node, index) => {
    if (node.requiresReview || node.parentInfo?.requiresReview) {
        unknownSession = Session.resolveReview(unknownSession, `region_0:${index}`);
    }
});
check('aceptar REVIEW genérico no permite importar sin estructura',
    !Session.canImport(unknownSession) && !Session.simulate(unknownSession).allowed);

let manuallyLeveledUnknown = Session.createImportSession({ regions: [unknownFixed], now: () => 101 });
unknownFixed.nodes.forEach((node, index) => {
    manuallyLeveledUnknown = Session.applyOverride(manuallyLeveledUnknown, `region_0:${index}`, 'level', 1);
    if (node.requiresReview || node.parentInfo?.requiresReview) {
        manuallyLeveledUnknown = Session.resolveReview(manuallyLeveledUnknown, `region_0:${index}`);
    }
    if (node.nature === 'INFERRED' || node.isPostable === 'UNKNOWN') {
        manuallyLeveledUnknown = Session.confirmNature(manuallyLeveledUnknown, `region_0:${index}`, node.type);
    }
});
const manuallyLeveledEffective = Session.effectiveContractOf(manuallyLeveledUnknown);
const manuallyLeveledValidation = ImportContractValidator.validate(manuallyLeveledEffective);
const manuallyLeveledSimulation = Session.simulate(manuallyLeveledUnknown);
check('UNKNOWN sigue bloqueado tras asignar niveles manuales y resolver revisiones genéricas',
    manuallyLeveledEffective.hierarchy.status === 'UNKNOWN' &&
    manuallyLeveledEffective.nodes.every(node => Number.isInteger(node.level)) &&
    manuallyLeveledValidation.errors.some(error => error.includes('Jerarquía lógica desconocida')) &&
    !Session.canImport(manuallyLeveledUnknown) && !manuallyLeveledSimulation.allowed &&
    manuallyLeveledSimulation.payload === null);

unknownSession = Session.confirmFlatHierarchy(unknownSession);
const flatEffective = Session.effectiveContractOf(unknownSession);
const flatStructure = deriveCompanyStructure(flatEffective);
check('confirmación plana explícita crea niveles 1 y padres nulos',
    flatEffective.hierarchy.status === 'FLAT_CONFIRMED' &&
    flatEffective.nodes.every(node => node.level === 1 && node.parent === null && node.parentInfo.method === 'USER_CONFIRMED_FLAT'));
check('confirmación plana resuelve revisión jerárquica pero conserva la de normalización',
    flatEffective.nodes.every(node => !Session.nodeNeedsReview(node, { flatConfirmed: true })) &&
    Session.nodeNeedsReview({
        requiresReview: true,
        normalizationRequiresReview: true,
        parentInfo: { requiresReview: true }
    }, { flatConfirmed: true }));
check('plan plano confirmado permite payload y registra la decisión',
    Session.simulate(unknownSession).allowed && unknownSession.hierarchyConfirmations[0].decision === 'FLAT_ALL_LEVEL_1');
check('máscara de ancho fijo solo se deriva tras confirmar el plan plano',
    flatStructure?.code_mask === '######' && JSON.parse(flatStructure.plan_structure).levelsCount === 1);
const normalizedUnknown = contract(['CODIGO', 'NOMBRE'], [
    { CODIGO: ' 741258', NOMBRE: 'Cuenta normalizada' },
    { CODIGO: '385091', NOMBRE: 'Cuenta B' },
    { CODIGO: '926437', NOMBRE: 'Cuenta C' }
], { parentColumn: null });
let normalizedFlatSession = Session.createImportSession({ regions: [normalizedUnknown], now: () => 102 });
normalizedFlatSession = Session.confirmFlatHierarchy(normalizedFlatSession);
const normalizedFlatReport = Session.canImportReport(normalizedFlatSession);
check('gate y UI mantienen accionable la revisión de normalización tras confirmar plan plano',
    normalizedUnknown.nodes[0].normalizationRequiresReview &&
    Session.nodeNeedsReview(normalizedUnknown.nodes[0], { flatConfirmed: true }) &&
    normalizedFlatReport.reasons.some(reason => reason.includes('REVIEW de nodo sin resolver')) &&
    !Session.simulate(normalizedFlatSession).allowed);

const levelRows = [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', NIVEL: '1' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', NIVEL: '2' },
    { CODIGO: '110100', NOMBRE: 'CAJA', NIVEL: '3' }
];
const explicitLevels = contract(['CODIGO', 'NOMBRE', 'NIVEL'], levelRows);
check('NIVEL de fuente llega al contrato sin cambiarse',
    explicitLevels.columnMapping.levelColumn === 'NIVEL' &&
    explicitLevels.nodes.map(node => node.sourceLevel).join() === '1,2,3' &&
    explicitLevels.nodes.map(node => node.level).join() === '1,2,3');
const canonicalCsv = await CsvAdapter.extract([
    'CODIGO,NOMBRE,NIVEL',
    '100000,ACTIVO,1',
    '110000,DISPONIBLE,2',
    '110100,CAJA,3'
].join('\n'));
const canonicalContract = Analyzer.analyzeCanonicalDocument(canonicalCsv).regions[0];
check('CSV canónico mapea NIVEL y preserva filas source→contract',
    canonicalContract.columnMapping.levelColumn === 'NIVEL' &&
    canonicalContract.nodes.map(node => `${node.sourceLevel}:${node.level}`).join('|') === '1:1|2:2|3:3');
check('nivel explícito reconstruye solo el padre anterior del nivel inmediato',
    explicitLevels.nodes.map(node => node.parent ?? '').join() === ',100000,110000' &&
    explicitLevels.nodes[1].parentInfo.method === 'SOURCE_LEVEL_ORDER' &&
    explicitLevels.nodes.every(node => node.hierarchyEvidence.source.row !== undefined));
const breadthFirstLevels = contract(['CODIGO', 'NOMBRE', 'NIVEL'], [
    { CODIGO: '1', NOMBRE: 'ACTIVO', NIVEL: '1' },
    { CODIGO: '11', NOMBRE: 'DISPONIBLE', NIVEL: '2' },
    { CODIGO: '12', NOMBRE: 'EXIGIBLE', NIVEL: '2' },
    { CODIGO: '111', NOMBRE: 'CAJA', NIVEL: '3' }
]);
check('orden por niveles prefiere el padre estructural coincidente al último hermano',
    breadthFirstLevels.nodes[3].parent === '11' &&
    breadthFirstLevels.nodes[3].parentInfo.method === 'PREFIX' &&
    !breadthFirstLevels.nodes[3].requiresReview &&
    !breadthFirstLevels.errors.some(error => error.type === 'levelParentConflict'));
const ambiguousFixedLevels = contract(['CODIGO', 'NOMBRE', 'NIVEL'], [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', NIVEL: '1' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', NIVEL: '2' },
    { CODIGO: '120000', NOMBRE: 'EXIGIBLE', NIVEL: '2' },
    { CODIGO: '111000', NOMBRE: 'CAJA', NIVEL: '3' }
]);
const ambiguousFixedSession = Session.createImportSession({ regions: [ambiguousFixedLevels], now: () => 102 });
check('padre ambiguo fixed-width queda sin arista y exige revisión, no se asigna al último hermano',
    ambiguousFixedLevels.nodes[3].parent === null &&
    ambiguousFixedLevels.nodes[3].parentInfo.method === 'SOURCE_LEVEL_PARENT_AMBIGUOUS' &&
    ambiguousFixedLevels.nodes[3].requiresReview &&
    !Session.canImport(ambiguousFixedSession) && !Session.simulate(ambiguousFixedSession).allowed);
check('ancho fijo con niveles explícitos conserva profundidad, no una máscara multinivel falsa',
    explicitLevels.hierarchy.status === 'EXPLICIT_LEVELS' &&
    explicitLevels.hierarchy.observedCodeLengths.join() === '6' &&
    explicitLevels.hierarchy.logicalLevelLengths.length === 0 &&
    deriveCompanyStructure(explicitLevels) === null);
const sparseExplicitLevels = contract(['CODIGO', 'NOMBRE', 'NIVEL'], [
    { CODIGO: '110', NOMBRE: 'GRUPO', NIVEL: '2' },
    { CODIGO: '11011', NOMBRE: 'DETALLE', NIVEL: '3' }
], { levelColumn: 'NIVEL' });
check('niveles fuente incompletos no se renombran como longitudes lógicas desde nivel 1',
    sparseExplicitLevels.hierarchy.levelCount === 3 &&
    sparseExplicitLevels.hierarchy.logicalLevelLengths.length === 0 &&
    deriveCompanyStructure(sparseExplicitLevels) === null);
const sparseSession = Session.createImportSession({ regions: [sparseExplicitLevels], now: () => 102 });
check('nivel >1 sin raíz ni padre materializado requiere revisión antes de importar',
    sparseExplicitLevels.rootNodes.length === 0 &&
    sparseExplicitLevels.nodes[0].level === 2 && sparseExplicitLevels.nodes[0].parent === null &&
    sparseExplicitLevels.nodes[0].requiresReview && !Session.canImport(sparseSession) &&
    !Session.simulate(sparseSession).allowed);

let explicitSession = Session.createImportSession({ regions: [explicitLevels], now: () => 102 });
const beforeNatureConfirmation = Session.effectiveContractOf(explicitSession).nodes.map(node => `${node.level}:${node.parent}`).join('|');
explicitLevels.nodes.forEach((node, index) => {
    if (node.isPostable === 'UNKNOWN') explicitSession = Session.confirmNature(explicitSession, `region_0:${index}`, node.type);
});
const explicitSimulation = Session.simulate(explicitSession);
check('payload fixed-width NIVEL coincide exactamente con la evidencia',
    explicitSimulation.allowed && explicitSimulation.payload.accounts.map(node => `${node.level}:${node.parent_code || ''}`).join('|') ===
        '1:|2:100000|3:110000');

const parentRows = [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', 'Cuenta Padre': '' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', 'Cuenta Padre': '100000' },
    { CODIGO: '110100', NOMBRE: 'CAJA', 'Cuenta Padre': '110000' }
];
const explicitParents = contract(['CODIGO', 'NOMBRE', 'Cuenta Padre'], parentRows);
check('Cuenta Padre se detecta y sobrevive a la normalización',
    explicitParents.columnMapping.parentColumn === 'Cuenta Padre' &&
    explicitParents.nodes.map(node => node.parent ?? '').join() === ',100000,110000' &&
    explicitParents.nodes[2].sourceParent === '110000' &&
    explicitParents.nodes[2].parentInfo.method === 'EXPLICIT_PARENT');
const explicitParentSession = Session.createImportSession({ regions: [explicitParents], now: () => 104 });
check('sourceParent tampoco se pierde al derivar ImportSession',
    Session.effectiveContractOf(explicitParentSession).nodes[2].sourceParent === '110000');

const concatenatedParentContract = contract(['CODIGO', 'NOMBRE', 'CuentaPadre'], [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', CuentaPadre: '' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', CuentaPadre: '100000' }
]);
check('encabezado concatenado CuentaPadre conserva sourceParent',
    concatenatedParentContract.columnMapping.parentColumn === 'CuentaPadre' &&
    concatenatedParentContract.nodes[1].sourceParent === '100000' &&
    concatenatedParentContract.nodes[1].parentInfo.method === 'EXPLICIT_PARENT');
check('encabezados concatenados ParentCode y CtaPadre se detectan',
    ['ParentCode', 'CtaPadre'].every(header => Analyzer.findEvidenceColumn([header], 'parent') === header));
check('artículos intermedios no hacen perder la evidencia de padre',
    Analyzer.findEvidenceColumn(['Código de la Cuenta Padre'], 'parent') === 'Código de la Cuenta Padre' &&
    Analyzer.findEvidenceColumn(['Cuenta de la Madre'], 'parent') === 'Cuenta de la Madre' &&
    Analyzer.findEvidenceColumn(['Nivel de la Cuenta Padre'], 'parent') === null);
check('etiquetas que solo contienen parent como subcadena no son padres',
    ['Parentesco', 'Aparente', 'Transparente', 'Transparent', 'Apparent', 'Compadre']
        .every(header => Analyzer.findEvidenceColumn([header], 'parent') === null) &&
    Analyzer.findEvidenceColumn(['Parentesco', 'Cuenta Padre'], 'parent') === 'Cuenta Padre');
check('encabezados de nivel CamelCase, numéricos e ingleses se reconocen sin aceptar niveles superiores',
    ['NivelJerarquico', 'LevelCode', 'NIVEL2', 'Hierarchy', 'Jerarquico', 'Jerarquica', 'subnivel', 'sublevel']
        .every(header => Analyzer.findEvidenceColumn([header], 'level') === header) &&
    ['NivelSuperior', 'NivelAnterior'].every(header => Analyzer.findEvidenceColumn([header], 'level') === null));
check('un encabezado mixto nivel/padre no se asigna a ninguna evidencia',
    ['NivelPadre', 'NIVEL_PADRE', 'ParentLevel', 'Nivel del Padre']
        .every(header => Analyzer.findEvidenceColumn([header], 'level') === null &&
            Analyzer.findEvidenceColumn([header], 'parent') === null));
check('se conserva el encabezado histórico Cuenta Padre 6N',
    Analyzer.findEvidenceColumn(['Cuenta Padre 6N'], 'parent') === 'Cuenta Padre 6N');
check('se reconocen equivalentes de cuenta madre sin colisionar con nivel',
    ['Cuenta Madre', 'CuentaMadre', 'Codigo Padre/Madre'].every(header =>
        Analyzer.findEvidenceColumn([header], 'parent') === header &&
        Analyzer.findEvidenceColumn([header], 'level') === null));

const bothEvidence = contract(['CODIGO', 'NOMBRE', 'NIVEL', 'parent_code'], [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', NIVEL: '1', parent_code: '' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', NIVEL: '2', parent_code: '100000' },
    { CODIGO: '110100', NOMBRE: 'CAJA', NIVEL: '3', parent_code: '110000' }
]);
check('level y parent explícitos coherentes quedan preservados',
    bothEvidence.nodes.map(node => `${node.sourceLevel}:${node.parent ?? ''}`).join('|') ===
        '1:|2:100000|3:110000' && ImportContractValidator.validate(bothEvidence).valid);

const contradictory = contract(['CODIGO', 'NOMBRE', 'NIVEL', 'parent_code'], [
    { CODIGO: '100000', NOMBRE: 'ACTIVO', NIVEL: '1', parent_code: '' },
    { CODIGO: '110000', NOMBRE: 'DISPONIBLE', NIVEL: '1', parent_code: '100000' }
]);
check('level y parent explícitos contradictorios producen BLOCK',
    contradictory.errors.some(error => error.type === 'levelParentConflict' && error.severity === 'BLOCK') &&
    !ImportContractValidator.validate(contradictory).valid);

const missingOrderedParent = contract(['CODIGO', 'NOMBRE', 'NIVEL'], [
    { CODIGO: '110100', NOMBRE: 'CAJA', NIVEL: '3' }
]);
check('level explícito sin candidato anterior no inventa parent',
    missingOrderedParent.nodes[0].level === 3 && missingOrderedParent.nodes[0].parent === null &&
    missingOrderedParent.nodes[0].parentInfo.method === 'SOURCE_LEVEL_PARENT_UNKNOWN' &&
    missingOrderedParent.nodes[0].requiresReview);

const variableLength = contract(['CODIGO', 'NOMBRE'], [
    { CODIGO: '1', NOMBRE: 'ACTIVO' },
    { CODIGO: '11', NOMBRE: 'DISPONIBLE' },
    { CODIGO: '1101', NOMBRE: 'CAJA' }
], { parentColumn: null });
check('regresión variable 1→2→4 conserva nivel y árbol',
    variableLength.nodes.map(node => node.level).join() === '1,2,3' &&
    variableLength.nodes.map(node => node.parent ?? '').join() === ',1,11');

const wideRows = levelRows.map(row => ({ ...row }));
const widthRows = [
    { CODIGO: '1', NOMBRE: 'ACTIVO', NIVEL: '1' },
    { CODIGO: '11', NOMBRE: 'DISPONIBLE', NIVEL: '2' },
    { CODIGO: '1101', NOMBRE: 'CAJA', NIVEL: '3' }
];
const wideExplicit = contract(['CODIGO', 'NOMBRE', 'NIVEL'], wideRows);
const narrowExplicit = contract(['CODIGO', 'NOMBRE', 'NIVEL'], widthRows);
check('cambiar ancho físico no altera niveles lógicos explícitos',
    wideExplicit.nodes.map(node => node.level).join() === narrowExplicit.nodes.map(node => node.level).join() &&
    narrowExplicit.nodes.map(node => node.sourceLevel).join() === '1,2,3');
check('confirmar naturaleza no cambia niveles ni padres',
    beforeNatureConfirmation === Session.effectiveContractOf(explicitSession).nodes.map(node => `${node.level}:${node.parent}`).join('|'));

const pdfRows = [
    ['CODIGO', 'NOMBRE', 'NIVEL'],
    ['100000', 'ACTIVO', '1'],
    ['110000', 'DISPONIBLE', '2'],
    ['110100', 'CAJA', '3']
].map((values, rowIndex) => ({
    rowIndex,
    cells: values.map((rawValue, col) => ({
        rawValue, displayValue: rawValue, coordinate: `page1:x${20 + col * 100},y${500 - rowIndex * 20}`,
        row: rowIndex, col, page: 1, x: 20 + col * 100, y: 500 - rowIndex * 20,
        width: 60, height: 10
    }))
}));
const spatialPdfContract = Analyzer.analyzeCanonicalDocument({
    source: { format: 'pdf', fileName: 'spatial.pdf', sheetNames: null },
    rows: pdfRows, extractionConfidence: 0.9, ocrUsed: false,
    stats: { formulas: 0, mergedCells: 0, hiddenColumns: 0, stubCells: 0, numericCells: 0 }, warnings: null
}).regions[0];
check('coordenadas PDF se conservan, pero no deciden la profundidad',
    spatialPdfContract.nodes[0].hierarchyEvidence.source.code.x === 20 &&
    spatialPdfContract.nodes[0].hierarchyEvidence.source.format === 'pdf' &&
    spatialPdfContract.nodes.map(node => node.level).join() === '1,2,3');

const rows313 = [];
const lastAtLevel = new Map();
for (let index = 0; index < 313; index++) {
    const level = index === 0 ? 1 : 2 + ((index - 1) % 4);
    const code = String(100000 + index);
    const parent = level === 1 ? '' : lastAtLevel.get(level - 1);
    rows313.push({ CODIGO: code, NOMBRE: `Cuenta ${index + 1}`, NIVEL: String(level), parent_code: parent || '' });
    lastAtLevel.set(level, code);
}
const corpus313 = contract(['CODIGO', 'NOMBRE', 'NIVEL', 'parent_code'], rows313);
check('corpus 313 preserva los 313 niveles y 312 padres explícitos',
    corpus313.nodes.length === 313 && corpus313.nodes.every(node => node.level === node.sourceLevel) &&
    corpus313.nodes.filter(node => node.parent).length === 312 &&
    !corpus313.errors.some(error => error.type === 'levelParentConflict') && ImportContractValidator.validate(corpus313).valid);
let corpus313Session = Session.createImportSession({ regions: [corpus313], now: () => 103 });
corpus313.nodes.forEach((node, index) => {
    if (node.isPostable === 'UNKNOWN') {
        corpus313Session = Session.confirmNature(corpus313Session, `region_0:${index}`, node.type);
    }
});
const corpus313Simulation = Session.simulate(corpus313Session);
check('payload de 313 coincide con cada level y parent fuente',
    corpus313Simulation.allowed && corpus313Simulation.payload.accounts.every((account, index) =>
        account.level === Number(rows313[index].NIVEL) && account.parent_code === (rows313[index].parent_code || null)));

console.log(`\nHierarchy evidence: ${checks} PASS`);
