const express = require('express');
const router = express.Router();
const db = require('../db');
const {
    ValidationError,
    validateTransaction,
    MAX_BATCH_TRANSACTIONS
} = require('../utils/transactionValidator');

// Get transaction by ID with account details (debe ir antes de la ruta general)
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    // Scoped multi-tenant: sin empresa no se lee el asiento.
    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    const sql = `
        SELECT 
            t.*,
            te.id as entry_id,
            te.account_id,
            te.debit,
            te.credit,
            te.gloss as entry_gloss,
            a.code as account_code,
            a.name as account_name
        FROM transactions t
        LEFT JOIN transaction_entries te ON t.id = te.transaction_id
        LEFT JOIN accounts a ON te.account_id = a.id
        WHERE t.id = ? AND t.company_id = ?
        ORDER BY te.id
    `;

    db.all(sql, [id, companyId], (err, rows) => {
        if (err) {
            console.error('Error fetching transaction:', err.message);
            return res.status(500).json({ error: 'Error al obtener la transacción' });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const transaction = {
            id: rows[0].id,
            date: rows[0].date,
            gloss: rows[0].gloss,
            type: rows[0].type,
            company_id: rows[0].company_id,
            created_at: rows[0].created_at,
            entries: rows
                .filter(row => row.entry_id)
                .map(row => ({
                    id: row.entry_id,
                    account_id: row.account_id,
                    account_code: row.account_code,
                    account_name: row.account_name,
                    debit: parseFloat(row.debit || 0),
                    credit: parseFloat(row.credit || 0),
                    gloss: row.entry_gloss
                }))
        };

        // Calcular totales
        transaction.total_debit = transaction.entries.reduce((sum, e) => sum + e.debit, 0);
        transaction.total_credit = transaction.entries.reduce((sum, e) => sum + e.credit, 0);

        res.json({ data: transaction });
    });
});

// Get all transactions
router.get('/', (req, res) => {
    const { companyId } = req.query;

    let sql = `
        SELECT t.*,
               COALESCE(SUM(te.debit), 0) as total_debit,
               COALESCE(SUM(te.credit), 0) as total_credit,
               json_group_array(json_object(
                    'account_id', te.account_id, 
                    'debit', te.debit, 
                    'credit', te.credit,
                    'account_code', a.code,
                    'account_name', a.name
                )) as entries
        FROM transactions t
        LEFT JOIN transaction_entries te ON t.id = te.transaction_id
        LEFT JOIN accounts a ON te.account_id = a.id
    `;
    const params = [];

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
    }

    if (companyId) {
        sql += ` WHERE t.company_id = ?`;
        params.push(companyId);
    }

    sql += ` GROUP BY t.id ORDER BY t.date DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching transactions:', err.message);
            return res.status(500).json({ error: 'Error al obtener transacciones' });
        }
        const transactions = rows.map(row => {
            const entries = JSON.parse(row.entries || '[]');

            let totalDebit = Number(row.total_debit) || 0;
            let totalCredit = Number(row.total_credit) || 0;

            if ((totalDebit === 0 && totalCredit === 0) && entries.length > 0) {
                totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
                totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
            }

            return {
                id: row.id,
                company_id: row.company_id,
                date: row.date,
                gloss: row.gloss,
                type: row.type,
                created_at: row.created_at,
                total_debit: totalDebit,
                total_credit: totalCredit,
                entries: entries
            };
        });
        res.json({ data: transactions });
    });
});

// Create a new transaction - LIBSQL PROMISES VERSION
router.post('/', async (req, res) => {
    const { date, gloss, type, entries, companyId } = req.body;

    if (!date || !entries || !companyId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Validación contable: partidas de la empresa, montos ≥ 0 y debe = haber.
        const normalized = await validateTransaction(
            db, { date, gloss, type, entries }, companyId, { label: gloss }
        );

        // Transacción interactiva libSQL: atómica bajo concurrencia y con lastInsertRowid real.
        // (Antes: BEGIN/COMMIT sueltos sobre la cola compartida, que podían intercalar requests.)
        const transactionId = await db.transaction(async (tx) => {
            // Insert transaction header
            const headerRs = await tx.execute({
                sql: 'INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)',
                args: [normalized.date, normalized.gloss, normalized.type, companyId]
            });
            const id = Number(headerRs.lastInsertRowid);

            // Insert all entries (ya validadas y con accountId resuelto)
            const insertEntrySql = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
            for (const entry of normalized.entries) {
                await tx.execute({
                    sql: insertEntrySql,
                    args: [id, entry.accountId, entry.debit, entry.credit, entry.gloss]
                });
            }

            return id;
        });

        res.json({
            message: 'Transaction created',
            id: transactionId,
            data: req.body
        });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ error: error.message });
        }
        console.error('Error creating transaction:', error.message);
        res.status(500).json({ error: 'Error al crear la transacción' });
    }
});

// POST /batch - Create multiple transactions at once (cierre, confirmación de ajustes IA)
router.post('/batch', async (req, res) => {
    const { transactions, companyId } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0 || !companyId) {
        return res.status(400).json({ error: 'Invalid request format: requires a "transactions" array and "companyId".' });
    }

    if (transactions.length > MAX_BATCH_TRANSACTIONS) {
        return res.status(400).json({ error: `Máximo ${MAX_BATCH_TRANSACTIONS} transacciones por lote.` });
    }

    try {
        // Validación contable de TODO el lote antes de escribir una sola fila:
        // cada transacción balanceada, cuentas de la empresa, montos ≥ 0, fechas válidas.
        const normalizedBatch = [];
        for (const trans of transactions) {
            const normalized = await validateTransaction(
                db,
                { date: trans.date, gloss: trans.gloss, type: trans.type, entries: trans.entries },
                companyId,
                { label: trans.gloss || trans.type || '' }
            );
            normalizedBatch.push(normalized);
        }

        // Strategy V4: db.exec() mapea a client.batch() con sentencias parametrizadas
        // {sql, args}. libSQL batch ejecuta secuencialmente en una transacción implícita,
        // así que last_insert_rowid() refiere a la cabecera insertada justo antes.
        const batchStmts = [];

        for (const trans of normalizedBatch) {
            // 1. Insert Header (parametrizado)
            batchStmts.push({
                sql: `INSERT INTO transactions (date, gloss, type, company_id) VALUES (?, ?, ?, ?)`,
                args: [trans.date, trans.gloss, trans.type, companyId]
            });

            // 2. Insert Entries (Bulk parametrizado, ya validados)
            const placeholders = [];
            const args = [];
            for (const entry of trans.entries) {
                // last_insert_rowid() refiere a la cabecera insertada justo arriba.
                placeholders.push(`(last_insert_rowid(), ?, ?, ?, ?)`);
                args.push(
                    entry.accountId,
                    entry.debit,
                    entry.credit,
                    entry.gloss
                );
            }

            batchStmts.push({
                sql: `INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES ${placeholders.join(', ')}`,
                args
            });
        }

        // Execute via db.exec (client.batch)
        await new Promise((resolve, reject) => {
            db.exec(batchStmts, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log(`✅ Bulk Batch successful: ${normalizedBatch.length} txs.`);

        if (!res.headersSent) {
            res.status(201).json({
                success: true,
                message: `${normalizedBatch.length} closing transactions created successfully.`
            });
        }

    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('CRITICAL: Failed to execute BULK batch insert:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to execute bulk batch insert.'
            });
        }
    }
});

// Update transaction - LIBSQL PROMISES VERSION
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { date, gloss, type, entries, companyId } = req.body;

    if (!date || !entries || !companyId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Validación contable (misma regla que POST /).
        const normalized = await validateTransaction(
            db, { date, gloss, type, entries }, companyId, { label: gloss }
        );

        // Transacción interactiva libSQL (misma razón que en POST /).
        const updated = await db.transaction(async (tx) => {
            // Update transaction header (scoped por empresa). Si no existe → aborta
            // ANTES de tocar los entries: jamás se mutan partidas de otra empresa.
            const rs = await tx.execute({
                sql: 'UPDATE transactions SET date = ?, gloss = ?, type = ? WHERE id = ? AND company_id = ?',
                args: [normalized.date, normalized.gloss, normalized.type, id, companyId]
            });
            if (rs.rowsAffected === 0) {
                return false;
            }

            // Delete existing entries (la cabecera ya se verificó de esta empresa)
            await tx.execute({
                sql: 'DELETE FROM transaction_entries WHERE transaction_id = ?',
                args: [id]
            });

            // Insert new entries (validadas)
            const insertEntrySql = 'INSERT INTO transaction_entries (transaction_id, account_id, debit, credit, gloss) VALUES (?, ?, ?, ?, ?)';
            for (const entry of normalized.entries) {
                await tx.execute({
                    sql: insertEntrySql,
                    args: [id, entry.accountId, entry.debit, entry.credit, entry.gloss]
                });
            }
            return true;
        });

        if (!updated) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({ message: 'Transaction updated successfully' });

    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ error: error.message });
        }
        console.error('Error updating transaction:', error.message);
        res.status(500).json({ error: 'Error al actualizar la transacción' });
    }
});

// Delete transaction - LIBSQL PROMISES VERSION
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { companyId } = req.query;

    if (!companyId) {
        return res.status(400).json({ error: 'companyId is required to delete transactions' });
    }

    try {
        // Transacción interactiva libSQL (misma razón que en POST /).
        // Orden crítico: verificar ownership ANTES de borrar los entries.
        // (Antes borraba los entries primero sin filtro de empresa → pérdida
        // silenciosa de partidas de otra empresa aunque el header se rechazara.)
        const deleted = await db.transaction(async (tx) => {
            const checkRs = await tx.execute({
                sql: 'SELECT id FROM transactions WHERE id = ? AND company_id = ?',
                args: [id, companyId]
            });
            if (checkRs.rows.length === 0) {
                return false;
            }

            // Delete entries first (foreign key constraint)
            await tx.execute({
                sql: 'DELETE FROM transaction_entries WHERE transaction_id = ?',
                args: [id]
            });

            // Delete the transaction
            await tx.execute({
                sql: 'DELETE FROM transactions WHERE id = ? AND company_id = ?',
                args: [id, companyId]
            });

            return true;
        });

        if (!deleted) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({ message: 'Transaction deleted successfully' });

    } catch (error) {
        console.error('Error deleting transaction:', error.message);
        res.status(500).json({ error: 'Error al eliminar la transacción' });
    }
});

module.exports = router;
