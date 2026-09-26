const TYPE_MAP = new Map([
    ['activo', 'ASSET'],
    ['pasivo', 'LIABILITY'],
    ['patrimonio', 'EQUITY'],
    ['ingreso', 'REVENUE'],
    ['gasto', 'EXPENSE'],
    ['egreso', 'EXPENSE'],
    ['costo', 'COST'],
    ['resultado', 'RESULT'],
    ['otra cuenta de resultados', 'RESULT'],
    ['reguladora', 'REGULATORY'],
    ['orden', 'ORDER'],
    ['contingente', 'ORDER']
]);

function cents(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : 0;
}

function amount(valueInCents) {
    return valueInCents / 100;
}

function normalized(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function typeOf(account) {
    const type = normalized(account.type);
    const mapped = TYPE_MAP.get(type);
    if (mapped) return mapped;
    if (/reguladora/.test(type)) return 'REGULATORY';
    if (/^cuenta(s)? de orden|^orden\b/.test(type)) return 'ORDER';
    if (/^contingente/.test(type)) return 'ORDER';
    if (/^activo\b/.test(type)) return 'ASSET';
    if (/^pasivo\b/.test(type)) return 'LIABILITY';
    if (/^patrimonio\b/.test(type)) return 'EQUITY';
    if (/^costo(s)?\b/.test(type)) return 'COST';
    if (/^gasto(s)?\b|^egreso(s)?\b/.test(type)) return 'EXPENSE';
    if (/^ingreso(s)?\b/.test(type)) return 'REVENUE';
    if (/^resultado(s)?\b|^otra cuenta de resultado/.test(type)) return 'RESULT';

    const code = String(account.code || '').trim();
    if (/^1/.test(code)) return 'ASSET';
    if (/^2/.test(code)) return 'LIABILITY';
    if (/^3/.test(code)) return 'EQUITY';
    if (/^4/.test(code)) return 'REVENUE';
    if (/^5/.test(code)) return 'COST';
    if (/^6/.test(code)) return 'EXPENSE';
    return 'UNKNOWN';
}

function isRegulatoryAccount(account) {
    const type = normalized(account.type);
    const name = normalized(account.name);
    return /reguladora/.test(type) ||
        /depreciacion acumulada|amortizacion acumulada|deterioro acumulado|estimacion para cuentas incobrables/.test(name);
}

function isProfitClearingAccount(account) {
    const name = normalized(account.name);
    return /perdidas y ganancias|resultado del ejercicio|utilidad del ejercicio/.test(name);
}

function accountMovements(account, prefix = '') {
    const debit = cents(account[`${prefix}debit`] ?? account.total_debit);
    const credit = cents(account[`${prefix}credit`] ?? account.total_credit);
    return { debit, credit, signed: debit - credit };
}

function naturalBucket(account, balance) {
    if (isProfitClearingAccount(account)) return 'CLEARING';
    if (isRegulatoryAccount(account)) return 'REGULATORY';
    const type = typeOf(account);
    if (type === 'RESULT') return balance >= 0 ? 'EXPENSE' : 'REVENUE';
    if (type === 'REGULATORY') return 'REGULATORY';
    if (type === 'ASSET') return 'ASSET';
    if (type === 'LIABILITY') return 'LIABILITY';
    if (type === 'EQUITY') return 'EQUITY';
    if (type === 'REVENUE') return 'REVENUE';
    if (type === 'COST') return 'COST';
    if (type === 'EXPENSE') return 'EXPENSE';
    if (type === 'ORDER') return 'ORDER';
    return 'UNKNOWN';
}

function makeAccountGraph(accounts) {
    const nodes = new Map();
    const warnings = [];
    // Bulk inserts preserve the imported row order in the auto-incremented id.
    const importedOrder = [...accounts].sort((left, right) => {
        const leftId = Number(left.id);
        const rightId = Number(right.id);
        return Number.isFinite(leftId) && Number.isFinite(rightId) ? leftId - rightId : 0;
    });
    for (const account of importedOrder) {
        const code = String(account.code || '').trim();
        if (!code || nodes.has(code)) continue;
        nodes.set(code, {
            ...account,
            code,
            children: [],
            parent: null,
            ownBalance: 0,
            bucket: 'UNKNOWN'
        });
    }

    // parent_code is the imported relationship. For an implicit, non-persisted
    // parent, use the imported level and row sequence; never infer from codes.
    const latestNodeByLevel = new Map();
    const ancestorAtLevel = (node, targetLevel) => {
        const visited = new Set();
        let current = node;
        while (current && !visited.has(current)) {
            if (Number(current.level) === targetLevel) return current;
            visited.add(current);
            current = current.parent;
        }
        return null;
    };
    const followsOpenHierarchy = (node, level) => {
        for (let ancestorLevel = 1; ancestorLevel < level; ancestorLevel++) {
            if (ancestorAtLevel(node, ancestorLevel) !== latestNodeByLevel.get(ancestorLevel)) return false;
        }
        return true;
    };
    for (const node of nodes.values()) {
        const declaredParent = String(node.parent_code || '').trim();
        const selfParent = declaredParent === node.code;
        let parent = declaredParent && !selfParent
            ? nodes.get(declaredParent)
            : null;
        const level = Number(node.level);
        if (!parent && !selfParent && Number.isInteger(level) && level > 1) {
            for (let parentLevel = level - 1; parentLevel > 0; parentLevel--) {
                const candidate = latestNodeByLevel.get(parentLevel);
                if (candidate && followsOpenHierarchy(candidate, parentLevel)) parent = candidate;
                if (parent) break;
            }
        }
        node.parent = parent && parent !== node ? parent : null;

        if (selfParent) {
            warnings.push({ code: node.code, type: 'hierarchyCycle', message: 'La cuenta se declara como su propio padre y se presenta como raíz.' });
        } else if (declaredParent && !nodes.has(declaredParent)) {
            warnings.push({
                code: node.code,
                parent: declaredParent,
                resolvedParent: node.parent?.code || null,
                type: 'parentNotResolved',
                message: node.parent
                    ? `El padre importado ${declaredParent} no está materializado; se usaron nivel y orden del plan para presentarlo bajo ${node.parent.code}.`
                    : `El padre importado ${declaredParent} no está materializado y no se encontró un ancestro inequívoco por nivel y orden.`
            });
        }

        if (Number.isInteger(level) && level > 0) {
            for (const storedLevel of latestNodeByLevel.keys()) {
                if (storedLevel >= level) latestNodeByLevel.delete(storedLevel);
            }
            latestNodeByLevel.set(level, node);
        }
    }

    for (const node of nodes.values()) {
        if (node.parent && node.parent !== node) node.parent.children.push(node);
    }

    const visiting = new Set();
    const visited = new Set();
    const breakCycles = (node) => {
        if (visiting.has(node)) {
            warnings.push({ code: node.code, type: 'hierarchyCycle', message: 'Ciclo en parent_code; se cortó el vínculo para presentar el reporte.' });
            node.parent = null;
            return;
        }
        if (visited.has(node)) return;
        visiting.add(node);
        if (node.parent) breakCycles(node.parent);
        visiting.delete(node);
        visited.add(node);
    };
    for (const node of nodes.values()) breakCycles(node);

    for (const node of nodes.values()) {
        node.children = [];
    }
    for (const node of nodes.values()) {
        if (node.parent && node.parent !== node) node.parent.children.push(node);
    }

    const categoryOf = (node, ancestors = new Set()) => {
        if (node.bucket !== 'UNKNOWN' && node.bucket !== 'REGULATORY') return node.bucket;
        if (ancestors.has(node)) return 'UNKNOWN';
        ancestors.add(node);
        const explicit = typeOf(node);
        if (explicit === 'REGULATORY') {
            let parent = node.parent;
            while (parent) {
                const parentType = typeOf(parent);
                if (['ASSET', 'LIABILITY', 'EQUITY'].includes(parentType)) return parentType;
                parent = parent.parent;
            }
            return 'UNKNOWN';
        }
        if (explicit !== 'UNKNOWN') return explicit;
        let parent = node.parent;
        while (parent) {
            const parentType = typeOf(parent);
            if (['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE', 'ORDER'].includes(parentType)) {
                return parentType;
            }
            parent = parent.parent;
        }
        const childBuckets = new Set(node.children.map(child => categoryOf(child, new Set(ancestors)))
            .filter(bucket => bucket !== 'UNKNOWN'));
        return childBuckets.size === 1 ? [...childBuckets][0] : 'UNKNOWN';
    };

    for (const node of nodes.values()) {
        const movement = accountMovements(node);
        node.ownBalance = movement.signed;
        node.bucket = naturalBucket(node, movement.signed);
        if (node.bucket === 'REGULATORY') node.bucket = categoryOf(node);
    }
    // Generic imported types inherit their nature from the persisted hierarchy.
    for (const node of nodes.values()) {
        if (node.bucket === 'UNKNOWN') node.bucket = categoryOf(node);
    }

    return { nodes, warnings };
}

function graphNodeForAccount(graph, account) {
    return graph.nodes.get(String(account?.code || '').trim()) || null;
}

function treeForBucket(graph, bucket) {
    const accountNodes = [...graph.nodes.values()].filter(node => node.bucket === bucket);
    const displayParents = new Map();
    const displayChildren = new Map(accountNodes.map(node => [node, []]));
    for (const node of accountNodes) {
        let parent = node.parent;
        while (parent && parent.bucket !== bucket) {
            parent = parent.parent;
        }

        if (parent && parent !== node) {
            displayParents.set(node, parent);
            displayChildren.get(parent)?.push(node);
        }
    }

    const clones = new Map();
    const subtreeCentsByNode = new Map();
    const subtotalCents = (node) => {
        if (subtreeCentsByNode.has(node)) return subtreeCentsByNode.get(node);
        const subtotal = node.ownBalance + displayChildren.get(node).reduce(
            (sum, child) => sum + subtotalCents(child),
            0
        );
        subtreeCentsByNode.set(node, subtotal);
        return subtotal;
    };

    for (const node of accountNodes) {
        if (subtotalCents(node) === 0 && node.ownBalance === 0) continue;
        const displaySign = ['LIABILITY', 'EQUITY'].includes(bucket) ? -1 : 1;
        clones.set(node, {
            id: node.id,
            code: node.code,
            name: node.name,
            type: node.type,
            esReguladora: isRegulatoryAccount(node),
            ownBalance: amount(node.ownBalance * displaySign),
            total: 0,
            hijos: []
        });
    }
    const roots = [];
    for (const [node, clone] of clones) {
        let parent = displayParents.get(node);
        while (parent && !clones.has(parent)) parent = displayParents.get(parent);
        const parentClone = parent && clones.get(parent);
        if (parentClone) parentClone.hijos.push(clone);
        else roots.push(clone);
    }
    const sort = (list) => list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const total = (node) => {
        sort(node.hijos);
        const totalCents = cents(node.ownBalance) + node.hijos.reduce((sum, child) => {
            total(child);
            return sum + cents(child.total);
        }, 0);
        node.total = amount(totalCents);
        return node.total;
    };
    sort(roots);
    roots.forEach(total);
    return roots;
}

function statementItems(accounts, bucket, graph) {
    return accounts.map(account => {
        const movement = accountMovements(account, 'period_');
        const type = typeOf(account);
        if (isProfitClearingAccount(account) || isRegulatoryAccount(account)) return null;
        const accountBucket = type === 'RESULT'
            ? (movement.signed >= 0 ? 'EXPENSE' : 'REVENUE')
            : (graphNodeForAccount(graph, account)?.bucket || naturalBucket(account, movement.signed));
        if (accountBucket !== bucket) return null;
        const signed = bucket === 'REVENUE' ? -movement.signed : movement.signed;
        if (signed === 0) return null;
        return {
            id: account.id || account.code,
            code: account.code,
            name: account.name,
            saldo: amount(signed),
            displayValue: amount(signed)
        };
    }).filter(Boolean).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

function buildFinancialReports(accounts, { startDate, endDate, hasResultClosing = false } = {}) {
    const graph = makeAccountGraph(accounts);
    const accountBuckets = accounts.map(account => {
        const period = accountMovements(account, 'period_');
        const bucket = isProfitClearingAccount(account)
            ? 'CLEARING'
            : (typeOf(account) === 'RESULT'
                ? (period.signed >= 0 ? 'EXPENSE' : 'REVENUE')
                : (graphNodeForAccount(graph, account)?.bucket || 'UNKNOWN'));
        return { account, bucket };
    });

    const incomes = statementItems(accounts, 'REVENUE', graph);
    const costs = statementItems(accounts, 'COST', graph);
    const expenses = statementItems(accounts, 'EXPENSE', graph);
    const totalIncomeCents = incomes.reduce((sum, item) => sum + cents(item.saldo), 0);
    const totalCostCents = costs.reduce((sum, item) => sum + cents(item.saldo), 0);
    const totalExpenseCents = expenses.reduce((sum, item) => sum + cents(item.saldo), 0);
    const resultCents = totalIncomeCents - totalCostCents - totalExpenseCents;

    const assets = treeForBucket(graph, 'ASSET');
    const liabilities = treeForBucket(graph, 'LIABILITY');
    const equity = treeForBucket(graph, 'EQUITY');
    if (!hasResultClosing && resultCents !== 0) {
        const resultNode = {
            id: 'unposted-period-result',
            code: '',
            name: 'Resultado contable del período (no contabilizado)',
            type: 'Patrimonio',
            esSintetico: true,
            ownBalance: amount(resultCents),
            total: amount(resultCents),
            hijos: []
        };
        if (equity.length) equity[0].hijos.push(resultNode);
        else equity.push({
            id: 'presentation-equity',
            code: '',
            name: 'Patrimonio',
            ownBalance: 0,
            total: amount(resultCents),
            hijos: [resultNode]
        });
        const recalc = (node) => {
            const childrenCents = node.hijos.reduce((sum, child) => sum + cents(recalc(child)), 0);
            node.total = amount(cents(node.ownBalance || 0) + childrenCents);
            return node.total;
        };
        equity.forEach(recalc);
    }

    const sumTree = (nodes) => Math.round(nodes.reduce((sum, node) => sum + cents(node.total), 0));
    const assetCents = sumTree(assets);
    const liabilityCents = sumTree(liabilities);
    const equityCents = sumTree(equity);
    const differenceCents = assetCents - liabilityCents - equityCents;

    return {
        balanceGeneral: {
            activos: assets,
            pasivos: liabilities,
            patrimonio: equity,
            totales: {
                activo: amount(assetCents),
                pasivo: amount(liabilityCents),
                patrimonio: amount(equityCents)
            },
            ecuacionCuadra: Math.abs(differenceCents) <= 1,
            diferencia: amount(Math.abs(differenceCents)),
            utilidadNeta: amount(resultCents)
        },
        estadoResultados: {
            secciones: {
                ingresos: incomes,
                descuentos: [],
                costos: costs,
                gastosAdmin: expenses,
                gastosVenta: [],
                gastosFinancieros: [],
                otrosIngresos: [],
                otrosEgresos: [],
                noImponibles: []
            },
            totales: {
                ventasNetas: amount(totalIncomeCents),
                utilidadBruta: amount(totalIncomeCents - totalCostCents),
                utilidadEnVentas: amount(resultCents),
                totalGastosOp: amount(totalExpenseCents),
                utilidadOperativa: amount(resultCents),
                utilidadBrutaEjercicio: amount(resultCents),
                compensacion: 0,
                baseImponible: null,
                iue: 0,
                valNoImponibles: 0,
                utilidadNeta: amount(resultCents),
                reservaLegal: 0,
                utilidadLiquida: amount(resultCents)
            },
            period: { startDate: startDate || null, endDate: endDate || null },
            audit: [
                'Clasificación basada en el tipo de cuenta y, como respaldo, el prefijo del código; valida la presentación por rubro según la actividad y el marco aplicable.',
                'Resultado contable calculado desde movimientos del período; no equivale a la base imponible del IUE.',
                'IUE y reservas no se estiman ni se contabilizan automáticamente.'
            ]
        },
        metadata: {
            startDate: startDate || null,
            endDate: endDate || null,
            warnings: graph.warnings,
            accountsNotClassified: accountBuckets.filter(item => item.bucket === 'UNKNOWN').length,
            classificationByAccountId: Object.fromEntries(accountBuckets
                .filter(item => item.account.id != null && item.bucket !== 'UNKNOWN')
                .map(item => [String(item.account.id), item.bucket]))
        }
    };
}

function closingProposal(accounts, { closingDate, hasClosingEntries = false } = {}) {
    if (hasClosingEntries) {
        throw new Error('Ya existe al menos un asiento de cierre para esta gestión. Revisa el mayor antes de continuar.');
    }

    const graph = makeAccountGraph(accounts);
    const leafAccounts = accounts.filter(account => {
        const node = graphNodeForAccount(graph, account);
        return !node || node.children.length === 0;
    });
    const clearingAccounts = leafAccounts.filter(account => isProfitClearingAccount(account) &&
        graphNodeForAccount(graph, account)?.bucket === 'CLEARING');
    const retainedEarnings = leafAccounts.filter(account => graphNodeForAccount(graph, account)?.bucket === 'EQUITY' &&
        /resultados acumulados/.test(normalized(account.name)));
    if (clearingAccounts.length !== 1 || retainedEarnings.length !== 1) {
        throw new Error(`Se requiere una sola cuenta hoja de Pérdidas y Ganancias/Resultado del ejercicio y una sola cuenta hoja de Resultados Acumulados. Encontradas: P&G=${clearingAccounts.length}, acumulados=${retainedEarnings.length}.`);
    }

    const pyg = clearingAccounts[0];
    const ra = retainedEarnings[0];
    const accountEntries = [];
    let pygDebitCents = 0;
    let pygCreditCents = 0;

    for (const account of accounts) {
        if (String(account.id) === String(pyg.id) || String(account.id) === String(ra.id)) continue;
        const movement = accountMovements(account, 'period_');
        if (isRegulatoryAccount(account) || isProfitClearingAccount(account)) continue;
        const bucket = typeOf(account) === 'RESULT'
            ? (movement.signed >= 0 ? 'EXPENSE' : 'REVENUE')
            : (graphNodeForAccount(graph, account)?.bucket || naturalBucket(account, movement.signed));
        if (movement.signed === 0 || !['REVENUE', 'COST', 'EXPENSE'].includes(bucket)) continue;

        if (movement.signed > 0) {
            accountEntries.push({ accountId: account.id, accountName: account.name, debit: 0, credit: amount(movement.signed) });
            pygDebitCents += movement.signed;
        } else {
            const value = Math.abs(movement.signed);
            accountEntries.push({ accountId: account.id, accountName: account.name, debit: amount(value), credit: 0 });
            pygCreditCents += value;
        }
    }

    const proposedTransactions = [];
    if (accountEntries.length) {
        const entries = [
            ...accountEntries,
            ...(pygDebitCents ? [{ accountId: pyg.id, accountName: pyg.name, debit: amount(pygDebitCents), credit: 0 }] : []),
            ...(pygCreditCents ? [{ accountId: pyg.id, accountName: pyg.name, debit: 0, credit: amount(pygCreditCents) }] : [])
        ];
        proposedTransactions.push({ gloss: 'Asiento de Cierre: Cuentas de Resultado', entries });
    }

    const pygBalance = accountMovements(pyg, 'period_').signed + pygDebitCents - pygCreditCents;
    if (pygBalance !== 0) {
        const loss = pygBalance > 0;
        const value = Math.abs(pygBalance);
        proposedTransactions.push({
            gloss: 'Asiento de Cierre: Aplicación del resultado contable',
            entries: loss
                ? [
                    { accountId: ra.id, accountName: ra.name, debit: amount(value), credit: 0 },
                    { accountId: pyg.id, accountName: pyg.name, debit: 0, credit: amount(value) }
                ]
                : [
                    { accountId: pyg.id, accountName: pyg.name, debit: amount(value), credit: 0 },
                    { accountId: ra.id, accountName: ra.name, debit: 0, credit: amount(value) }
                ]
        });
    }

    const orderAccounts = accounts.filter(account =>
        graphNodeForAccount(graph, account)?.bucket === 'ORDER'
    );
    const orderEntries = [];
    let orderDebitCents = 0;
    let orderCreditCents = 0;
    for (const account of orderAccounts) {
        const balance = accountMovements(account, 'period_').signed;
        if (balance > 0) {
            orderEntries.push({ accountId: account.id, accountName: account.name, debit: 0, credit: amount(balance) });
            orderCreditCents += balance;
        } else if (balance < 0) {
            const value = Math.abs(balance);
            orderEntries.push({ accountId: account.id, accountName: account.name, debit: amount(value), credit: 0 });
            orderDebitCents += value;
        }
    }
    if (orderEntries.length) {
        if (orderDebitCents !== orderCreditCents) {
            throw new Error(`Las cuentas de orden no cuadran por Bs ${amount(Math.abs(orderDebitCents - orderCreditCents)).toFixed(2)}. Corrige o identifica las cuentas de contrapartida antes de cerrar.`);
        }
        proposedTransactions.push({ gloss: 'Asiento de Cierre: Cuentas de Orden', entries: orderEntries });
    }

    for (const transaction of proposedTransactions) {
        const debitCents = transaction.entries.reduce((sum, entry) => sum + cents(entry.debit), 0);
        const creditCents = transaction.entries.reduce((sum, entry) => sum + cents(entry.credit), 0);
        if (debitCents !== creditCents) {
            throw new Error(`El asiento "${transaction.gloss}" no cuadra al centavo.`);
        }
    }

    return { proposedTransactions, closingDate };
}

module.exports = {
    cents,
    amount,
    normalized,
    typeOf,
    makeAccountGraph,
    buildFinancialReports,
    closingProposal
};
