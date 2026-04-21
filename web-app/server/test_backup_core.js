const assert = require('assert');
const {
    BACKUP_VERSION,
    LEGACY_BACKUP_VERSION,
    normalizeBackupTables,
    computeTablesChecksum,
    computeLegacyTablesHash,
    validateBackupTables,
    buildBackupMetadata
} = require('./utils/backupCore');

function buildFixtureTables() {
    return normalizeBackupTables({
        companies: [{ id: 10, name: 'Empresa Demo', nit: '123456' }],
        accounts: [
            { id: 1, company_id: 10, code: '1.1', name: 'Caja', type: 'Activo', level: 2 },
            { id: 2, company_id: 10, code: '3.1', name: 'Capital', type: 'Patrimonio', level: 2 }
        ],
        transactions: [
            { id: 100, company_id: 10, date: '2026-01-31', gloss: 'Apertura', type: 'Ingreso' }
        ],
        transaction_entries: [
            { id: 1000, transaction_id: 100, account_id: 1, debit: 100, credit: 0, gloss: 'Caja' },
            { id: 1001, transaction_id: 100, account_id: 2, debit: 0, credit: 100, gloss: 'Capital' }
        ],
        inventory_items: [{ id: 50, company_id: 10, code: 'INV-1', name: 'Item', unit: 'pz' }],
        inventory_movements: [{ id: 51, item_id: 50, date: '2026-01-31', type: 'Compra', quantity: 2, unit_cost: 5, total_cost: 10 }],
        fixed_assets: [],
        ufv_rates: [{ id: 70, company_id: 10, date: '2026-01-31', value: 2.5 }],
        exchange_rates: [{ id: 80, company_id: 10, date: '2026-01-31', currency: 'USD', buy_rate: 6.86, sell_rate: 6.96 }],
        company_adjustment_profiles: [{ id: 90, company_id: 10, profile_json: '{"ok":true}', version: 1 }],
        mahoraga_adaptation_events: [{ id: 'evt-1', company_id: 10, action: 'learned', event_data: '{}' }]
    });
}

function run() {
    const tables = buildFixtureTables();
    const checksum = computeTablesChecksum(tables);
    const validation = validateBackupTables(tables, { version: BACKUP_VERSION, checksum });

    assert.strictEqual(validation.valid, true, 'El backup nuevo debe ser válido');
    assert.strictEqual(validation.checksumMatches, true, 'El checksum nuevo debe coincidir');
    assert.strictEqual(validation.balanceDelta, 0, 'Los asientos deben quedar balanceados');
    assert.strictEqual(validation.counts.transactions, 1, 'Debe contar transacciones');

    const metadata = buildBackupMetadata({
        sourceCompany: tables.companies.rows[0],
        tables,
        validation,
        checksum
    });

    assert.strictEqual(metadata.version, BACKUP_VERSION, 'Debe usar la versión nueva');
    assert.strictEqual(metadata.counts.accounts, 2, 'Debe reflejar el conteo de cuentas');

    const legacyHash = computeLegacyTablesHash(tables);
    const legacyValidation = validateBackupTables(tables, {
        version: LEGACY_BACKUP_VERSION,
        hash: legacyHash
    });

    assert.strictEqual(legacyValidation.valid, true, 'El backup legacy debe seguir siendo válido');
    assert.strictEqual(legacyValidation.checksumMatches, true, 'El hash legacy debe seguir coincidiendo');

    const invalidTables = normalizeBackupTables({
        ...tables,
        transaction_entries: [
            ...tables.transaction_entries.rows,
            { id: 2000, transaction_id: 9999, account_id: 1, debit: 10, credit: 0 }
        ]
    });

    const invalidValidation = validateBackupTables(invalidTables, {
        version: BACKUP_VERSION,
        checksum: computeTablesChecksum(invalidTables)
    });

    assert.strictEqual(invalidValidation.valid, false, 'Los huérfanos deben invalidar el backup');
    assert.ok(
        invalidValidation.errors.some((message) => message.includes('huérfanos')),
        'Debe reportar detalles huérfanos'
    );

    console.log('test_backup_core: ok');
}

run();
