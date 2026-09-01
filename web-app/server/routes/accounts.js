const express = require('express');
const router = express.Router();
const db = require('../db');

// Migration: Add acquisition_date column for fixed assets
db.run(`ALTER TABLE accounts ADD COLUMN acquisition_date TEXT`, (err) => {
    // Ignore error if column already exists
});

// Get all accounts for a company
router.get('/', (req, res) => {
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const sql = `SELECT * FROM accounts WHERE company_id = ? ORDER BY code`;
    db.all(sql, [companyId], (err, rows) => {
        if (err) {
            console.error('Error fetching accounts:', err.message);
            return res.status(500).json({ error: 'Error al obtener el plan de cuentas' });
        }
        res.json({ data: rows });
    });
});

// PATCH update acquisition dates for multiple accounts - LIBSQL PROMISES VERSION
router.patch('/acquisition-dates', async (req, res) => {
    const { acquisitions } = req.body; // Array of { accountCode, companyId, acquisitionDate }

    if (!acquisitions || !Array.isArray(acquisitions)) {
        return res.status(400).json({ error: 'acquisitions array is required' });
    }

    const sql = `UPDATE accounts SET acquisition_date = ? WHERE code = ? AND company_id = ?`;

    try {
        // Transacción atómica (antes: BEGIN/COMMIT sueltos sobre la cola compartida).
        const errors = await db.transaction(async (tx) => {
            let errorCount = 0;

            for (const acq of acquisitions) {
                try {
                    await tx.execute({ sql, args: [acq.acquisitionDate, acq.accountCode, acq.companyId] });
                } catch (err) {
                    errorCount++;
                    console.error(`Error updating acquisition date for account ${acq.accountCode}:`, err.message);
                }
            }

            return errorCount;
        });

        res.json({
            success: true,
            message: `Updated ${acquisitions.length - errors} acquisition dates`,
            successCount: acquisitions.length - errors,
            errorCount: errors
        });

    } catch (error) {
        console.error('Error updating acquisition dates:', error.message);
        res.status(500).json({ error: 'Failed to update acquisition dates' });
    }
});

// Create account - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { code, name, type, level, parent_code, companyId } = req.body;

    if (!code || !name || !type || !level || !companyId) {
        console.error('❌ [API] Missing required fields for account creation:', { body: req.body });
        return res.status(400).json({ error: 'Missing required fields', received: req.body });
    }

    const sql = 'INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)';

    try {
        const result = await db.run(sql, [companyId, code, name, type, level, parent_code || null]);
        res.json({
            message: 'Account created',
            id: result.lastID,
            data: { ...req.body, company_id: companyId }
        });
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
            return res.status(409).json({ error: `Ya existe la cuenta ${code} en esta empresa` });
        }
        console.error('Error creating account:', err.message);
        res.status(500).json({ error: 'Error al crear la cuenta' });
    }
});

// POST bulk create accounts - LIBSQL PROMISES VERSION
router.post('/bulk', async (req, res) => {
    const { accounts, companyId } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format or empty data' });
    }

    const sql = 'INSERT INTO accounts (company_id, code, name, type, level, parent_code) VALUES (?, ?, ?, ?, ?, ?)';

    try {
        // Transacción atómica. Errores por fila (p. ej. código duplicado) se cuentan
        // y se toleran como antes, pero ahora o se committea el lote completo o nada.
        const { successCount, errors } = await db.transaction(async (tx) => {
            let errorCount = 0;
            let okCount = 0;
            const seenCodes = new Set();

            for (const acc of accounts) {
                // Validación mínima antes de insertar (+ duplicados dentro del propio lote)
                if (!acc.code || !acc.name || !acc.type || !acc.level || seenCodes.has(acc.code)) {
                    errorCount++;
                    continue;
                }
                seenCodes.add(acc.code);

                try {
                    await tx.execute({
                        sql,
                        args: [companyId, acc.code, acc.name, acc.type, acc.level, acc.parent_code || null]
                    });
                    okCount++;
                } catch (err) {
                    errorCount++;
                    console.error(`Error inserting account ${acc.code}:`, err.message);
                }
            }

            return { successCount: okCount, errors: errorCount };
        });

        res.json({
            message: `Bulk import completed. Processed ${accounts.length} accounts.`,
            successCount: successCount,
            errorCount: errors
        });

    } catch (error) {
        console.error('Error in bulk account creation:', error.message);
        res.status(500).json({ error: 'Failed to execute bulk insert' });
    }
});

// Update account - LIBSQL PROMISES VERSION
router.put('/:id', async (req, res) => {
    const { code, name, type, level, parent_code, companyId } = req.body;
    const { id } = req.params;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }
    if (!code || !name || !type || !level) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // ⛔ Nunca se actualiza company_id: una cuenta no puede "mudarse" de empresa
    // (arrastraría sus transaction_entries y contaminaría el mayor de la otra).
    const sql = 'UPDATE accounts SET code = ?, name = ?, type = ?, level = ?, parent_code = ? WHERE id = ? AND company_id = ?';

    try {
        const result = await db.run(sql, [code, name, type, level, parent_code || null, id, companyId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        res.json({ message: 'Account updated', changes: result.changes });
    } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
            return res.status(409).json({ error: `Ya existe la cuenta ${code} en esta empresa` });
        }
        console.error('Error updating account:', err.message);
        res.status(500).json({ error: 'Error al actualizar la cuenta' });
    }
});

// Delete account - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    try {
        // Check if it's a "delete all" request
        if (id === 'all') {
            const sql = 'DELETE FROM accounts WHERE company_id = ?';
            const result = await db.run(sql, [companyId]);
            res.json({ message: 'All accounts deleted for company', changes: result.changes });
            return;
        }

        const sql = 'DELETE FROM accounts WHERE id = ? AND company_id = ?';
        const result = await db.run(sql, [id, companyId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        res.json({ message: 'Account deleted', changes: result.changes });

    } catch (err) {
        // FK: la cuenta tiene partidas asociadas → mensaje claro, sin filtrar internals.
        if (String(err.message).includes('FOREIGN KEY')) {
            return res.status(409).json({ error: 'La cuenta tiene movimientos asociados y no puede eliminarse.' });
        }
        console.error('Error deleting account:', err.message);
        res.status(500).json({ error: 'Error al eliminar la cuenta' });
    }
});

// Batch update parent codes - LIBSQL PROMISES VERSION
router.patch('/batch-parents', async (req, res) => {
    const { updates, companyId } = req.body; // updates: [{ id, parent_code }]

    if (!updates || !Array.isArray(updates) || !companyId) {
        return res.status(400).json({ error: 'Invalid request format' });
    }

    const sql = 'UPDATE accounts SET parent_code = ? WHERE id = ? AND company_id = ?';

    try {
        // Transacción atómica (antes: BEGIN/COMMIT sueltos sobre la cola compartida).
        const successCount = await db.transaction(async (tx) => {
            let okCount = 0;

            for (const u of updates) {
                try {
                    await tx.execute({ sql, args: [u.parent_code, u.id, companyId] });
                    okCount++;
                } catch (err) {
                    console.error(`Error updating parent code for account ${u.id}:`, err.message);
                    throw err; // aborta el lote completo: consistencia del árbol de cuentas
                }
            }

            return okCount;
        });

        res.json({ message: `Successfully updated ${successCount} accounts` });

    } catch (error) {
        console.error('Error in batch parent update:', error.message);
        res.status(500).json({ error: 'Failed to execute batch update' });
    }
});

// Fix parent codes for all accounts - LIBSQL PROMISES VERSION
router.post('/fix-parent-codes', async (req, res) => {
    const { companyId } = req.body;

    // Scoped multi-tenant: inferir padres SOLO dentro del plan de cuentas de la empresa.
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    try {
        console.log('🔧 Iniciando corrección de parent_code vía API...');

        // Obtener las cuentas de ESTA empresa únicamente
        const accounts = await new Promise((resolve, reject) => {
            db.all(
                'SELECT id, code, name, level, parent_code FROM accounts WHERE company_id = ? ORDER BY code',
                [companyId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        console.log(`📊 Encontradas ${accounts.length} cuentas`);

        let updatedCount = 0;

        // Procesar cada cuenta
        for (const acc of accounts) {
            let parentCode = acc.parent_code;

            // Si ya tiene parent_code, saltar
            if (parentCode) continue;

            // Lógica de inferencia basada en reports.js
            if (acc.level > 1 && acc.code.length > 1) {
                if (acc.code.includes('.')) {
                    const parts = acc.code.split('.');
                    parts.pop();
                    parentCode = parts.join('.');
                } else if (acc.code.includes('-')) {
                    const parts = acc.code.split('-');
                    parts.pop();
                    parentCode = parts.join('-');
                } else {
                    // Heurística para PUCT boliviano
                    if (acc.code.length === 4) {
                        parentCode = acc.code.substring(0, 2);
                    } else if (acc.code.length === 6) {
                        parentCode = acc.code.substring(0, 4);
                    } else if (acc.code.length === 8) {
                        parentCode = acc.code.substring(0, 6);
                    }
                }
            }

            if (parentCode && parentCode !== acc.parent_code) {
                // Verificar que el padre existe DENTRO de esta empresa
                const parentExists = accounts.some(a => a.code === parentCode);
                if (parentExists) {
                    await new Promise((resolve, reject) => {
                        db.run(
                            'UPDATE accounts SET parent_code = ? WHERE id = ? AND company_id = ?',
                            [parentCode, acc.id, companyId],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                    updatedCount++;
                }
            }
        }

        console.log(`🎉 Proceso completado. Actualizadas ${updatedCount} cuentas.`);
        res.json({
            success: true,
            message: `Parent codes fixed for ${updatedCount} accounts`,
            totalAccounts: accounts.length,
            updatedCount
        });

    } catch (error) {
        console.error('❌ Error fixing parent codes:', error);
        res.status(500).json({ error: 'Error al corregir los parent codes' });
    }
});

module.exports = router;
