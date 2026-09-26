const assert = require('assert');
const { buildFinancialReports, closingProposal } = require('./utils/financialReportsCore');

const accounts = [
    { id: 1, code: '1', name: 'Activo', type: 'Activo', total_debit: 0, total_credit: 0, period_debit: 0, period_credit: 0 },
    { id: 2, code: '121.02', name: 'Caja', type: 'Activo', parent_code: '121', total_debit: 1000, total_credit: 0, period_debit: 0, period_credit: 0 },
    { id: 3, code: '2', name: 'Pasivo', type: 'Pasivo', total_debit: 0, total_credit: 400, period_debit: 0, period_credit: 0 },
    { id: 4, code: '3', name: 'Patrimonio', type: 'Patrimonio', total_debit: 0, total_credit: 500, period_debit: 0, period_credit: 0 },
    { id: 5, code: '4.01', name: 'Ventas', type: 'Ingreso', total_debit: 0, total_credit: 150.5, period_debit: 0, period_credit: 150.5 },
    { id: 6, code: '5.01', name: 'Gastos', type: 'Gasto', total_debit: 50.5, total_credit: 0, period_debit: 50.5, period_credit: 0 }
];

const report = buildFinancialReports(accounts, {
    startDate: '2026-01-01',
    endDate: '2026-12-31'
});
assert.strictEqual(report.estadoResultados.totales.utilidadNeta, 100);
assert.strictEqual(report.balanceGeneral.totales.activo, 1000);
assert.strictEqual(report.balanceGeneral.totales.pasivo, 400);
assert.strictEqual(report.balanceGeneral.totales.patrimonio, 600);
assert.strictEqual(report.balanceGeneral.ecuacionCuadra, true);
assert.strictEqual(report.balanceGeneral.patrimonio[0].hijos.some(node => node.esSintetico), true,
    'El resultado no cerrado se presenta en patrimonio sin crear una cuenta.');
const closedBalance = buildFinancialReports([
    { id: 31, code: '1.01', name: 'Caja', type: 'Activo', total_debit: 1000, total_credit: 0 },
    { id: 32, code: '2.01', name: 'Pasivo', type: 'Pasivo', total_debit: 0, total_credit: 400 },
    { id: 33, code: '3.01', name: 'Patrimonio', type: 'Patrimonio', total_debit: 0, total_credit: 600 },
    { id: 34, code: '4.01', name: 'Ventas', type: 'Ingreso', period_debit: 0, period_credit: 100 }
], { hasResultClosing: true });
assert.strictEqual(closedBalance.balanceGeneral.ecuacionCuadra, true);
assert.strictEqual(closedBalance.balanceGeneral.patrimonio[0].hijos.some(node => node.esSintetico), false,
    'El resultado ya traspasado a acumulados no se duplica.');
const dividendsReport = buildFinancialReports([
    { id: 30, code: '4.02', name: 'Dividendos percibidos', type: 'Ingreso', period_credit: 5.25 }
]);
assert.strictEqual(dividendsReport.estadoResultados.totales.ventasNetas, 5.25,
    'La clasificación tributaria no excluye ingresos del resultado contable.');
const hasVirtualNode = (nodes) => nodes.some(node =>
    node.esVirtual || String(node.id).startsWith('virtual-') || hasVirtualNode(node.hijos || [])
);
const hasGeneratedGroupName = (nodes) => nodes.some(node =>
    /^Grupo\s/.test(node.name) || hasGeneratedGroupName(node.hijos || [])
);
assert.strictEqual(hasVirtualNode(report.balanceGeneral.activos), false,
    'Los nodos inferidos nunca se exponen en el reporte visible.');
assert.strictEqual(hasGeneratedGroupName(report.balanceGeneral.activos), false,
    'El reporte visible solo presenta nombres reales y conceptos contables explicitos.');

const findNode = (nodes, code) => {
    for (const node of nodes) {
        if (node.code === code) return node;
        const nested = findNode(node.hijos || [], code);
        if (nested) return nested;
    }
    return null;
};
const sparseNumericPlan = buildFinancialReports([
    { id: 20, code: '11', name: 'Activo corriente', type: 'Activo', level: 1, total_debit: 0, total_credit: 0 },
    { id: 21, code: '110101', name: 'Caja', type: 'Numérico', level: 3, total_debit: 125, total_credit: 0 },
    { id: 25, code: '110102', name: 'Cuenta sin uso', type: 'Numérico', level: 3, total_debit: 0, total_credit: 0 },
    { id: 26, code: '12', name: 'Activo disponible', type: 'Activo', level: 2, total_debit: 0, total_credit: 0 },
    { id: 22, code: '31', name: 'Patrimonio', type: 'Patrimonio', level: 1, total_debit: 0, total_credit: 100 },
    { id: 23, code: '4.01', name: 'Ingresos', type: 'Numérico', total_credit: 40, period_credit: 40 },
    { id: 24, code: '6.01', name: 'Gastos', type: 'Numérico', total_debit: 15, period_debit: 15 }
]);
assert.strictEqual(findNode(sparseNumericPlan.balanceGeneral.activos, '1101'), null,
    'Los niveles PUCT no declarados no se presentan como grupos ficticios.');
assert.strictEqual(findNode(sparseNumericPlan.balanceGeneral.activos, '110102'), null,
    'Las cuentas sin saldo quedan fuera del Balance General.');
assert.strictEqual(findNode(sparseNumericPlan.balanceGeneral.activos, '12'), null,
    'Las ramas completas sin saldo quedan fuera del Balance General.');
assert.strictEqual(hasGeneratedGroupName(sparseNumericPlan.balanceGeneral.activos), false);
assert.strictEqual(sparseNumericPlan.balanceGeneral.activos[0].name, 'Activo corriente');
assert.strictEqual(findNode(sparseNumericPlan.balanceGeneral.activos, '110101')?.name, 'Caja',
    'La cuenta activa conserva su jerarquia con la cuenta madre real y sin el nivel ausente.');
assert.strictEqual(sparseNumericPlan.balanceGeneral.activos[0].total, 125);
assert.strictEqual(sparseNumericPlan.balanceGeneral.totales.activo, 125,
    'El subtotal de la cuenta madre no se vuelve a sumar como una cuenta adicional.');
assert.strictEqual(sparseNumericPlan.estadoResultados.totales.utilidadNeta, 25, 'Los tipos genéricos conservan clasificación por clase de código.');
assert.strictEqual(sparseNumericPlan.balanceGeneral.totales.patrimonio, 125);
assert.strictEqual(sparseNumericPlan.balanceGeneral.ecuacionCuadra, true);
const exactEquitySubtotal = buildFinancialReports([
    { id: 48, code: 'EQUITY', name: 'Patrimonio', type: 'Patrimonio', level: 1, total_credit: 0.3 },
    { id: 49, code: 'REVENUE', name: 'Ingreso', type: 'Ingreso', level: 1, period_credit: 0.1 },
    { id: 50, code: 'EXPENSE', name: 'Gasto', type: 'Gasto', level: 1, period_debit: 0.2 }
]);
assert.strictEqual(exactEquitySubtotal.balanceGeneral.patrimonio[0].total, 0.2,
    'Los subtotales de patrimonio se recalculan al centavo después de inyectar el resultado.');

const hierarchySubtotalReport = buildFinancialReports([
    { id: 40, code: 'ACT', name: 'Activo', type: 'Activo', level: 1 },
    { id: 41, code: 'COR', name: 'Activo corriente', type: 'Activo', level: 2, parent_code: 'ACT' },
    { id: 42, code: 'DISP', name: 'Disponibilidades', type: 'Activo', level: 3, parent_code: 'COR' },
    { id: 43, code: 'CAJA-001', name: 'Caja', type: 'Activo', level: 4, parent_code: 'DISP-IMPLICITO', total_debit: 125 },
    { id: 44, code: 'CAJA-002', name: 'Banco sin saldo', type: 'Activo', level: 4, parent_code: 'DISP' }
]);
const hierarchySubtotal = hierarchySubtotalReport.balanceGeneral.activos[0];
assert.deepStrictEqual(
    [hierarchySubtotal.code, hierarchySubtotal.hijos[0].code, hierarchySubtotal.hijos[0].hijos[0].code,
        hierarchySubtotal.hijos[0].hijos[0].hijos[0].code],
    ['ACT', 'COR', 'DISP', 'CAJA-001'],
    'Se consume la jerarquía importada por parent_code/nivel sin inferirla desde los códigos.'
);
assert.deepStrictEqual(
    [hierarchySubtotal.total, hierarchySubtotal.hijos[0].total, hierarchySubtotal.hijos[0].hijos[0].total],
    [125, 125, 125],
    'Cada cuenta superior presenta el subtotal de sus cuentas inferiores.'
);
assert.strictEqual(findNode(hierarchySubtotalReport.balanceGeneral.activos, 'CAJA-002'), null,
    'Reconstruir la jerarquía no vuelve a mostrar cuentas sin saldo.');

const zeroSubtotalReport = buildFinancialReports([
    { id: 45, code: 'ACT', name: 'Activo', type: 'Activo', level: 1 },
    { id: 46, code: 'DEBITO', name: 'Saldo deudor', type: 'Activo', level: 2, parent_code: 'ACT', total_debit: 25 },
    { id: 47, code: 'CREDITO', name: 'Saldo acreedor', type: 'Activo', level: 2, parent_code: 'ACT', total_credit: 25 }
]);
assert.deepStrictEqual(zeroSubtotalReport.balanceGeneral.activos.map(node => node.code), ['CREDITO', 'DEBITO'],
    'Un nivel cuyo subtotal neto es cero se omite, pero conserva visibles sus cuentas con saldo.');
assert.strictEqual(zeroSubtotalReport.balanceGeneral.activos.some(node => node.total === 0), false);
assert.strictEqual(zeroSubtotalReport.balanceGeneral.totales.activo, 0);

const interleavedHierarchyReport = buildFinancialReports([
    { id: 60, code: 'ROOT-A', name: 'Activo A', type: 'Activo', level: 1 },
    { id: 61, code: 'ROOT-B', name: 'Activo B', type: 'Activo', level: 1 },
    { id: 62, code: 'GROUP-A', name: 'Grupo A', type: 'Activo', level: 2, parent_code: 'ROOT-A' },
    { id: 63, code: 'LEAF-B', name: 'Cuenta B', type: 'Activo', level: 3, parent_code: 'MISSING-B', total_debit: 20 },
    { id: 64, code: 'GROUP-B', name: 'Grupo B', type: 'Activo', level: 2, parent_code: 'ROOT-B' }
]);
assert.deepStrictEqual(interleavedHierarchyReport.balanceGeneral.activos.map(node => [node.code, node.total]), [
    ['ROOT-B', 20]
], 'Un padre implícito no hereda la rama de otro nivel explícito.');
assert.strictEqual(interleavedHierarchyReport.metadata.warnings.some(warning =>
    warning.type === 'parentNotResolved' && warning.code === 'LEAF-B' && warning.resolvedParent === 'ROOT-B'), true,
'El reporte deja visible cuándo debió resolver el padre ausente a partir del nivel importado.');

const contraAccountReport = buildFinancialReports([
    { id: 65, code: 'ACT', name: 'Activo', type: 'Activo', level: 1 },
    { id: 66, code: 'FIXED', name: 'Activo fijo', type: 'Activo', level: 2, parent_code: 'ACT', total_debit: 100 },
    { id: 67, code: 'DEP-ACC', name: 'Depreciación acumulada', type: 'Reguladora', level: 3, parent_code: 'FIXED', total_credit: 40 }
]);
assert.strictEqual(findNode(contraAccountReport.balanceGeneral.activos, 'DEP-ACC')?.esReguladora, true,
    'Las cuentas reguladoras se presentan dentro del rubro de su cuenta madre.');
assert.strictEqual(contraAccountReport.balanceGeneral.totales.activo, 60);

const separateHierarchyReport = buildFinancialReports([
    { id: 55, code: 'ROOT-B', name: 'Activo B', type: 'Activo', level: 1 },
    { id: 50, code: 'ROOT-A', name: 'Activo A', type: 'Activo', level: 1 },
    { id: 56, code: 'GROUP-B', name: 'Grupo B', type: 'Activo', level: 2, parent_code: 'ROOT-B' },
    { id: 51, code: 'GROUP-A', name: 'Grupo A', type: 'Activo', level: 2, parent_code: 'ROOT-A' },
    { id: 57, code: 'LEAF-B', name: 'Cuenta B', type: 'Activo', level: 3, parent_code: 'MISSING-B', total_debit: 20 },
    { id: 52, code: 'LEAF-A', name: 'Cuenta A', type: 'Activo', level: 3, parent_code: 'MISSING-A', total_debit: 10 }
]);
assert.deepStrictEqual(separateHierarchyReport.balanceGeneral.activos.map(node => [node.code, node.total]), [
    ['ROOT-A', 10],
    ['ROOT-B', 20]
], 'Las ramas independientes conservan sus propios subtotales por el orden/nivel importado.');

const parentOwnBalanceReport = buildFinancialReports([
    { id: 26, code: '1', name: 'Activo corriente', type: 'Activo', total_debit: 10, total_credit: 0 },
    { id: 27, code: '1.01', name: 'Caja', type: 'Activo', parent_code: '1', total_debit: 25, total_credit: 0 }
]);
assert.strictEqual(parentOwnBalanceReport.balanceGeneral.activos[0].ownBalance, 10);
assert.strictEqual(parentOwnBalanceReport.balanceGeneral.activos[0].hijos[0].total, 25);
assert.strictEqual(parentOwnBalanceReport.balanceGeneral.activos[0].total, 35);
assert.strictEqual(parentOwnBalanceReport.balanceGeneral.totales.activo, 35,
    'El saldo propio de una cuenta madre y los saldos de sus hijas se suman una sola vez.');
const zeroTotalWithOwnMovement = buildFinancialReports([
    { id: 28, code: 'ACT', name: 'Activo', type: 'Activo', level: 1, total_debit: 100 },
    { id: 29, code: 'CHILD', name: 'Cuenta acreedora', type: 'Activo', level: 2, parent_code: 'ACT', total_credit: 100 }
]);
assert.strictEqual(zeroTotalWithOwnMovement.balanceGeneral.activos[0].code, 'ACT');
assert.strictEqual(zeroTotalWithOwnMovement.balanceGeneral.activos[0].total, 0,
    'Un padre con movimiento propio se conserva para que ocultar su subtotal neto no pierda saldo.');
assert.strictEqual(zeroTotalWithOwnMovement.balanceGeneral.totales.activo, 0);

const closeAccounts = [
    { id: 10, code: '4.01', name: 'Ventas', type: 'Numérico', period_debit: 0, period_credit: 100.01 },
    { id: 11, code: '6.01', name: 'Gastos', type: 'Numérico', period_debit: 60, period_credit: 0 },
    { id: 12, code: '3.09', name: 'Pérdidas y Ganancias', type: 'Resultado', period_debit: 0, period_credit: 0 },
    { id: 13, code: '3.08', name: 'Resultados Acumulados', type: 'Patrimonio', period_debit: 0, period_credit: 0 },
    { id: 14, code: 'O.01', name: 'Orden deudora', type: 'Orden', period_debit: 90, period_credit: 0 },
    { id: 15, code: 'O.02', name: 'Orden acreedora', type: 'Orden', period_debit: 0, period_credit: 90 },
    { id: 16, code: '1.01', name: 'Caja', type: 'Activo', period_debit: 500, period_credit: 0 },
    { id: 17, code: 'R', name: 'Ingresos', type: 'Ingreso', period_debit: 0, period_credit: 0 },
    { id: 18, code: 'R.01', name: 'Ingreso sin tipo', type: '', parent_code: 'R', period_debit: 0, period_credit: 0.01 },
    { id: 19, code: '3.09.01', name: 'Pérdidas y Ganancias del ejercicio', type: 'Resultado', parent_code: '3.09', period_debit: 0, period_credit: 0 }
];

const proposal = closingProposal(closeAccounts, { closingDate: '2026-12-31' });
assert.strictEqual(proposal.proposedTransactions.length, 3);
const paddedCodeProposal = closingProposal(closeAccounts.map(account => ({
    ...account,
    code: ` ${account.code} `,
    parent_code: account.parent_code ? ` ${account.parent_code} ` : null
})), { closingDate: '2026-12-31' });
assert.strictEqual(paddedCodeProposal.proposedTransactions.length, 3,
    'Las búsquedas del grafo normalizan espacios igual que la clave de cuenta.');
for (const transaction of proposal.proposedTransactions) {
    const debit = transaction.entries.reduce((sum, entry) => sum + Math.round((entry.debit || 0) * 100), 0);
    const credit = transaction.entries.reduce((sum, entry) => sum + Math.round((entry.credit || 0) * 100), 0);
    assert.strictEqual(debit, credit, transaction.gloss);
}
const postedIds = proposal.proposedTransactions.flatMap(transaction => transaction.entries.map(entry => entry.accountId));
assert.strictEqual(postedIds.includes(16), false, 'Las cuentas permanentes no se cierran a cero.');
assert.strictEqual(postedIds.includes(18), true, 'La cuenta de resultado hereda el tipo declarado por su padre.');
assert.strictEqual(postedIds.includes(19), true, 'El cierre selecciona como destino la cuenta hoja bajo un padre declarado.');
assert.strictEqual(postedIds.includes(12), false, 'El cierre no selecciona una cuenta agregadora como destino.');
assert.strictEqual(proposal.proposedTransactions[1].entries[1].credit, 40.02, 'El resultado se lleva a acumulados al centavo.');
assert.throws(() => closingProposal(closeAccounts, { hasClosingEntries: true }), /Ya existe/);

const unbalancedOrders = closeAccounts.map(account => ({ ...account }));
unbalancedOrders[5].period_credit = 89.99;
assert.throws(() => closingProposal(unbalancedOrders), /cuentas de orden no cuadran/);

console.log('financialReportsCore assertions passed');
