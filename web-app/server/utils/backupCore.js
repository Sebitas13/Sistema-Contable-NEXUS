const crypto = require('crypto');

const BACKUP_VERSION = '2.0.0';
const LEGACY_BACKUP_VERSION = '1.0.0';

const IMPORT_ORDER = [
    'companies',
    'accounts',
    'inventory_items',
    'fixed_assets',
    'ufv_rates',
    'exchange_rates',
    'company_adjustment_profiles',
    'mahoraga_adaptation_events',
    'transactions',
    'transaction_entries',
    'inventory_movements',
    // Costos y producción (dependen de companies / inventory_items / entre sí).
    'cost_centers',
    'cost_distribution_models',
    'cost_distribution_entries',
    'production_orders'
];

const LEGACY_HASH_ORDER = [
    'companies',
    'accounts',
    'transactions',
    'transaction_entries',
    'ufv_rates',
    'exchange_rates',
    'mahoraga_adaptation_events',
    'company_adjustment_profiles'
];

function deduceColumns(rows = []) {
    const keys = new Set();
    rows.forEach((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return;
        }
        Object.keys(row).forEach((key) => keys.add(key));
    });
    return Array.from(keys).sort();
}

function stableClone(value) {
    if (Array.isArray(value)) {
        return value.map(stableClone);
    }

    if (value && typeof value === 'object') {
        const clone = {};
        Object.keys(value)
            .sort()
            .forEach((key) => {
                clone[key] = stableClone(value[key]);
            });
        return clone;
    }

    return value;
}

function stableStringify(value) {
    return JSON.stringify(stableClone(value));
}

function normalizeTablePayload(tableName, payload) {
    let rows = [];
    let columns = [];

    if (Array.isArray(payload)) {
        rows = payload;
    } else if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.rows)) {
            rows = payload.rows;
        } else if (Array.isArray(payload.data)) {
            rows = payload.data;
        }

        if (Array.isArray(payload.columns)) {
            columns = payload.columns.filter(Boolean);
        }
    }

    const normalizedRows = rows
        .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
        .map((row) => ({ ...row }));

    const deducedColumns = deduceColumns(normalizedRows);
    const mergedColumns = new Set([...(columns || []), ...deducedColumns]);

    return {
        table: tableName,
        columns: Array.from(mergedColumns).sort(),
        rows: normalizedRows
    };
}

function normalizeBackupTables(rawTables = {}) {
    const entries = Object.entries(rawTables).map(([tableName, payload]) => ([
        tableName,
        normalizeTablePayload(tableName, payload)
    ]));

    entries.sort(([left], [right]) => {
        const leftIndex = IMPORT_ORDER.indexOf(left);
        const rightIndex = IMPORT_ORDER.indexOf(right);

        if (leftIndex === -1 && rightIndex === -1) {
            return left.localeCompare(right);
        }

        if (leftIndex === -1) {
            return 1;
        }

        if (rightIndex === -1) {
            return -1;
        }

        return leftIndex - rightIndex;
    });

    return Object.fromEntries(entries);
}

function computeTablesChecksum(tables = {}) {
    const ordered = normalizeBackupTables(tables);
    const payload = {};

    Object.entries(ordered).forEach(([tableName, tablePayload]) => {
        payload[tableName] = {
            columns: [...(tablePayload.columns || [])].sort(),
            rows: (tablePayload.rows || []).map((row) => stableClone(row))
        };
    });

    return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function computeLegacyTablesHash(tables = {}) {
    const payload = {};

    LEGACY_HASH_ORDER.forEach((tableName) => {
        if (tables[tableName]) {
            payload[tableName] = (tables[tableName].rows || []).map((row) => ({ ...row }));
        }
    });

    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function countRowsByTable(tables = {}) {
    const counts = {};
    Object.entries(tables).forEach(([tableName, tablePayload]) => {
        counts[tableName] = Array.isArray(tablePayload.rows) ? tablePayload.rows.length : 0;
    });
    return counts;
}

function sumNumeric(rows = [], field) {
    return rows.reduce((total, row) => {
        const value = Number(row?.[field] ?? 0);
        return Number.isFinite(value) ? total + value : total;
    }, 0);
}

function validateBackupTables(tables = {}, metadata = {}) {
    const normalizedTables = normalizeBackupTables(tables);
    const errors = [];
    const warnings = [];

    const companies = normalizedTables.companies?.rows || [];
    const accounts = normalizedTables.accounts?.rows || [];
    const transactions = normalizedTables.transactions?.rows || [];
    const transactionEntries = normalizedTables.transaction_entries?.rows || [];
    const inventoryItems = normalizedTables.inventory_items?.rows || [];
    const inventoryMovements = normalizedTables.inventory_movements?.rows || [];

    if (companies.length !== 1) {
        errors.push('El backup debe contener exactamente una empresa origen.');
    }

    const accountIds = new Set(accounts.map((row) => String(row.id)));
    const transactionIds = new Set(transactions.map((row) => String(row.id)));
    const inventoryItemIds = new Set(inventoryItems.map((row) => String(row.id)));

    const orphanEntries = transactionEntries.filter((row) => (
        !transactionIds.has(String(row.transaction_id)) ||
        !accountIds.has(String(row.account_id))
    ));

    if (orphanEntries.length > 0) {
        errors.push(`Se detectaron ${orphanEntries.length} detalles de asiento huérfanos.`);
    }

    const orphanMovements = inventoryMovements.filter((row) => (
        !inventoryItemIds.has(String(row.item_id))
    ));

    if (orphanMovements.length > 0) {
        errors.push(`Se detectaron ${orphanMovements.length} movimientos de inventario huérfanos.`);
    }

    const totalDebit = sumNumeric(transactionEntries, 'debit');
    const totalCredit = sumNumeric(transactionEntries, 'credit');
    const balanceDelta = Number((totalDebit - totalCredit).toFixed(6));

    if (Math.abs(balanceDelta) > 0.0001) {
        warnings.push(`Los asientos no están balanceados. Diferencia débito-crédito: ${balanceDelta}.`);
    }

    const computedChecksum = computeTablesChecksum(normalizedTables);
    const legacyChecksum = computeLegacyTablesHash(normalizedTables);
    const expectedChecksum = metadata.checksum || metadata.hash || null;
    const useLegacyHash = metadata.version === LEGACY_BACKUP_VERSION && Boolean(metadata.hash);
    const checksumMatches = expectedChecksum
        ? (useLegacyHash ? expectedChecksum === legacyChecksum : expectedChecksum === computedChecksum)
        : null;

    if (expectedChecksum && !checksumMatches) {
        errors.push('El checksum del backup no coincide con el contenido del archivo.');
    }

    const counts = countRowsByTable(normalizedTables);
    const totalRows = Object.values(counts).reduce((sum, count) => sum + count, 0);

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        counts,
        totalRows,
        totalDebit,
        totalCredit,
        balanceDelta,
        computedChecksum,
        legacyChecksum,
        expectedChecksum,
        checksumMatches,
        sourceCompany: companies[0] || null
    };
}

function buildBackupMetadata({
    sourceCompany,
    tables,
    validation,
    checksum,
    schemaWarnings = []
}) {
    const counts = validation?.counts || countRowsByTable(tables);

    return {
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        companyName: sourceCompany?.name || 'Empresa',
        nit: sourceCompany?.nit || null,
        sourceCompanyId: sourceCompany?.id || null,
        counts,
        totalRows: validation?.totalRows || 0,
        checksum,
        compression: {
            format: 'zip',
            level: 9,
            payload: 'json-minified'
        },
        integrity: {
            valid: validation?.valid ?? true,
            checksumMatches: validation?.checksumMatches,
            totalDebit: validation?.totalDebit ?? 0,
            totalCredit: validation?.totalCredit ?? 0,
            balanceDelta: validation?.balanceDelta ?? 0,
            warnings: validation?.warnings || [],
            errors: validation?.errors || []
        },
        schemaWarnings
    };
}

module.exports = {
    BACKUP_VERSION,
    LEGACY_BACKUP_VERSION,
    IMPORT_ORDER,
    stableStringify,
    normalizeTablePayload,
    normalizeBackupTables,
    computeTablesChecksum,
    computeLegacyTablesHash,
    validateBackupTables,
    buildBackupMetadata
};
