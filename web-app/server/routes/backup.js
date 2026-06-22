const express = require('express');
const router = express.Router();
const db = require('../db');
const archiver = require('archiver');
const unzipper = require('unzipper');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const { getExpectedToken } = require('../utils/auth');

const {
    BACKUP_VERSION,
    normalizeBackupTables,
    computeTablesChecksum,
    validateBackupTables,
    buildBackupMetadata
} = require('../utils/backupCore');

const MAX_SIZE = 100 * 1024 * 1024; // 100MB
const UPLOAD_DIR = path.join(__dirname, '../temp/uploads/');
const INTERNAL_API_BASE_URL = process.env.INTERNAL_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;

const SUPPORTED_TABLES = [
    'companies',
    'accounts',
    'transactions',
    'transaction_entries',
    'inventory_items',
    'inventory_movements',
    'fixed_assets',
    'ufv_rates',
    'exchange_rates',
    'company_adjustment_profiles',
    'mahoraga_adaptation_events',
    'cost_centers',
    'cost_distribution_models',
    'cost_distribution_entries',
    'production_orders'
];

const DIRECT_COMPANY_TABLES = new Set([
    'accounts',
    'transactions',
    'inventory_items',
    'fixed_assets',
    'ufv_rates',
    'exchange_rates',
    'company_adjustment_profiles',
    'mahoraga_adaptation_events',
    'cost_centers',
    'cost_distribution_models',
    'production_orders'
]);

fs.ensureDirSync(UPLOAD_DIR);

const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
        // Aceptar solo .zip (por extensión o mimetype habitual de zips).
        const okExt = /\.zip$/i.test(file.originalname || '');
        const okMime = [
            'application/zip',
            'application/x-zip-compressed',
            'application/octet-stream',
            'multipart/x-zip'
        ].includes(file.mimetype);
        if (okExt || okMime) return cb(null, true);
        cb(new Error('Formato inválido: se espera un archivo .zip de backup.'));
    }
});

// Envuelve multer para devolver errores claros (tamaño/tipo) en JSON en vez de un 500 genérico.
const uploadSingle = (field) => (req, res, next) => {
    upload.single(field)(req, res, (err) => {
        if (err) {
            const isSize = err.code === 'LIMIT_FILE_SIZE';
            return res.status(isSize ? 413 : 400).json({
                error: isSize
                    ? `El archivo supera el tamaño máximo permitido (${Math.round(MAX_SIZE / 1024 / 1024)} MB).`
                    : 'Error al subir el archivo: ' + err.message
            });
        }
        next();
    });
};

function escapeIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

function normalizeValue(value) {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return value;
}

function normalizeRow(row) {
    if (!row || typeof row !== 'object') {
        return row;
    }

    const normalized = {};
    Object.keys(row).forEach((key) => {
        normalized[key] = normalizeValue(row[key]);
    });
    return normalized;
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatRestoreSuffix(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sanitizeFilename(value) {
    const sanitized = String(value || 'Empresa')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    return sanitized || 'Empresa';
}

function uniqueMessages(messages = []) {
    return Array.from(new Set(messages.filter(Boolean)));
}

function incrementCounter(target, key, amount = 1) {
    target[key] = (target[key] || 0) + amount;
}

function createDbApi(overrides = {}) {
    return {
        all: overrides.all || ((sql, params = []) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve((rows || []).map(normalizeRow));
            });
        })),
        get: overrides.get || ((sql, params = []) => new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row ? normalizeRow(row) : undefined);
            });
        })),
        run: overrides.run || ((sql, params = []) => new Promise((resolve, reject) => {
            db.run(sql, params, function runCallback(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({
                    lastID: normalizeValue(this?.lastID),
                    changes: normalizeValue(this?.changes) || 0
                });
            });
        }))
    };
}

const rootDbApi = createDbApi();

function createTransactionApi(tx) {
    return createDbApi({
        all: async (sql, params = []) => {
            const result = await tx.execute({ sql, args: params });
            return (result.rows || []).map(normalizeRow);
        },
        get: async (sql, params = []) => {
            const rows = await tx.execute({ sql, args: params });
            return rows.rows?.length ? normalizeRow(rows.rows[0]) : undefined;
        },
        run: async (sql, params = []) => {
            const result = await tx.execute({ sql, args: params });
            return {
                lastID: normalizeValue(result.lastInsertRowid),
                changes: normalizeValue(result.rowsAffected) || 0
            };
        }
    });
}

async function withTransaction(work) {
    if (typeof db.transaction === 'function') {
        // libsql/@libsql/client no garantiza retornar el valor del callback,
        // así que capturamos el resultado manualmente para evitar `undefined`.
        let result;
        await db.transaction(async (tx) => {
            result = await work(createTransactionApi(tx));
        });
        return result;
    }

    const fallbackApi = rootDbApi;
    await fallbackApi.run('BEGIN IMMEDIATE TRANSACTION');
    try {
        const result = await work(fallbackApi);
        await fallbackApi.run('COMMIT');
        return result;
    } catch (error) {
        try {
            await fallbackApi.run('ROLLBACK');
        } catch (rollbackError) {
            console.warn('Rollback de backup falló:', rollbackError.message);
        }
        throw error;
    }
}

async function safeRemoveFile(filePath) {
    if (!filePath) {
        return;
    }

    try {
        await fs.remove(filePath);
    } catch (error) {
        console.warn('No se pudo limpiar archivo temporal:', error.message);
    }
}

async function getTableState(tableName, queryApi = rootDbApi, cache = new Map()) {
    if (cache.has(tableName)) {
        return cache.get(tableName);
    }

    const table = await queryApi.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [tableName]
    );

    if (!table) {
        const missingState = { exists: false, columns: [], columnSet: new Set() };
        cache.set(tableName, missingState);
        return missingState;
    }

    const tableInfo = await queryApi.all(`PRAGMA table_info(${escapeIdentifier(tableName)})`);
    const columns = tableInfo.map((column) => column.name);
    const state = {
        exists: true,
        columns,
        columnSet: new Set(columns)
    };

    cache.set(tableName, state);
    return state;
}

function buildOrderClause(state, preferredColumns = []) {
    const candidates = [...preferredColumns, 'date', 'created_at', 'code', 'id'];
    const columns = [];

    candidates.forEach((column) => {
        if (state.columnSet.has(column) && !columns.includes(column)) {
            columns.push(column);
        }
    });

    if (columns.length === 0) {
        return '';
    }

    return ` ORDER BY ${columns.map((column) => `${escapeIdentifier(column)} ASC`).join(', ')}`;
}

async function queryEntireTable(tableName, queryApi = rootDbApi, cache = new Map()) {
    const state = await getTableState(tableName, queryApi, cache);
    if (!state.exists) {
        return [];
    }

    return queryApi.all(
        `SELECT * FROM ${escapeIdentifier(tableName)}${buildOrderClause(state)}`,
        []
    );
}

async function queryCompanyScopedTable(tableName, companyId, schemaWarnings, queryApi = rootDbApi, cache = new Map()) {
    const state = await getTableState(tableName, queryApi, cache);
    if (!state.exists) {
        return [];
    }

    if (state.columnSet.has('company_id')) {
        return queryApi.all(
            `SELECT * FROM ${escapeIdentifier(tableName)} WHERE company_id = ?${buildOrderClause(state)}`,
            [companyId]
        );
    }

    schemaWarnings.push(`La tabla ${tableName} no tiene company_id. Se exportaron todos sus registros por compatibilidad legacy.`);
    return queryEntireTable(tableName, queryApi, cache);
}

async function queryTransactionEntries(companyId, schemaWarnings, queryApi = rootDbApi, cache = new Map()) {
    const transactionState = await getTableState('transactions', queryApi, cache);
    const entryState = await getTableState('transaction_entries', queryApi, cache);

    if (!transactionState.exists || !entryState.exists) {
        return [];
    }

    if (transactionState.columnSet.has('company_id')) {
        return queryApi.all(`
            SELECT te.*
            FROM transaction_entries te
            JOIN transactions t ON te.transaction_id = t.id
            WHERE t.company_id = ?
            ORDER BY te.transaction_id ASC, te.id ASC
        `, [companyId]);
    }

    schemaWarnings.push('La tabla transactions no tiene company_id. Se exportaron todos los detalles de asientos.');
    return queryEntireTable('transaction_entries', queryApi, cache);
}

async function queryInventoryMovements(companyId, schemaWarnings, queryApi = rootDbApi, cache = new Map()) {
    const itemState = await getTableState('inventory_items', queryApi, cache);
    const movementState = await getTableState('inventory_movements', queryApi, cache);

    if (!itemState.exists || !movementState.exists) {
        return [];
    }

    if (itemState.columnSet.has('company_id')) {
        return queryApi.all(`
            SELECT im.*
            FROM inventory_movements im
            JOIN inventory_items ii ON im.item_id = ii.id
            WHERE ii.company_id = ?
            ORDER BY im.date ASC, im.id ASC
        `, [companyId]);
    }

    schemaWarnings.push('La tabla inventory_items no tiene company_id. Se exportaron todos los movimientos de inventario.');
    return queryEntireTable('inventory_movements', queryApi, cache);
}

async function queryCostDistributionEntries(companyId, schemaWarnings, queryApi = rootDbApi, cache = new Map()) {
    const modelState = await getTableState('cost_distribution_models', queryApi, cache);
    const entryState = await getTableState('cost_distribution_entries', queryApi, cache);

    if (!modelState.exists || !entryState.exists) {
        return [];
    }

    if (modelState.columnSet.has('company_id')) {
        return queryApi.all(`
            SELECT cde.*
            FROM cost_distribution_entries cde
            JOIN cost_distribution_models cdm ON cde.model_id = cdm.id
            WHERE cdm.company_id = ?
            ORDER BY cde.model_id ASC, cde.id ASC
        `, [companyId]);
    }

    schemaWarnings.push('La tabla cost_distribution_models no tiene company_id. Se exportaron todas las entradas de distribución de costos.');
    return queryEntireTable('cost_distribution_entries', queryApi, cache);
}

async function exportCompanyData(companyId) {
    const cache = new Map();
    const schemaWarnings = [];
    const sourceCompany = await rootDbApi.get('SELECT * FROM companies WHERE id = ?', [companyId]);

    if (!sourceCompany) {
        return null;
    }

    const rawTables = {
        companies: { rows: [sourceCompany] },
        accounts: { rows: await queryCompanyScopedTable('accounts', companyId, schemaWarnings, rootDbApi, cache) },
        transactions: { rows: await queryCompanyScopedTable('transactions', companyId, schemaWarnings, rootDbApi, cache) },
        transaction_entries: { rows: await queryTransactionEntries(companyId, schemaWarnings, rootDbApi, cache) },
        inventory_items: { rows: await queryCompanyScopedTable('inventory_items', companyId, schemaWarnings, rootDbApi, cache) },
        inventory_movements: { rows: await queryInventoryMovements(companyId, schemaWarnings, rootDbApi, cache) },
        fixed_assets: { rows: await queryCompanyScopedTable('fixed_assets', companyId, schemaWarnings, rootDbApi, cache) },
        ufv_rates: { rows: await queryCompanyScopedTable('ufv_rates', companyId, schemaWarnings, rootDbApi, cache) },
        exchange_rates: { rows: await queryCompanyScopedTable('exchange_rates', companyId, schemaWarnings, rootDbApi, cache) },
        company_adjustment_profiles: { rows: await queryCompanyScopedTable('company_adjustment_profiles', companyId, schemaWarnings, rootDbApi, cache) },
        mahoraga_adaptation_events: { rows: await queryCompanyScopedTable('mahoraga_adaptation_events', companyId, schemaWarnings, rootDbApi, cache) },
        cost_centers: { rows: await queryCompanyScopedTable('cost_centers', companyId, schemaWarnings, rootDbApi, cache) },
        cost_distribution_models: { rows: await queryCompanyScopedTable('cost_distribution_models', companyId, schemaWarnings, rootDbApi, cache) },
        cost_distribution_entries: { rows: await queryCostDistributionEntries(companyId, schemaWarnings, rootDbApi, cache) },
        production_orders: { rows: await queryCompanyScopedTable('production_orders', companyId, schemaWarnings, rootDbApi, cache) }
    };

    const tables = normalizeBackupTables(rawTables);
    const validation = validateBackupTables(tables, {});
    const checksum = computeTablesChecksum(tables);
    const metadata = buildBackupMetadata({
        sourceCompany,
        tables,
        validation,
        checksum,
        schemaWarnings: uniqueMessages(schemaWarnings)
    });

    return {
        sourceCompany,
        tables,
        validation,
        metadata
    };
}

async function readJsonEntry(directory, entryPath) {
    const entry = directory.files.find((file) => file.path === entryPath);
    if (!entry) {
        return null;
    }

    const content = await entry.buffer();
    try {
        return JSON.parse(content.toString('utf8'));
    } catch (error) {
        throw new Error(`No se pudo parsear ${entryPath}: ${error.message}`);
    }
}

async function readBackupBundle(filePath) {
    const directory = await unzipper.Open.file(filePath);
    const metadata = await readJsonEntry(directory, 'metadata.json');

    if (!metadata) {
        throw new Error('Backup inválido: falta metadata.json.');
    }

    const rawTables = {};
    const dataFiles = directory.files.filter(
        (file) => file.path.startsWith('data/') && file.path.endsWith('.json')
    );

    for (const file of dataFiles) {
        const tableName = path.basename(file.path, '.json');
        rawTables[tableName] = await readJsonEntry(directory, file.path);
    }

    const tables = normalizeBackupTables(rawTables);
    const validation = validateBackupTables(tables, metadata);

    return {
        metadata,
        tables,
        validation
    };
}

function listDroppedColumns(tablePayload, state) {
    return (tablePayload.columns || []).filter((column) => (
        !state.columnSet.has(column) &&
        column !== 'id' &&
        column !== 'company_id'
    ));
}

async function assessRestoreCompatibility(bundle) {
    const cache = new Map();
    const errors = [];
    const warnings = [];

    const sourceCompany = bundle.validation.sourceCompany || bundle.tables.companies?.rows?.[0];
    if (sourceCompany?.nit) {
        const existingNit = await rootDbApi.get('SELECT id, name FROM companies WHERE nit = ?', [sourceCompany.nit]);
        if (existingNit) {
            warnings.push(`El NIT ${sourceCompany.nit} ya existe en la empresa "${existingNit.name}". Durante la restauración se dejará el NIT vacío para evitar conflicto.`);
        }
    }

    for (const [tableName, tablePayload] of Object.entries(bundle.tables)) {
        if (!SUPPORTED_TABLES.includes(tableName)) {
            if ((tablePayload.rows || []).length > 0) {
                warnings.push(`La tabla ${tableName} no está soportada por esta versión y no se restaurará automáticamente.`);
            }
            continue;
        }

        if (tableName === 'companies' || (tablePayload.rows || []).length === 0) {
            continue;
        }

        const state = await getTableState(tableName, rootDbApi, cache);
        if (!state.exists) {
            errors.push(`La tabla destino ${tableName} no existe en la base de datos actual.`);
            continue;
        }

        const droppedColumns = listDroppedColumns(tablePayload, state);
        if (droppedColumns.length > 0) {
            warnings.push(`La tabla ${tableName} omitirá columnas no soportadas: ${droppedColumns.join(', ')}.`);
        }

        if (DIRECT_COMPANY_TABLES.has(tableName) && !state.columnSet.has('company_id')) {
            errors.push(`La tabla ${tableName} no tiene la columna company_id. Migra la base de datos antes de restaurar.`);
        }

        if (tableName === 'exchange_rates') {
            const supportsModernRates = state.columnSet.has('currency') &&
                state.columnSet.has('buy_rate') &&
                state.columnSet.has('sell_rate');
            const supportsLegacyRates = state.columnSet.has('usd_buy') && state.columnSet.has('usd_sell');

            if (!supportsModernRates && !supportsLegacyRates) {
                errors.push('La tabla exchange_rates no tiene columnas compatibles para restaurar tipos de cambio.');
            }

            if (supportsLegacyRates) {
                const nonUsdRows = tablePayload.rows.filter((row) => String(row.currency || 'USD').toUpperCase() !== 'USD');
                if (nonUsdRows.length > 0) {
                    errors.push('El destino exchange_rates es legacy y no soporta monedas distintas a USD.');
                }
            }
        }

        if (tableName === 'ufv_rates') {
            const hasCoreColumns = state.columnSet.has('date') && state.columnSet.has('value');
            if (!hasCoreColumns) {
                errors.push('La tabla ufv_rates no tiene las columnas mínimas requeridas (date, value).');
            }
        }
    }

    return {
        ready: errors.length === 0,
        errors: uniqueMessages(errors),
        warnings: uniqueMessages(warnings)
    };
}

function buildInsertRow(sourceRow, state, { companyId, includeId = false, omitColumns = [], overrides = {} } = {}) {
    const omitted = new Set(includeId ? omitColumns : ['id', ...omitColumns]);
    const row = {};

    state.columns.forEach((column) => {
        if (omitted.has(column)) {
            return;
        }

        if (Object.prototype.hasOwnProperty.call(overrides, column)) {
            row[column] = overrides[column];
            return;
        }

        if (column === 'company_id' && companyId !== undefined) {
            row[column] = companyId;
            return;
        }

        if (Object.prototype.hasOwnProperty.call(sourceRow, column)) {
            row[column] = sourceRow[column];
        }
    });

    Object.entries(overrides).forEach(([column, value]) => {
        if (state.columnSet.has(column) && !omitted.has(column)) {
            row[column] = value;
        }
    });

    return row;
}

async function insertRow(tableName, row, queryApi, cache) {
    const state = await getTableState(tableName, queryApi, cache);
    const columns = state.columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));

    if (columns.length === 0) {
        return { lastID: null, changes: 0 };
    }

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${escapeIdentifier(tableName)} (${columns.map(escapeIdentifier).join(', ')}) VALUES (${placeholders})`;

    return queryApi.run(sql, columns.map((column) => row[column]));
}

async function buildUniqueEventId(queryApi, baseId, sequence) {
    const root = String(baseId || `event-${sequence}`);
    let candidate = root;
    let suffix = 0;

    while (await queryApi.get('SELECT id FROM mahoraga_adaptation_events WHERE id = ?', [candidate])) {
        suffix += 1;
        candidate = `${root}::restored::${sequence}${suffix > 1 ? `-${suffix}` : ''}`;
    }

    return candidate;
}

function buildExchangeRateRow(sourceRow, state, companyId, restoreWarnings) {
    const currency = String(sourceRow.currency || 'USD').toUpperCase();
    const buyRate = sourceRow.buy_rate ?? sourceRow.usd_buy;
    const sellRate = sourceRow.sell_rate ?? sourceRow.usd_sell;

    if (buyRate === undefined || sellRate === undefined) {
        restoreWarnings.push(`Se omitió un tipo de cambio sin tasas válidas para la fecha ${sourceRow.date || 'desconocida'}.`);
        return null;
    }

    const supportsModernRates = state.columnSet.has('currency') &&
        state.columnSet.has('buy_rate') &&
        state.columnSet.has('sell_rate');

    if (supportsModernRates) {
        return buildInsertRow(sourceRow, state, {
            companyId,
            overrides: {
                currency,
                buy_rate: buyRate,
                sell_rate: sellRate
            }
        });
    }

    if (currency !== 'USD') {
        restoreWarnings.push(`Se omitió un tipo de cambio ${currency} porque el esquema destino solo soporta USD.`);
        return null;
    }

    return buildInsertRow(sourceRow, state, {
        companyId,
        overrides: {
            usd_buy: buyRate,
            usd_sell: sellRate
        }
    });
}

async function restoreBackupBundle(bundle) {
    const compatibility = await assessRestoreCompatibility(bundle);
    if (!bundle.validation.valid) {
        const reason = bundle.validation.errors[0] || 'El backup no pasó la validación.';
        throw new Error(reason);
    }

    if (!compatibility.ready) {
        const reason = compatibility.errors[0] || 'El entorno actual no es compatible con este backup.';
        throw new Error(reason);
    }

    const sourceCompany = bundle.validation.sourceCompany || bundle.tables.companies?.rows?.[0];
    if (!sourceCompany) {
        throw new Error('No se encontró la empresa origen dentro del backup.');
    }

    return withTransaction(async (queryApi) => {
        const cache = new Map();
        const restoreWarnings = [...compatibility.warnings];
        const stats = {
            imported: {},
            skipped: {}
        };
        let eventSequence = 0;

        const companyState = await getTableState('companies', queryApi, cache);
        if (!companyState.exists) {
            throw new Error('La tabla companies no existe en la base de datos.');
        }

        const existingNit = sourceCompany.nit
            ? await queryApi.get('SELECT id, name FROM companies WHERE nit = ?', [sourceCompany.nit])
            : null;

        const restoredCompanyName = `${sourceCompany.name || 'Empresa'} (Restaurado ${formatRestoreSuffix()})`;
        const companyRow = buildInsertRow(sourceCompany, companyState, {
            omitColumns: ['created_at', 'updated_at'],
            overrides: {
                name: restoredCompanyName,
                nit: existingNit ? null : (sourceCompany.nit || null),
                legal_name: sourceCompany.legal_name || sourceCompany.name || restoredCompanyName
            }
        });

        const companyInsert = await insertRow('companies', companyRow, queryApi, cache);
        const newCompanyId = companyInsert.lastID;

        if (!newCompanyId) {
            throw new Error('No se pudo crear la empresa restaurada.');
        }

        if (existingNit) {
            restoreWarnings.push(`Se creó la empresa sin NIT porque ${sourceCompany.nit} ya estaba registrado en "${existingNit.name}".`);
        }

        const accountIdMap = new Map();
        const transactionIdMap = new Map();
        const inventoryItemIdMap = new Map();

        const restoreSimpleScopedRows = async (tableName, idMap = null, rowBuilder = null) => {
            const rows = bundle.tables[tableName]?.rows || [];
            if (rows.length === 0) {
                return;
            }

            const state = await getTableState(tableName, queryApi, cache);
            for (const sourceRow of rows) {
                const insertPayload = rowBuilder
                    ? await rowBuilder(sourceRow, state)
                    : buildInsertRow(sourceRow, state, { companyId: newCompanyId });

                if (!insertPayload) {
                    incrementCounter(stats.skipped, tableName);
                    continue;
                }

                const result = await insertRow(tableName, insertPayload, queryApi, cache);
                incrementCounter(stats.imported, tableName);

                if (idMap && sourceRow.id !== undefined && sourceRow.id !== null && result.lastID !== null && result.lastID !== undefined) {
                    idMap.set(String(sourceRow.id), result.lastID);
                }
            }
        };

        await restoreSimpleScopedRows('accounts', accountIdMap);
        await restoreSimpleScopedRows('inventory_items', inventoryItemIdMap);
        await restoreSimpleScopedRows('fixed_assets');
        await restoreSimpleScopedRows('ufv_rates');
        await restoreSimpleScopedRows('exchange_rates', null, async (sourceRow, state) => (
            buildExchangeRateRow(sourceRow, state, newCompanyId, restoreWarnings)
        ));
        await restoreSimpleScopedRows('company_adjustment_profiles');
        await restoreSimpleScopedRows('mahoraga_adaptation_events', null, async (sourceRow, state) => {
            eventSequence += 1;
            const eventId = await buildUniqueEventId(queryApi, sourceRow.id, eventSequence);
            return buildInsertRow(sourceRow, state, {
                companyId: newCompanyId,
                includeId: true,
                overrides: { id: eventId }
            });
        });

        const transactionState = await getTableState('transactions', queryApi, cache);
        const transactions = bundle.tables.transactions?.rows || [];
        for (const sourceRow of transactions) {
            const result = await insertRow(
                'transactions',
                buildInsertRow(sourceRow, transactionState, { companyId: newCompanyId }),
                queryApi,
                cache
            );
            incrementCounter(stats.imported, 'transactions');

            if (sourceRow.id !== undefined && sourceRow.id !== null && result.lastID !== null && result.lastID !== undefined) {
                transactionIdMap.set(String(sourceRow.id), result.lastID);
            }
        }

        const entryState = await getTableState('transaction_entries', queryApi, cache);
        const entries = bundle.tables.transaction_entries?.rows || [];
        for (const sourceRow of entries) {
            const newTransactionId = transactionIdMap.get(String(sourceRow.transaction_id));
            const newAccountId = accountIdMap.get(String(sourceRow.account_id));

            if (!newTransactionId || !newAccountId) {
                incrementCounter(stats.skipped, 'transaction_entries');
                restoreWarnings.push(`Se omitió un detalle de asiento por referencias faltantes (transaction_id=${sourceRow.transaction_id}, account_id=${sourceRow.account_id}).`);
                continue;
            }

            await insertRow(
                'transaction_entries',
                buildInsertRow(sourceRow, entryState, {
                    overrides: {
                        transaction_id: newTransactionId,
                        account_id: newAccountId
                    }
                }),
                queryApi,
                cache
            );
            incrementCounter(stats.imported, 'transaction_entries');
        }

        const movementState = await getTableState('inventory_movements', queryApi, cache);
        const movements = bundle.tables.inventory_movements?.rows || [];
        for (const sourceRow of movements) {
            const newItemId = inventoryItemIdMap.get(String(sourceRow.item_id));

            if (!newItemId) {
                incrementCounter(stats.skipped, 'inventory_movements');
                restoreWarnings.push(`Se omitió un movimiento de inventario por item faltante (item_id=${sourceRow.item_id}).`);
                continue;
            }

            await insertRow(
                'inventory_movements',
                buildInsertRow(sourceRow, movementState, {
                    overrides: { item_id: newItemId }
                }),
                queryApi,
                cache
            );
            incrementCounter(stats.imported, 'inventory_movements');
        }

        // --- Costos y producción ---
        const costCenterIdMap = new Map();
        const distributionModelIdMap = new Map();

        // cost_centers: parent_id es auto-referencial → dos pasadas (insertar sin padre, luego re-vincular).
        const costCenters = bundle.tables.cost_centers?.rows || [];
        if (costCenters.length > 0) {
            const ccState = await getTableState('cost_centers', queryApi, cache);
            if (ccState.exists) {
                for (const sourceRow of costCenters) {
                    const result = await insertRow(
                        'cost_centers',
                        buildInsertRow(sourceRow, ccState, { companyId: newCompanyId, overrides: { parent_id: null } }),
                        queryApi,
                        cache
                    );
                    incrementCounter(stats.imported, 'cost_centers');
                    if (sourceRow.id !== undefined && sourceRow.id !== null && result.lastID !== null && result.lastID !== undefined) {
                        costCenterIdMap.set(String(sourceRow.id), result.lastID);
                    }
                }

                if (ccState.columnSet.has('parent_id')) {
                    for (const sourceRow of costCenters) {
                        if (sourceRow.parent_id === undefined || sourceRow.parent_id === null) continue;
                        const newId = costCenterIdMap.get(String(sourceRow.id));
                        const newParentId = costCenterIdMap.get(String(sourceRow.parent_id));
                        if (newId && newParentId) {
                            await queryApi.run(
                                `UPDATE ${escapeIdentifier('cost_centers')} SET parent_id = ? WHERE id = ?`,
                                [newParentId, newId]
                            );
                        }
                    }
                }
            }
        }

        // cost_distribution_models (company-scoped)
        const distributionModels = bundle.tables.cost_distribution_models?.rows || [];
        if (distributionModels.length > 0) {
            const dmState = await getTableState('cost_distribution_models', queryApi, cache);
            if (dmState.exists) {
                for (const sourceRow of distributionModels) {
                    const result = await insertRow(
                        'cost_distribution_models',
                        buildInsertRow(sourceRow, dmState, { companyId: newCompanyId }),
                        queryApi,
                        cache
                    );
                    incrementCounter(stats.imported, 'cost_distribution_models');
                    if (sourceRow.id !== undefined && sourceRow.id !== null && result.lastID !== null && result.lastID !== undefined) {
                        distributionModelIdMap.set(String(sourceRow.id), result.lastID);
                    }
                }
            }
        }

        // cost_distribution_entries (remapea model_id + cost_center_id; no tiene company_id)
        const distributionEntries = bundle.tables.cost_distribution_entries?.rows || [];
        if (distributionEntries.length > 0) {
            const deState = await getTableState('cost_distribution_entries', queryApi, cache);
            if (deState.exists) {
                for (const sourceRow of distributionEntries) {
                    const newModelId = distributionModelIdMap.get(String(sourceRow.model_id));
                    const newCostCenterId = costCenterIdMap.get(String(sourceRow.cost_center_id));
                    if (!newModelId || !newCostCenterId) {
                        incrementCounter(stats.skipped, 'cost_distribution_entries');
                        restoreWarnings.push(`Se omitió una entrada de distribución por referencias faltantes (model_id=${sourceRow.model_id}, cost_center_id=${sourceRow.cost_center_id}).`);
                        continue;
                    }
                    await insertRow(
                        'cost_distribution_entries',
                        buildInsertRow(sourceRow, deState, { overrides: { model_id: newModelId, cost_center_id: newCostCenterId } }),
                        queryApi,
                        cache
                    );
                    incrementCounter(stats.imported, 'cost_distribution_entries');
                }
            }
        }

        // production_orders (remapea product_id → inventory_items)
        const productionOrders = bundle.tables.production_orders?.rows || [];
        if (productionOrders.length > 0) {
            const poState = await getTableState('production_orders', queryApi, cache);
            if (poState.exists) {
                for (const sourceRow of productionOrders) {
                    const newProductId = inventoryItemIdMap.get(String(sourceRow.product_id));
                    if ((sourceRow.product_id !== undefined && sourceRow.product_id !== null) && !newProductId) {
                        incrementCounter(stats.skipped, 'production_orders');
                        restoreWarnings.push(`Se omitió una orden de producción por producto faltante (product_id=${sourceRow.product_id}).`);
                        continue;
                    }
                    const overrides = {};
                    if (newProductId) overrides.product_id = newProductId;
                    await insertRow(
                        'production_orders',
                        buildInsertRow(sourceRow, poState, { companyId: newCompanyId, overrides }),
                        queryApi,
                        cache
                    );
                    incrementCounter(stats.imported, 'production_orders');
                }
            }
        }

        return {
            newCompanyId,
            restoredCompanyName,
            sourceCompanyName: sourceCompany.name,
            stats,
            warnings: uniqueMessages(restoreWarnings)
        };
    });
}

async function notifyAiProfileReload(companyId) {
    try {
        const token = getExpectedToken();
        await axios.post(
            `${INTERNAL_API_BASE_URL}/api/ai/reload-profiles`,
            { companyId },
            { timeout: 4000, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
    } catch (error) {
        console.warn('No se pudo refrescar caché de perfiles AI tras restauración:', error.message);
    }
}

router.get('/export/:companyId', async (req, res) => {
    const { companyId } = req.params;

    try {
        const bundle = await exportCompanyData(companyId);
        if (!bundle) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const fileName = `Backup_${sanitizeFilename(bundle.sourceCompany.name)}_${formatDate(new Date())}.zip`;
        res.setHeader('X-Backup-Version', BACKUP_VERSION);
        res.attachment(fileName);

        const archive = archiver('zip', { zlib: { level: 9 } });
        // No relanzar dentro del callback (sería una excepción no capturada que tumba Node).
        archive.on('error', (error) => {
            console.error('Archiver error durante export:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to generate backup: ' + error.message });
            } else {
                res.destroy(error);
            }
        });

        archive.pipe(res);
        archive.append(JSON.stringify(bundle.metadata), { name: 'metadata.json' });

        Object.values(bundle.tables).forEach((tablePayload) => {
            archive.append(JSON.stringify(tablePayload), {
                name: `data/${tablePayload.table}.json`
            });
        });

        await archive.finalize();
    } catch (error) {
        console.error('Export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to generate backup: ' + error.message });
        }
    }
});

router.post('/dry-run', uploadSingle('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const bundle = await readBackupBundle(req.file.path);
        const compatibility = await assessRestoreCompatibility(bundle);
        const metadata = {
            ...bundle.metadata,
            version: bundle.metadata.version || BACKUP_VERSION,
            createdAt: bundle.metadata.createdAt || bundle.metadata.timestamp || null,
            counts: bundle.validation.counts,
            checksum: bundle.metadata.checksum || bundle.metadata.hash || bundle.validation.computedChecksum,
            integrity: {
                ...(bundle.metadata.integrity || {}),
                valid: bundle.validation.valid,
                checksumMatches: bundle.validation.checksumMatches,
                totalDebit: bundle.validation.totalDebit,
                totalCredit: bundle.validation.totalCredit,
                balanceDelta: bundle.validation.balanceDelta,
                warnings: uniqueMessages([
                    ...(bundle.metadata.integrity?.warnings || []),
                    ...bundle.validation.warnings
                ]),
                errors: uniqueMessages([
                    ...(bundle.metadata.integrity?.errors || []),
                    ...bundle.validation.errors
                ])
            },
            compatibility
        };

        res.json({
            success: bundle.validation.valid && compatibility.ready,
            metadata
        });
    } catch (error) {
        res.status(400).json({ error: 'Failed to read backup: ' + error.message });
    } finally {
        await safeRemoveFile(req.file?.path);
    }
});

router.post('/import', uploadSingle('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const bundle = await readBackupBundle(req.file.path);
        const restoreResult = await restoreBackupBundle(bundle);

        if (!restoreResult || !restoreResult.newCompanyId) {
            throw new Error('La restauración no devolvió un resultado válido (newCompanyId ausente).');
        }

        await notifyAiProfileReload(restoreResult.newCompanyId);

        res.json({
            success: true,
            message: 'Restore completed successfully',
            newCompanyId: restoreResult.newCompanyId,
            restoredCompanyName: restoreResult.restoredCompanyName,
            sourceCompanyName: restoreResult.sourceCompanyName,
            counts: restoreResult.stats?.imported || {},
            skipped: restoreResult.stats?.skipped || {},
            warnings: restoreResult.warnings || []
        });
    } catch (error) {
        console.error('Import error:', error);
        res.status(400).json({ error: 'Import failed: ' + error.message });
    } finally {
        await safeRemoveFile(req.file?.path);
    }
});

module.exports = router;
